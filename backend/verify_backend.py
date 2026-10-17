"""
Operational Verification Script for Phase 6 Backend, Storage, and Live GRU Integration.

Executes standalone operational verification across 10 verification gates:
1. Valid telemetry persistence & preservation of raw sensor values.
2. Duplicate telemetry idempotency (composite primary key & unique constraint handling).
3. Summary, asset status, and edge alert persistence.
4. Sequence integrity: exactly 30 contiguous observations required before prediction.
5. Multi-asset isolation: asset buffers and sequence counters are strictly independent.
6. Sequence gap detection: sequence gaps immediately reset buffer; no predictions across gaps.
7. Zero ground-truth leakage: no ground-truth labels (Machine failure, TWF, etc.) in inputs/storage.
8. REST API endpoints: /health, /assets, /assets/{id}, /telemetry, /summaries, /predictions, /alerts.
9. WebSocket broadcasting: connection manager lifecycle and non-blocking event dispatch.
10. End-to-end telemetry ingestion, persistence, and live GRU prediction flow.

Usage:
    python backend/verify_backend.py
"""

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

# Ensure repository root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.testclient import TestClient

import backend.app.database.connection as db_conn
from backend.app.config import Settings, get_settings
from backend.app.database.connection import get_db
from backend.app.database.models import (
    AssetStatusModel,
    Base,
    EdgeAlertModel,
    PredictionModel,
    SummaryModel,
    TelemetryModel,
)
from backend.app.database.repository import TelemetryRepository
from backend.app.main import app
from backend.app.services.prediction_service import PredictionService
from backend.app.services.telemetry_service import TelemetryService
from backend.app.websocket.manager import ConnectionManager
from edge.models import PROHIBITED_LEAKAGE_COLUMNS, RAW_SENSOR_FIELDS


TEST_SETTINGS = Settings(
    database_url="sqlite:///:memory:",
    enable_mqtt_ingestion=False,
    db_retry_attempts=1,
    db_retry_delay_seconds=0.0,
)


def create_clean_test_db():
    """Create an isolated in-memory SQLite database and session factory."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return engine, TestingSession


def sample_telemetry(asset_id: str, seq: int, air_temp: float = 300.0, torque: float = 40.0):
    return {
        "asset_id": asset_id,
        "timestamp": f"2026-10-14T12:00:{seq % 60:02d}Z",
        "sequence_number": seq,
        "air_temperature": air_temp,
        "process_temperature": 310.0,
        "rotational_speed": 1500.0,
        "torque": torque,
        "tool_wear": 10.0 + (seq * 0.5),
        "edge": {
            "validation_status": "VALID",
            "smoothed_values": {
                "air_temperature": air_temp,
                "process_temperature": 310.0,
                "rotational_speed": 1500.0,
                "torque": torque,
                "tool_wear": 10.0 + (seq * 0.5),
            },
            "smoothing_window_size": 1,
            "anomaly_flags": [],
            "sequence_gaps": None,
            "processing_timestamp": f"2026-10-14T12:00:{seq % 60:02d}.010Z",
        },
    }


def verify_gate_1_telemetry_persistence() -> bool:
    print("[1/10] Verifying Telemetry Persistence & Raw Sensor Value Preservation...")
    _, session_factory = create_clean_test_db()
    db = session_factory()
    raw = sample_telemetry("asset_01", seq=1, air_temp=302.5, torque=45.2)

    saved = TelemetryRepository.save_telemetry(db, raw, line="lineA")
    assert saved is not None
    assert saved.asset_id == "asset_01"
    assert saved.sequence_number == 1
    assert saved.air_temperature == 302.5
    assert saved.torque == 45.2
    assert saved.line == "lineA"
    assert saved.has_anomaly is False

    # Verify query
    items = TelemetryRepository.get_telemetry_history(db, "asset_01")
    assert len(items) == 1
    assert items[0].air_temperature == 302.5
    db.close()
    print("  -> OK: Telemetry persisted cleanly with unmodified raw sensor values.")
    return True


def verify_gate_2_duplicate_idempotency() -> bool:
    print("[2/10] Verifying Duplicate Telemetry Idempotency...")
    _, session_factory = create_clean_test_db()
    db = session_factory()
    raw = sample_telemetry("asset_01", seq=1)

    first = TelemetryRepository.save_telemetry(db, raw, line="lineA")
    assert first is not None

    # Save exact duplicate
    second = TelemetryRepository.save_telemetry(db, raw, line="lineA")
    assert second is None, "Duplicate payload should be skipped idempotently!"

    items = TelemetryRepository.get_telemetry_history(db, "asset_01")
    assert len(items) == 1, "Database should contain exactly one record!"
    db.close()
    print("  -> OK: Duplicate telemetry skipped cleanly without raising exceptions.")
    return True


def verify_gate_3_summaries_status_alerts_persistence() -> bool:
    print("[3/10] Verifying Summaries, Asset Status, and Alert Persistence...")
    _, session_factory = create_clean_test_db()
    db = session_factory()

    # 1. Summary
    summary_data = {
        "asset_id": "asset_01",
        "line": "lineA",
        "interval_start_timestamp": "2026-10-14T12:00:00Z",
        "interval_end_timestamp": "2026-10-14T12:01:00Z",
        "observation_count": 60,
        "sensor_statistics": {
            "air_temperature": {"mean": 300.0, "std": 0.5, "min": 299.0, "max": 301.0},
        },
        "anomaly_count": 0,
        "gap_count": 0,
        "is_partial": False,
    }
    saved_summary = TelemetryRepository.save_summary(db, summary_data)
    assert saved_summary is not None
    assert saved_summary.observation_count == 60

    # 2. Status
    status_data = {
        "asset_id": "asset_01",
        "line": "lineA",
        "status": "ONLINE",
        "timestamp": "2026-10-14T12:01:05Z",
        "sequence_number": 60,
    }
    saved_status = TelemetryRepository.upsert_asset_status(db, status_data)
    assert saved_status is not None
    assert saved_status.status == "ONLINE"

    # Upsert with new status
    status_data["status"] = "EXHAUSTED"
    updated_status = TelemetryRepository.upsert_asset_status(db, status_data)
    assert updated_status.status == "EXHAUSTED"

    # 3. Alert
    alert_data = {
        "asset_id": "asset_01",
        "line": "lineA",
        "timestamp": "2026-10-14T12:01:10Z",
        "alert_type": "HIGH_TORQUE",
        "severity": "WARNING",
        "message": "Torque exceeded threshold",
        "details": {"value": 75.0, "threshold": 65.0},
        "source": "edge",
    }
    saved_alert = TelemetryRepository.save_alert(db, alert_data)
    assert saved_alert is not None
    assert saved_alert.alert_type == "HIGH_TORQUE"
    db.close()

    print("  -> OK: Summaries, asset status upsert, and edge alerts persisted accurately.")
    return True


def verify_gate_4_thirty_contiguous_observations() -> bool:
    print("[4/10] Verifying Strict 30 Contiguous Observations Required for Prediction...")
    service = PredictionService()
    asset_id = "asset_01"

    # Feed 29 observations
    for i in range(1, 30):
        t = sample_telemetry(asset_id, seq=i)
        pred = service.process_telemetry(t)
        assert pred is None, f"Observation #{i} must not trigger prediction (< 30 observations)"

    # Feed 30th observation
    t30 = sample_telemetry(asset_id, seq=30)
    pred30 = service.process_telemetry(t30)
    assert pred30 is not None, "Observation #30 must produce a valid prediction!"
    assert pred30["asset_id"] == asset_id
    assert 0.0 <= pred30["failure_probability"] <= 1.0
    assert pred30["prediction"] in (0, 1)
    assert pred30["threshold"] == 0.55
    assert pred30["window_size"] == 30

    print("  -> OK: Prediction precisely withheld until observation #30, then generated.")
    return True


def verify_gate_5_multi_asset_isolation() -> bool:
    print("[5/10] Verifying Multi-Asset State and Prediction Isolation...")
    service = PredictionService()

    # Feed 30 observations to asset_01
    for i in range(1, 31):
        service.process_telemetry(sample_telemetry("asset_01", seq=i))

    # Feed only 10 observations to asset_02
    for i in range(1, 11):
        pred = service.process_telemetry(sample_telemetry("asset_02", seq=i))
        assert pred is None, "asset_02 has only 10 observations, must not predict"

    status1 = service.get_buffer_status("asset_01")
    status2 = service.get_buffer_status("asset_02")

    assert status1["accumulated_observations"] == 30
    assert status1["is_ready"] is True
    assert status2["accumulated_observations"] == 10
    assert status2["is_ready"] is False
    print("  -> OK: Asset buffers and sequence counters are completely isolated.")
    return True


def verify_gate_6_sequence_gap_reset() -> bool:
    print("[6/10] Verifying Sequence Gap Handling & Buffer Reset...")
    service = PredictionService()
    asset_id = "asset_03"

    # Feed 25 valid readings
    for i in range(1, 26):
        service.process_telemetry(sample_telemetry(asset_id, seq=i))

    assert service.get_buffer_status(asset_id)["accumulated_observations"] == 25

    # Introduce a sequence gap at reading 35 (jump from 25 to 35)
    gap_telemetry = sample_telemetry(asset_id, seq=35)
    gap_telemetry["edge"]["sequence_gaps"] = {"expected": 26, "received": 35}

    pred_gap = service.process_telemetry(gap_telemetry)
    assert pred_gap is None, "Sequence gap reading must NOT trigger prediction"

    # Buffer must have been reset to 1
    status_after_gap = service.get_buffer_status(asset_id)
    assert status_after_gap["accumulated_observations"] == 1, (
        f"Buffer should reset to 1 reading after gap, got {status_after_gap['accumulated_observations']}"
    )

    # Next 28 contiguous readings (seq 36 to 63) should NOT predict
    for seq in range(36, 64):
        p = service.process_telemetry(sample_telemetry(asset_id, seq=seq))
        assert p is None, f"Observation seq={seq} must not trigger prediction"

    # Reading 64 is the 30th reading since the gap (35..64) -> Must predict!
    p_ready = service.process_telemetry(sample_telemetry(asset_id, seq=64))
    assert p_ready is not None, "30 contiguous readings after gap must trigger prediction"
    assert p_ready["sequence_end_timestamp"] is not None
    print("  -> OK: Sequence gap resets buffer; predictions resume only after 30 contiguous readings.")
    return True


def verify_gate_7_zero_ground_truth_leakage() -> bool:
    print("[7/10] Verifying Zero Ground-Truth Leakage in Prediction Inputs...")
    service = PredictionService()

    # Attempt to pass forbidden ground-truth columns in telemetry payload
    dirty = sample_telemetry("asset_01", seq=1)
    for col in PROHIBITED_LEAKAGE_COLUMNS:
        dirty[col] = 1

    # Ingest 30 dirty payloads
    last_pred = None
    for i in range(1, 31):
        p_dirty = sample_telemetry("asset_01", seq=i)
        for col in PROHIBITED_LEAKAGE_COLUMNS:
            p_dirty[col] = 1
        last_pred = service.process_telemetry(p_dirty)

    assert last_pred is not None
    for col in PROHIBITED_LEAKAGE_COLUMNS:
        assert col not in last_pred, f"Leakage column '{col}' found in prediction output!"

    # Check buffer contains strictly 5 raw features
    assert service.predictor.feature_names == [
        "Air temperature [K]",
        "Process temperature [K]",
        "Rotational speed [rpm]",
        "Torque [Nm]",
        "Tool wear [min]",
    ]
    print("  -> OK: Prohibited ground-truth columns strictly filtered and excluded from inference.")
    return True


def verify_gate_8_rest_api_endpoints() -> bool:
    print("[8/10] Verifying FastAPI REST Endpoints...")
    test_engine, TestingSession = create_clean_test_db()

    # Direct global connection engine to test engine
    old_engine = db_conn.engine
    old_session = db_conn.SessionLocal
    db_conn.engine = test_engine
    db_conn.SessionLocal = TestingSession

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    import backend.app.config as app_cfg
    orig_get_settings = app_cfg.get_settings
    app_cfg.get_settings = lambda: TEST_SETTINGS

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = lambda: TEST_SETTINGS

    try:
        with TestClient(app, raise_server_exceptions=True) as client:
            # 1. Health
            res = client.get("/health")
            assert res.status_code == 200
            health_data = res.json()
            assert health_data["status"] == "healthy"
            assert health_data["model"]["status"] == "frozen"

            # 2. Asset registry
            res = client.get("/assets")
            assert res.status_code == 200
            assets = res.json()
            assert len(assets) == 20
            assert assets[0]["asset_id"] == "asset_01"

            # 3. Asset detail
            res = client.get("/assets/asset_01")
            assert res.status_code == 200
            asset_01 = res.json()
            assert asset_01["asset_id"] == "asset_01"
            assert asset_01["asset_type"] in ("motor", "pump", "compressor", "spindle_drive")

            # Seed data
            db = TestingSession()
            TelemetryRepository.save_telemetry(db, sample_telemetry("asset_01", 1), line="lineA")
            TelemetryRepository.save_telemetry(db, sample_telemetry("asset_01", 2), line="lineA")
            db.close()

            # 4. Telemetry history
            res = client.get("/assets/asset_01/telemetry?limit=10")
            assert res.status_code == 200
            telemetry_resp = res.json()
            assert len(telemetry_resp) == 2
            assert telemetry_resp[0]["asset_id"] == "asset_01"

            # 5. Predictions latest
            res = client.get("/predictions/latest")
            assert res.status_code == 200
            assert isinstance(res.json(), list)

            # 6. Alerts
            res = client.get("/alerts")
            assert res.status_code == 200
            assert isinstance(res.json(), list)
    finally:
        app_cfg.get_settings = orig_get_settings
        app.dependency_overrides.clear()
        db_conn.engine = old_engine
        db_conn.SessionLocal = old_session

    print("  -> OK: All REST endpoints (/health, /assets, /telemetry, /predictions, /alerts) verified.")
    return True


def verify_gate_9_websocket_broadcasting() -> bool:
    print("[9/10] Verifying WebSocket Manager Non-Blocking Lifecycle...")

    async def _test_ws():
        manager = ConnectionManager()
        assert manager.client_count == 0

        # Create mock websocket
        class MockWebSocket:
            def __init__(self, will_fail=False):
                self.will_fail = will_fail
                self.sent = []

            async def accept(self):
                pass

            async def send_text(self, text):
                if self.will_fail:
                    raise ConnectionResetError("Client disconnected")
                self.sent.append(text)

        ws1 = MockWebSocket(will_fail=False)
        ws2 = MockWebSocket(will_fail=True)

        await manager.connect(ws1)
        await manager.connect(ws2)
        assert manager.client_count == 2

        # Broadcast event
        await manager.broadcast("prediction", {"asset_id": "asset_01", "failure_probability": 0.12})
        assert len(ws1.sent) == 1
        data = json.loads(ws1.sent[0])
        assert data["type"] == "prediction"
        assert data["data"]["asset_id"] == "asset_01"

        # The failing client ws2 was pruned cleanly
        assert ws1 in manager._active_connections
        assert ws2 not in manager._active_connections

        # Disconnect ws1
        await manager.disconnect(ws1)
        assert manager.client_count == 0

    asyncio.run(_test_ws())
    print("  -> OK: WebSocket connection manager lifecycle, dispatch, and disconnect verified.")
    return True


def verify_gate_10_e2e_telemetry_and_prediction_pipeline() -> bool:
    print("[10/10] Verifying End-to-End Telemetry Ingestion and Prediction Pipeline...")
    _, session_factory = create_clean_test_db()
    prediction_service = PredictionService()
    telemetry_service = TelemetryService(prediction_service=prediction_service)

    async def _run_e2e():
        db = session_factory()
        # Process 35 contiguous telemetry readings for asset_05
        for seq in range(1, 36):
            t = sample_telemetry("asset_05", seq=seq, air_temp=300.5, torque=42.0)
            await telemetry_service.handle_processed_telemetry(db, t, line="lineB")

        # Verify database state
        history = TelemetryRepository.get_telemetry_history(db, "asset_05", limit=100)
        assert len(history) == 35, f"Expected 35 telemetry records, found {len(history)}"

        predictions = TelemetryRepository.get_predictions_history(db, "asset_05")
        # seq 30, 31, 32, 33, 34, 35 -> exactly 6 predictions
        assert len(predictions) == 6, f"Expected 6 predictions (seq 30..35), got {len(predictions)}"
        assert predictions[0].threshold == 0.55
        assert 0.0 <= predictions[0].failure_probability <= 1.0
        db.close()

    asyncio.run(_run_e2e())
    print("  -> OK: Full end-to-end telemetry ingestion, persistence, and live GRU inference confirmed.")
    return True


def run_all_verification_gates():
    print("=" * 70)
    print("PHASE 6: BACKEND, TIMESCALEDB & LIVE GRU INTEGRATION VERIFICATION")
    print("=" * 70)

    gates = [
        verify_gate_1_telemetry_persistence,
        verify_gate_2_duplicate_idempotency,
        verify_gate_3_summaries_status_alerts_persistence,
        verify_gate_4_thirty_contiguous_observations,
        verify_gate_5_multi_asset_isolation,
        verify_gate_6_sequence_gap_reset,
        verify_gate_7_zero_ground_truth_leakage,
        verify_gate_8_rest_api_endpoints,
        verify_gate_9_websocket_broadcasting,
        verify_gate_10_e2e_telemetry_and_prediction_pipeline,
    ]

    passed = 0
    for gate in gates:
        try:
            if gate():
                passed += 1
        except Exception as e:
            print(f"  -> FAILED: {e}")
            import traceback
            traceback.print_exc()

    print("=" * 70)
    print(f"VERIFICATION SUMMARY: {passed}/{len(gates)} GATES PASSED")
    print("=" * 70)
    if passed == len(gates):
        print("ALL PHASE 6 VERIFICATION GATES PASSED SUCCESSFULLY!")
        return 0
    else:
        print("SOME VERIFICATION GATES FAILED!")
        return 1


if __name__ == "__main__":
    sys.exit(run_all_verification_gates())

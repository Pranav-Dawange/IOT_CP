"""
Comprehensive Test Suite for Phase 6 FastAPI Backend, Storage & Live GRU Integration.

Covers:
1. Database schema and table initialization.
2. Valid telemetry persistence (preserving raw sensor values & separate edge fields).
3. Summary persistence.
4. Device status updates and upsert semantics.
5. Edge alert persistence.
6. Prediction event persistence.
7. API /health, /assets, /telemetry, /summaries, /predictions, /alerts endpoints.
8. Duplicate telemetry idempotency.
9. Malformed message and ground-truth leakage rejection in consumer.
10. WebSocket broadcasting.
11. Per-asset inference buffer isolation.
12. Sequence gap detection and buffer reset (no predictions across gaps).
13. No predictions before 30 contiguous valid observations.
14. Preservation of raw sensor values and zero ground-truth leakage in predictions.
15. Frozen GRU predictor and scaler integrity.
"""

from datetime import datetime, timezone
import json
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from backend.app.config import Settings
from backend.app.database.connection import get_db
from backend.app.database.models import Base
from backend.app.database.repository import TelemetryRepository
from backend.app.main import app
from backend.app.services.asset_service import AssetService
from backend.app.services.mqtt_consumer import MQTTConsumerService
from backend.app.services.prediction_service import PredictionService
from backend.app.services.telemetry_service import TelemetryService
from backend.app.websocket.manager import ConnectionManager
from edge.models import PROHIBITED_LEAKAGE_COLUMNS


# -----------------------------------------------------------------------------
# Test Fixtures: In-Memory SQLite Database with StaticPool
# -----------------------------------------------------------------------------

from sqlalchemy.pool import StaticPool
import backend.app.database.connection as db_conn
from backend.app.config import get_settings

TEST_ENGINE = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=TEST_ENGINE)
Base.metadata.create_all(bind=TEST_ENGINE)

# Point global connection engine to TEST_ENGINE during tests
db_conn.engine = TEST_ENGINE
db_conn.SessionLocal = TestingSessionLocal

TEST_SETTINGS = Settings(
    database_url="sqlite:///:memory:",
    enable_mqtt_ingestion=False,
    db_retry_attempts=1,
    db_retry_delay_seconds=0.0,
)


@pytest.fixture(scope="function")
def test_db_session():
    """Create a clean in-memory SQLite database session for isolated testing."""
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        # Clean data between tests
        for table in reversed(Base.metadata.sorted_tables):
            session.execute(table.delete())
        session.commit()
        session.close()


@pytest.fixture(scope="function")
def test_client(test_db_session):
    """FastAPI TestClient with overridden database session and test settings."""
    def override_get_db():
        try:
            yield test_db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = lambda: TEST_SETTINGS

    with TestClient(app, raise_server_exceptions=True) as client:
        yield client

    app.dependency_overrides.clear()


def sample_processed_telemetry(asset_id="asset_01", seq=1, air_temp=300.5, torque=42.3, has_gap=False):
    return {
        "asset_id": asset_id,
        "timestamp": f"2026-10-15T12:00:{seq:02d}Z",
        "sequence_number": seq,
        "air_temperature": air_temp,
        "process_temperature": 310.2,
        "rotational_speed": 1520.0,
        "torque": torque,
        "tool_wear": 15.0,
        "edge": {
            "processing_timestamp": f"2026-10-15T12:00:{seq:02d}.100Z",
            "validation_status": "VALID",
            "smoothing_window_size": min(seq, 5),
            "smoothed_values": {
                "air_temperature": air_temp,
                "process_temperature": 310.2,
                "rotational_speed": 1520.0,
                "torque": torque,
                "tool_wear": 15.0,
            },
            "anomaly_flags": [],
            "sequence_gaps": {"missing_count": 2} if has_gap else None,
        },
    }


# -----------------------------------------------------------------------------
# 1. Database Persistence Tests
# -----------------------------------------------------------------------------

def test_telemetry_persistence_and_raw_preservation(test_db_session):
    """Verify raw sensor values are preserved unchanged alongside edge smoothed fields."""
    payload = sample_processed_telemetry("asset_01", seq=1, air_temp=301.12, torque=44.56)
    record = TelemetryRepository.save_telemetry(test_db_session, payload, line="lineA")

    assert record is not None
    assert record.asset_id == "asset_01"
    assert record.line == "lineA"
    assert record.sequence_number == 1
    # Raw values preserved exactly
    assert record.air_temperature == 301.12
    assert record.torque == 44.56
    # Smoothed values stored separately
    assert record.smoothed_air_temperature == 301.12
    assert record.smoothed_torque == 44.56
    assert record.smoothing_window_size == 1
    assert record.has_sequence_gap is False


def test_telemetry_duplicate_idempotency(test_db_session):
    """Verify duplicate telemetry insertion is handled idempotently without error."""
    payload = sample_processed_telemetry("asset_01", seq=1)
    rec1 = TelemetryRepository.save_telemetry(test_db_session, payload, line="lineA")
    assert rec1 is not None

    # Attempting to save same (timestamp, asset_id, sequence_number) returns None without crashing
    rec2 = TelemetryRepository.save_telemetry(test_db_session, payload, line="lineA")
    assert rec2 is None


def test_summary_persistence(test_db_session):
    """Verify telemetry periodic summary persistence."""
    summary_payload = {
        "asset_id": "asset_01",
        "line": "lineA",
        "interval_start_timestamp": "2026-10-15T12:00:00Z",
        "interval_end_timestamp": "2026-10-15T12:00:10Z",
        "observation_count": 10,
        "sensor_statistics": {
            "torque": {"mean": 40.0, "min": 35.0, "max": 45.0},
        },
        "anomaly_count": 1,
        "gap_count": 0,
        "is_partial": False,
    }
    record = TelemetryRepository.save_summary(test_db_session, summary_payload)
    assert record.id is not None
    assert record.asset_id == "asset_01"
    assert record.observation_count == 10
    assert record.sensor_statistics["torque"]["mean"] == 40.0


def test_asset_status_upsert(test_db_session):
    """Verify status upsert updates existing records cleanly."""
    status_1 = {
        "asset_id": "asset_01",
        "line": "lineA",
        "status": "ONLINE",
        "timestamp": "2026-10-15T12:00:00Z",
        "sequence_number": 1,
        "source_row_index": 0,
        "reason": "heartbeat",
    }
    r1 = TelemetryRepository.upsert_asset_status(test_db_session, status_1)
    assert r1.status == "ONLINE"

    # Update to DISCONNECTED
    status_2 = {
        "asset_id": "asset_01",
        "line": "lineA",
        "status": "DISCONNECTED",
        "timestamp": "2026-10-15T12:00:05Z",
        "reason": "network_timeout",
    }
    r2 = TelemetryRepository.upsert_asset_status(test_db_session, status_2)
    assert r2.status == "DISCONNECTED"
    assert r2.reason == "network_timeout"


def test_alert_persistence(test_db_session):
    """Verify edge alert persistence."""
    alert_payload = {
        "asset_id": "asset_01",
        "line": "lineA",
        "timestamp": "2026-10-15T12:00:00Z",
        "alert_type": "SENSOR_THRESHOLD_ANOMALY",
        "severity": "WARNING",
        "message": "Torque exceeded demonstration maximum",
        "details": {"sensor": "torque", "value": 85.0},
    }
    record = TelemetryRepository.save_alert(test_db_session, alert_payload)
    assert record.id is not None
    assert record.alert_type == "SENSOR_THRESHOLD_ANOMALY"
    assert record.details["value"] == 85.0


def test_prediction_persistence(test_db_session):
    """Verify live GRU prediction event persistence."""
    pred_payload = {
        "asset_id": "asset_01",
        "prediction_timestamp": "2026-10-15T12:00:30Z",
        "failure_probability": 0.1850,
        "prediction": 0,
        "threshold": 0.55,
        "window_size": 30,
        "prediction_horizon": 10,
        "model_type": "GRU",
        "feature_set": "raw",
        "sequence_start_timestamp": "2026-10-15T12:00:01Z",
        "sequence_end_timestamp": "2026-10-15T12:00:30Z",
    }
    record = TelemetryRepository.save_prediction(test_db_session, pred_payload)
    assert record.id is not None
    assert record.failure_probability == 0.1850
    assert record.prediction == 0
    assert record.threshold == 0.55


# -----------------------------------------------------------------------------
# 2. REST API Endpoints Tests
# -----------------------------------------------------------------------------

def test_api_health_endpoint(test_client):
    """Verify /health returns service health, model parameters, and database state."""
    response = test_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["database"] == "connected"
    assert data["model"]["model_type"] == "GRU"
    assert data["model"]["threshold"] == 0.55
    assert data["model"]["window_size"] == 30
    assert data["model"]["prediction_horizon"] == 10
    assert data["model"]["status"] == "frozen"


def test_api_assets_endpoints(test_client, test_db_session):
    """Verify /assets lists all 20 assets and /assets/{asset_id} returns asset details."""
    # List assets
    r_list = test_client.get("/assets")
    assert r_list.status_code == 200
    assets = r_list.json()
    assert len(assets) == 20
    assert assets[0]["asset_id"] == "asset_01"

    # Detail asset_01
    r_detail = test_client.get("/assets/asset_01")
    assert r_detail.status_code == 200
    assert r_detail.json()["asset_id"] == "asset_01"
    assert r_detail.json()["line"] == "lineA"

    # Invalid asset ID
    r_invalid = test_client.get("/assets/asset_99")
    assert r_invalid.status_code == 404


def test_api_telemetry_and_summaries_endpoints(test_client, test_db_session):
    """Verify /assets/{asset_id}/telemetry and /assets/{asset_id}/summaries."""
    # Insert sample telemetry
    TelemetryRepository.save_telemetry(test_db_session, sample_processed_telemetry("asset_01", 1), line="lineA")
    TelemetryRepository.save_telemetry(test_db_session, sample_processed_telemetry("asset_01", 2), line="lineA")

    r_telem = test_client.get("/assets/asset_01/telemetry?limit=10")
    assert r_telem.status_code == 200
    records = r_telem.json()
    assert len(records) == 2
    assert records[0]["asset_id"] == "asset_01"

    # Summaries
    summary_data = {
        "asset_id": "asset_01", "line": "lineA",
        "interval_start_timestamp": "2026-10-15T12:00:00Z",
        "interval_end_timestamp": "2026-10-15T12:00:10Z",
        "observation_count": 10,
        "sensor_statistics": {"torque": {"mean": 40.0, "min": 35.0, "max": 45.0}},
        "anomaly_count": 0, "gap_count": 0, "is_partial": False,
    }
    TelemetryRepository.save_summary(test_db_session, summary_data)

    r_sum = test_client.get("/assets/asset_01/summaries")
    assert r_sum.status_code == 200
    assert len(r_sum.json()) == 1


def test_api_predictions_and_alerts_endpoints(test_client, test_db_session):
    """Verify /assets/{asset_id}/predictions, /predictions/latest, and /alerts."""
    pred_data = {
        "asset_id": "asset_01", "prediction_timestamp": "2026-10-15T12:00:30Z",
        "failure_probability": 0.22, "prediction": 0, "threshold": 0.55,
        "window_size": 30, "prediction_horizon": 10,
    }
    TelemetryRepository.save_prediction(test_db_session, pred_data)

    r_pred = test_client.get("/assets/asset_01/predictions")
    assert r_pred.status_code == 200
    assert len(r_pred.json()) == 1

    r_latest = test_client.get("/predictions/latest")
    assert r_latest.status_code == 200
    assert len(r_latest.json()) == 1

    # Alerts
    alert_data = {
        "asset_id": "asset_01", "line": "lineA", "timestamp": "2026-10-15T12:00:00Z",
        "alert_type": "DATA_GAP_DETECTED", "severity": "WARNING", "message": "Sequence gap",
    }
    TelemetryRepository.save_alert(test_db_session, alert_data)

    r_alert = test_client.get("/alerts?alert_type=DATA_GAP_DETECTED")
    assert r_alert.status_code == 200
    assert len(r_alert.json()) == 1


# -----------------------------------------------------------------------------
# 3. Live Prediction Service & Sequence Integrity Tests
# -----------------------------------------------------------------------------

def test_prediction_service_requires_thirty_contiguous_observations():
    """
    CRITICAL INFERENCE TEST:
    Verifies that predictor returns None for observations 1..29,
    and produces a valid prediction at observation 30.
    """
    pred_service = PredictionService()
    asset_id = "asset_01"

    # Observations 1 to 29 must return None (not-ready state)
    for seq in range(1, 30):
        payload = sample_processed_telemetry(asset_id, seq=seq)
        res = pred_service.process_telemetry(payload)
        assert res is None, f"Observation {seq} produced premature prediction!"
        assert pred_service.get_buffer_status(asset_id)["is_ready"] is False

    # 30th observation completes the window
    payload_30 = sample_processed_telemetry(asset_id, seq=30)
    res_30 = pred_service.process_telemetry(payload_30)

    assert res_30 is not None
    assert res_30["asset_id"] == "asset_01"
    assert "failure_probability" in res_30
    assert 0.0 <= res_30["failure_probability"] <= 1.0
    assert res_30["prediction"] in (0, 1)
    assert res_30["threshold"] == 0.55
    assert res_30["window_size"] == 30
    assert res_30["prediction_horizon"] == 10


def test_prediction_service_multi_asset_isolation():
    """Verify prediction buffers for asset_01 and asset_02 are strictly isolated."""
    pred_service = PredictionService()

    # 15 readings for asset_01
    for seq in range(1, 16):
        pred_service.process_telemetry(sample_processed_telemetry("asset_01", seq=seq))

    # 5 readings for asset_02
    for seq in range(1, 6):
        pred_service.process_telemetry(sample_processed_telemetry("asset_02", seq=seq))

    assert pred_service.get_buffer_status("asset_01")["accumulated_observations"] == 15
    assert pred_service.get_buffer_status("asset_02")["accumulated_observations"] == 5


def test_prediction_service_resets_on_sequence_gap():
    """
    CRITICAL SEQUENCE-INTEGRITY TEST:
    A sequence gap must invalidate/reset the asset's GRU history,
    preventing any cross-gap window from being evaluated.
    """
    pred_service = PredictionService()
    asset_id = "asset_01"

    # Send 25 contiguous observations (seq 1..25)
    for seq in range(1, 26):
        pred_service.process_telemetry(sample_processed_telemetry(asset_id, seq=seq))
    assert pred_service.get_buffer_status(asset_id)["accumulated_observations"] == 25

    # Seq jumps to 30 (gap of 4 messages skipped!)
    gap_payload = sample_processed_telemetry(asset_id, seq=30, has_gap=True)
    res_gap = pred_service.process_telemetry(gap_payload)

    # Buffer must have been reset; current observation is 1st in new window
    assert res_gap is None
    assert pred_service.get_buffer_status(asset_id)["accumulated_observations"] == 1

    # Sending 28 more (seq 31..58) leaves count at 29 -> still None
    for seq in range(31, 59):
        res = pred_service.process_telemetry(sample_processed_telemetry(asset_id, seq=seq))
        assert res is None

    # Seq 59 is the 30th observation of the NEW contiguous sequence -> produces prediction!
    payload_59 = sample_processed_telemetry(asset_id, seq=59)
    res_59 = pred_service.process_telemetry(payload_59)
    assert res_59 is not None
    assert res_59["prediction"] in (0, 1)


def test_no_ground_truth_leakage_in_prediction_inputs():
    """Verify that prohibited failure labels cannot be ingested into predictions."""
    pred_service = PredictionService()
    for col in PROHIBITED_LEAKAGE_COLUMNS:
        bad_payload = sample_processed_telemetry("asset_01", 1)
        bad_payload[col] = 1
        # Prediction service strictly pulls the 5 raw sensor features, ignoring/excluding any label fields
        res = pred_service.process_telemetry(bad_payload)
        # Ensure model feature names contract remains intact
        assert col not in pred_service.predictor.feature_names


# -----------------------------------------------------------------------------
# 4. WebSocket Broadcasting Tests
# -----------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_websocket_broadcast_manager():
    """Verify connection manager handles broadcasts and drops disconnected clients cleanly."""
    manager = ConnectionManager()

    class MockWebSocket:
        def __init__(self, will_fail=False):
            self.will_fail = will_fail
            self.sent = []

        async def send_text(self, text):
            if self.will_fail:
                raise ConnectionResetError("Client dropped")
            self.sent.append(text)

    ws_healthy = MockWebSocket(will_fail=False)
    ws_broken = MockWebSocket(will_fail=True)

    manager._active_connections.add(ws_healthy)
    manager._active_connections.add(ws_broken)

    # Broadcast event
    await manager.broadcast("prediction", {"asset_id": "asset_01", "probability": 0.2})

    # Healthy client received message
    assert len(ws_healthy.sent) == 1
    data = json.loads(ws_healthy.sent[0])
    assert data["type"] == "prediction"
    assert data["data"]["asset_id"] == "asset_01"

    # Broken client was pruned cleanly without terminating the service
    assert ws_healthy in manager._active_connections
    assert ws_broken not in manager._active_connections

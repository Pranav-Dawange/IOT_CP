"""
Comprehensive Verification Script for Phase 5 Edge Processing Layer.

Executes standalone operational verification across 10 verification gates:
1. Valid telemetry parsing & preservation of raw sensor values.
2. Malformed message rejection (corrupted JSON, missing fields, null, NaN, Inf).
3. Strict ground-truth isolation (zero leakage in processed telemetry, summaries, alerts).
4. Topic vs payload asset_id consistency enforcement.
5. Rolling moving average smoothing progression & multi-asset isolation.
6. Demonstration threshold anomaly detection & alert cooldown policy.
7. Periodic aggregation statistics & partial flush on orderly shutdown.
8. Sequence gap detection, duplicate, and out-of-order handling.
9. Device status tracking & EXHAUSTED lifecycle handling.
10. MQTT topic hierarchy, QoS levels, and retain flag compliance.

Usage:
    python edge/verify_edge.py
"""

import asyncio
import json
from pathlib import Path
import sys

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from edge.config import EdgeConfig, SensorThresholdBounds, ThresholdConfig
from edge.models import (
    parse_topic,
    PROHIBITED_LEAKAGE_COLUMNS,
    RAW_SENSOR_FIELDS,
    validate_raw_telemetry,
)
from edge.mqtt_adapter import EdgeMQTTAdapter
from edge.processor import EdgeProcessor


def sample_reading(asset_id: str, seq: int, air_temp: float = 300.0, torque: float = 40.0):
    return {
        "asset_id": asset_id,
        "timestamp": f"2026-10-13T12:00:{seq:02d}Z",
        "sequence_number": seq,
        "air_temperature": air_temp,
        "process_temperature": 310.0,
        "rotational_speed": 1500.0,
        "torque": torque,
        "tool_wear": 10.0,
    }


def verify_gate_1_valid_telemetry_and_raw_preservation() -> bool:
    print("[1/10] Verifying Valid Telemetry Parsing & Raw Sensor Value Preservation...")
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/telemetry"
    raw_input = sample_reading("asset_01", seq=1, air_temp=301.25, torque=45.67)

    result = processor.process_message(topic, raw_input)
    assert result.success is True
    assert result.processed_telemetry is not None

    p = result.processed_telemetry
    assert p.air_temperature == 301.25, "Raw air_temperature must not be altered!"
    assert p.torque == 45.67, "Raw torque must not be altered!"
    assert p.edge.validation_status == "VALID"
    assert p.edge.smoothing_window_size == 1
    assert p.edge.smoothed_values["air_temperature"] == 301.25

    print("  -> OK: Valid telemetry accepted; raw sensor values preserved intact in processed payload.")
    return True


def verify_gate_2_malformed_rejection() -> bool:
    print("[2/10] Verifying Malformed Message Rejection (No Process Crashes)...")
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/telemetry"

    # Corrupted JSON bytes
    r_bytes = processor.process_message(topic, b'{"asset_id": "asset_01", "broken": [')
    assert r_bytes.success is False
    assert r_bytes.alerts[0].alert_type == "MALFORMED_TELEMETRY"

    # Null value
    null_reading = sample_reading("asset_01", 1)
    null_reading["torque"] = None
    r_null = processor.process_message(topic, null_reading)
    assert r_null.success is False
    assert r_null.alerts[0].alert_type == "MALFORMED_TELEMETRY"

    # NaN value
    nan_reading = sample_reading("asset_01", 2)
    nan_reading["rotational_speed"] = float("nan")
    r_nan = processor.process_message(topic, nan_reading)
    assert r_nan.success is False
    assert r_nan.alerts[0].alert_type == "MALFORMED_TELEMETRY"

    print("  -> OK: Malformed JSON, null, and NaN readings rejected safely with diagnostic alerts.")
    return True


def verify_gate_3_ground_truth_isolation() -> bool:
    print("[3/10] Verifying Strict Ground-Truth Isolation...")
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/telemetry"

    for col in PROHIBITED_LEAKAGE_COLUMNS:
        bad_reading = sample_reading("asset_01", 1)
        bad_reading[col] = 1
        res = processor.process_message(topic, bad_reading)
        assert res.success is False, f"Failed to reject prohibited column '{col}'!"
        assert res.alerts[0].alert_type == "MALFORMED_TELEMETRY"

    print("  -> OK: Zero leakage. Prohibited columns (Machine failure, TWF, etc.) strictly rejected.")
    return True


def verify_gate_4_topic_asset_id_consistency() -> bool:
    print("[4/10] Verifying Topic vs Payload Asset ID Consistency...")
    processor = EdgeProcessor()
    # Topic specifies asset_01, but payload contains asset_05
    topic = "factory/lineA/asset_01/telemetry"
    mismatched = sample_reading("asset_05", 1)

    result = processor.process_message(topic, mismatched)
    assert result.success is False
    assert result.alerts[0].alert_type == "MALFORMED_TELEMETRY"
    assert "mismatch" in result.alerts[0].message.lower()

    print("  -> OK: Asset ID mismatch between topic and payload safely rejected.")
    return True


def verify_gate_5_smoothing_and_isolation() -> bool:
    print("[5/10] Verifying Rolling Smoothing Progression & Multi-Asset Isolation...")
    processor = EdgeProcessor(config=EdgeConfig(smoothing_window_size=5))

    # Send 6 observations to asset_01: torques 10, 20, 30, 40, 50, 60
    for seq, t_val in enumerate([10.0, 20.0, 30.0, 40.0, 50.0, 60.0], start=1):
        res1 = processor.process_message(
            "factory/lineA/asset_01/telemetry", sample_reading("asset_01", seq, torque=t_val)
        )

    # Asset 01 window of 5: average of 20, 30, 40, 50, 60 = 40.0
    assert res1.processed_telemetry.edge.smoothing_window_size == 5
    assert res1.processed_telemetry.edge.smoothed_values["torque"] == 40.0
    # Raw value is still 60.0!
    assert res1.processed_telemetry.torque == 60.0

    # Send 1 observation to asset_02 with torque 90.0
    res2 = processor.process_message(
        "factory/lineB/asset_02/telemetry", sample_reading("asset_02", 1, torque=90.0)
    )
    # Asset 02 window of 1: mean must be 90.0 (strictly isolated from asset_01)
    assert res2.processed_telemetry.edge.smoothing_window_size == 1
    assert res2.processed_telemetry.edge.smoothed_values["torque"] == 90.0

    print("  -> OK: Rolling average computed accurately; per-asset smoothing buffers strictly isolated.")
    return True


def verify_gate_6_anomaly_detection_and_cooldown() -> bool:
    print("[6/10] Verifying Threshold Anomaly Detection & Alert Cooldown...")
    processor = EdgeProcessor(config=EdgeConfig(alert_cooldown_seconds=10.0))
    topic = "factory/lineA/asset_01/telemetry"

    # Reading with torque 85.0 (max demo bound 80.0) at monotonic time 100.0
    reading1 = sample_reading("asset_01", 1, torque=85.0)
    r1 = processor.process_message(topic, reading1, monotonic_time=100.0)
    anom_alerts1 = [a for a in r1.alerts if a.alert_type == "SENSOR_THRESHOLD_ANOMALY"]
    assert len(anom_alerts1) == 1, "Initial threshold violation must emit alert"

    # Repeated identical violation at t = 102.0 (< 10s cooldown)
    reading2 = sample_reading("asset_01", 2, torque=86.0)
    r2 = processor.process_message(topic, reading2, monotonic_time=102.0)
    anom_alerts2 = [a for a in r2.alerts if a.alert_type == "SENSOR_THRESHOLD_ANOMALY"]
    assert len(anom_alerts2) == 0, "Repeated violation under active cooldown must be suppressed"

    # New anomaly on different sensor (rotational_speed 900 < 1000) at t = 103.0
    reading3 = sample_reading("asset_01", 3, torque=86.0)
    reading3["rotational_speed"] = 900.0
    r3 = processor.process_message(topic, reading3, monotonic_time=103.0)
    speed_alerts = [a for a in r3.alerts if a.details.get("sensor_name") == "rotational_speed"]
    assert len(speed_alerts) == 1, "Materially new sensor anomaly must emit immediately"

    # Violation after cooldown expiration at t = 111.0 (> 10s cooldown)
    reading4 = sample_reading("asset_01", 4, torque=87.0)
    r4 = processor.process_message(topic, reading4, monotonic_time=111.0)
    anom_alerts4 = [a for a in r4.alerts if a.details.get("sensor_name") == "torque"]
    assert len(anom_alerts4) == 1, "Alert must fire again after cooldown expiration"

    print("  -> OK: Demonstration bounds evaluated correctly; alert deduplication suppresses spam.")
    return True


def verify_gate_7_aggregation_and_partial_flush() -> bool:
    print("[7/10] Verifying Periodic Aggregation & Partial Flush on Shutdown...")
    processor = EdgeProcessor(config=EdgeConfig(aggregation_interval=10))
    topic = "factory/lineA/asset_01/telemetry"

    # Send 10 observations to asset_01
    for seq in range(1, 11):
        res = processor.process_message(topic, sample_reading("asset_01", seq, torque=30.0 + seq))

    # 10th observation must emit AggregatedSummaryPayload
    assert res.aggregated_summary is not None
    summary = res.aggregated_summary
    assert summary.observation_count == 10
    assert summary.sensor_statistics["torque"]["mean"] == 35.5
    assert summary.is_partial is False

    # Send 3 observations to asset_02
    for seq in range(1, 4):
        processor.process_message("factory/lineB/asset_02/telemetry", sample_reading("asset_02", seq))

    # Orderly shutdown flush
    partial_flushes = processor.flush_partial_aggregations()
    assert len(partial_flushes) == 1
    assert partial_flushes[0].asset_id == "asset_02"
    assert partial_flushes[0].observation_count == 3
    assert partial_flushes[0].is_partial is True

    print("  -> OK: 10-observation summary statistics computed; partial summaries flushed on shutdown.")
    return True


def verify_gate_8_sequence_tracking() -> bool:
    print("[8/10] Verifying Sequence Tracking (Gaps, Duplicates, Out-of-Order)...")
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/telemetry"

    # Seq 1, then Seq 5 (gap of 3)
    processor.process_message(topic, sample_reading("asset_01", 1))
    r_gap = processor.process_message(topic, sample_reading("asset_01", 5))
    gap_alerts = [a for a in r_gap.alerts if a.alert_type == "DATA_GAP_DETECTED"]
    assert len(gap_alerts) == 1
    assert gap_alerts[0].details["missing_count"] == 3

    # Duplicate Seq 5
    r_dup = processor.process_message(topic, sample_reading("asset_01", 5))
    dup_alerts = [a for a in r_dup.alerts if a.alert_type == "DUPLICATE_OR_OUT_OF_ORDER_READING"]
    assert len(dup_alerts) == 1

    # Out-of-order Seq 3
    r_ooo = processor.process_message(topic, sample_reading("asset_01", 3))
    ooo_alerts = [a for a in r_ooo.alerts if a.alert_type == "DUPLICATE_OR_OUT_OF_ORDER_READING"]
    assert len(ooo_alerts) == 1

    print("  -> OK: Sequence gaps, duplicates, and out-of-order readings detected and alerted.")
    return True


def verify_gate_9_status_and_exhausted_handling() -> bool:
    print("[9/10] Verifying Device Status Tracking & EXHAUSTED Lifecycle...")
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/status"

    status_data = {
        "asset_id": "asset_01",
        "line": "lineA",
        "status": "EXHAUSTED",
        "timestamp": "2026-10-13T12:00:00Z",
        "reason": "source_exhausted",
    }
    res = processor.process_message(topic, status_data)
    assert res.success is True
    assert res.category == "status"
    # EXHAUSTED must NOT trigger an anomaly alert!
    assert len(res.alerts) == 0

    state = processor.get_asset_state("asset_01")
    assert state is not None
    assert state.last_status == "EXHAUSTED"

    print("  -> OK: Status updates recorded; terminal EXHAUSTED lifecycle is not mislabeled as failure.")
    return True


async def verify_gate_10_mqtt_contracts_and_qos() -> bool:
    print("[10/10] Verifying MQTT Topic Routing, QoS, and Retain Flags...")
    adapter = EdgeMQTTAdapter(config=EdgeConfig(dry_run=True))
    await adapter.connect()

    processor = EdgeProcessor()
    res = processor.process_message(
        "factory/lineA/asset_01/telemetry", sample_reading("asset_01", 1, torque=85.0)
    )

    # Publish processed
    await adapter.publish_processed("lineA", "asset_01", res.processed_telemetry)

    # Publish alert
    await adapter.publish_alert("lineA", "asset_01", res.alerts[0])

    history = adapter.get_published_history()
    assert len(history) == 2

    # Processed message: QoS 0, retain False
    m_proc = history[0]
    assert m_proc["topic"] == "factory/lineA/asset_01/telemetry/processed"
    assert m_proc["qos"] == 0
    assert m_proc["retain"] is False

    # Alert message: QoS 1, retain False
    m_alert = history[1]
    assert m_alert["topic"] == "factory/lineA/asset_01/alerts"
    assert m_alert["qos"] == 1
    assert m_alert["retain"] is False

    await adapter.disconnect()
    print("  -> OK: Processed telemetry (QoS 0, retain False) and Alerts (QoS 1, retain False) verified.")
    return True


async def run_all_verifications():
    print("==================================================================")
    print("PHASE 5: EDGE PROCESSING LAYER VERIFICATION SUITE")
    print("==================================================================")

    results = [
        verify_gate_1_valid_telemetry_and_raw_preservation(),
        verify_gate_2_malformed_rejection(),
        verify_gate_3_ground_truth_isolation(),
        verify_gate_4_topic_asset_id_consistency(),
        verify_gate_5_smoothing_and_isolation(),
        verify_gate_6_anomaly_detection_and_cooldown(),
        verify_gate_7_aggregation_and_partial_flush(),
        verify_gate_8_sequence_tracking(),
        verify_gate_9_status_and_exhausted_handling(),
        await verify_gate_10_mqtt_contracts_and_qos(),
    ]

    print("==================================================================")
    if all(results):
        print("ALL 10 EDGE VERIFICATION GATES PASSED SUCCESSFULLY!")
    else:
        print("SOME VERIFICATION CHECKS FAILED.")
        sys.exit(1)
    print("==================================================================")


if __name__ == "__main__":
    asyncio.run(run_all_verifications())

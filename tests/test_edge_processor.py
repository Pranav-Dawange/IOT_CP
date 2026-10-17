"""
Comprehensive Integration Test Suite for Edge Processor and MQTT Adapter (Phase 5).

Covers:
1. Valid telemetry passes validation and publishes processed telemetry.
2. Malformed JSON bytes/strings are rejected with MALFORMED_TELEMETRY alerts without crashing.
3. Missing, null, NaN, and Inf values are rejected safely.
4. Ground-truth leakage fields (Machine failure, TWF, etc.) are strictly rejected.
5. Topic asset ID must match payload asset ID.
6. Per-asset rolling moving average smoothing (1..4 available, latest 5).
7. Smoothing isolation between multiple assets.
8. Preservation of raw sensor values in processed telemetry (never replaced by smoothed values).
9. Sequence gap detection and alert emission.
10. Duplicate and out-of-order sequence number handling.
11. Device status message consumption and state tracking (EXHAUSTED is not an anomaly).
12. Concurrency and fault isolation: one asset's error does not affect other assets.
13. Topic contracts, QoS, and retain flag verification.
14. Queue overflow handling.
"""

import asyncio
import json
import pytest

from edge.config import EdgeConfig
from edge.models import (
    parse_topic,
    PROHIBITED_LEAKAGE_COLUMNS,
    RAW_SENSOR_FIELDS,
    validate_raw_telemetry,
)
from edge.mqtt_adapter import EdgeMQTTAdapter
from edge.processor import EdgeProcessor


def sample_valid_telemetry(asset_id: str = "asset_01", seq: int = 1, air_temp: float = 300.0, torque: float = 40.0):
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


def test_valid_telemetry_processed_successfully():
    """Verify valid telemetry produces processed telemetry payload with unchanged raw values."""
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/telemetry"
    raw_payload = sample_valid_telemetry("asset_01", seq=1, air_temp=299.5, torque=42.1)

    result = processor.process_message(topic, raw_payload)
    assert result.success is True
    assert result.category == "telemetry"
    assert result.processed_telemetry is not None

    p = result.processed_telemetry
    # Check original raw values are preserved intact
    assert p.air_temperature == 299.5
    assert p.torque == 42.1
    assert p.sequence_number == 1
    assert p.asset_id == "asset_01"

    # Check edge enrichment
    assert p.edge.validation_status == "VALID"
    assert p.edge.smoothing_window_size == 1
    assert p.edge.smoothed_values["air_temperature"] == 299.5


def test_malformed_json_rejected_without_crashing():
    """Verify malformed JSON bytes generate a MALFORMED_TELEMETRY alert and do not crash."""
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/telemetry"
    corrupted_bytes = b'{"asset_id": "asset_01", "torque": [BROKEN_JSON'

    result = processor.process_message(topic, corrupted_bytes)
    assert result.success is False
    assert result.processed_telemetry is None
    assert len(result.alerts) == 1
    assert result.alerts[0].alert_type == "MALFORMED_TELEMETRY"
    assert result.alerts[0].asset_id == "asset_01"


def test_missing_null_nan_inf_rejected():
    """Verify missing, null, NaN, and Inf sensor readings are safely rejected."""
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/telemetry"

    # Missing torque
    missing = sample_valid_telemetry()
    del missing["torque"]
    r1 = processor.process_message(topic, missing)
    assert r1.success is False
    assert r1.alerts[0].alert_type == "MALFORMED_TELEMETRY"

    # Null value
    null_val = sample_valid_telemetry()
    null_val["rotational_speed"] = None
    r2 = processor.process_message(topic, null_val)
    assert r2.success is False
    assert r2.alerts[0].alert_type == "MALFORMED_TELEMETRY"

    # NaN value
    nan_val = sample_valid_telemetry()
    nan_val["air_temperature"] = float("nan")
    r3 = processor.process_message(topic, nan_val)
    assert r3.success is False
    assert r3.alerts[0].alert_type == "MALFORMED_TELEMETRY"

    # Inf value
    inf_val = sample_valid_telemetry()
    inf_val["process_temperature"] = float("inf")
    r4 = processor.process_message(topic, inf_val)
    assert r4.success is False
    assert r4.alerts[0].alert_type == "MALFORMED_TELEMETRY"


def test_ground_truth_leakage_rejected():
    """Verify ground truth columns in telemetry are strictly rejected."""
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/telemetry"

    for col in PROHIBITED_LEAKAGE_COLUMNS:
        leaked = sample_valid_telemetry()
        leaked[col] = 1
        r = processor.process_message(topic, leaked)
        assert r.success is False
        assert r.alerts[0].alert_type == "MALFORMED_TELEMETRY"
        assert "Prohibited" in r.alerts[0].message


def test_payload_asset_id_mismatch_with_topic():
    """Verify payload asset_id differing from topic asset_id is rejected."""
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/telemetry"
    mismatched = sample_valid_telemetry(asset_id="asset_02")

    result = processor.process_message(topic, mismatched)
    assert result.success is False
    assert result.alerts[0].alert_type == "MALFORMED_TELEMETRY"
    assert "mismatch" in result.alerts[0].message.lower()


def test_rolling_moving_average_smoothing_progression():
    """
    Verify smoothing window progression:
    - 1 reading: mean = reading 1
    - 4 readings: mean = average of readings 1..4
    - 5 readings: mean = average of readings 1..5
    - 6th reading: evicts reading 1 and averages readings 2..6
    """
    processor = EdgeProcessor(config=EdgeConfig(smoothing_window_size=5))
    topic = "factory/lineA/asset_01/telemetry"

    # Send torque values: 10, 20, 30, 40, 50, 60
    torque_values = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0]
    results = []
    for seq, t_val in enumerate(torque_values, start=1):
        res = processor.process_message(topic, sample_valid_telemetry("asset_01", seq=seq, torque=t_val))
        results.append(res)

    # 1st reading (val=10) -> window=1, mean=10.0
    assert results[0].processed_telemetry.edge.smoothing_window_size == 1
    assert results[0].processed_telemetry.edge.smoothed_values["torque"] == 10.0

    # 4th reading (vals=10, 20, 30, 40) -> window=4, mean=25.0
    assert results[3].processed_telemetry.edge.smoothing_window_size == 4
    assert results[3].processed_telemetry.edge.smoothed_values["torque"] == 25.0

    # 5th reading (vals=10, 20, 30, 40, 50) -> window=5, mean=30.0
    assert results[4].processed_telemetry.edge.smoothing_window_size == 5
    assert results[4].processed_telemetry.edge.smoothed_values["torque"] == 30.0

    # 6th reading (vals=20, 30, 40, 50, 60) -> window=5, mean=40.0
    assert results[5].processed_telemetry.edge.smoothing_window_size == 5
    assert results[5].processed_telemetry.edge.smoothed_values["torque"] == 40.0

    # RAW VALUES PRESERVED: 6th reading's raw torque is still 60.0!
    assert results[5].processed_telemetry.torque == 60.0


def test_smoothing_isolation_between_assets():
    """Verify smoothing buffers for asset_01 and asset_02 do not influence each other."""
    processor = EdgeProcessor(config=EdgeConfig(smoothing_window_size=5))

    # Send asset_01 with torque=10.0
    r1 = processor.process_message("factory/lineA/asset_01/telemetry", sample_valid_telemetry("asset_01", seq=1, torque=10.0))
    # Send asset_02 with torque=100.0
    r2 = processor.process_message("factory/lineB/asset_02/telemetry", sample_valid_telemetry("asset_02", seq=1, torque=100.0))

    assert r1.processed_telemetry.edge.smoothed_values["torque"] == 10.0
    assert r2.processed_telemetry.edge.smoothed_values["torque"] == 100.0


def test_sequence_gap_detection():
    """Verify sequence jump produces a DATA_GAP_DETECTED alert."""
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/telemetry"

    # Seq 1
    processor.process_message(topic, sample_valid_telemetry("asset_01", seq=1))
    # Seq 2
    processor.process_message(topic, sample_valid_telemetry("asset_01", seq=2))
    # Seq 6 (gap of 3 messages: 3, 4, 5)
    r3 = processor.process_message(topic, sample_valid_telemetry("asset_01", seq=6))

    gap_alerts = [a for a in r3.alerts if a.alert_type == "DATA_GAP_DETECTED"]
    assert len(gap_alerts) == 1
    assert gap_alerts[0].details["missing_count"] == 3
    assert gap_alerts[0].details["last_sequence_number"] == 2
    assert gap_alerts[0].details["received_sequence_number"] == 6


def test_duplicate_and_out_of_order_sequence_detection():
    """Verify duplicate and out-of-order sequence numbers emit DUPLICATE_OR_OUT_OF_ORDER_READING."""
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/telemetry"

    # Seq 10
    processor.process_message(topic, sample_valid_telemetry("asset_01", seq=10))

    # Duplicate seq 10
    r_dup = processor.process_message(topic, sample_valid_telemetry("asset_01", seq=10))
    dup_alerts = [a for a in r_dup.alerts if a.alert_type == "DUPLICATE_OR_OUT_OF_ORDER_READING"]
    assert len(dup_alerts) == 1
    assert dup_alerts[0].details["type"] == "duplicate"

    # Out of order seq 8
    r_ooo = processor.process_message(topic, sample_valid_telemetry("asset_01", seq=8))
    ooo_alerts = [a for a in r_ooo.alerts if a.alert_type == "DUPLICATE_OR_OUT_OF_ORDER_READING"]
    assert len(ooo_alerts) == 1
    assert ooo_alerts[0].details["type"] == "out_of_order"


def test_status_messages_and_exhausted_handling():
    """Verify status messages update state and EXHAUSTED does not trigger an anomaly."""
    processor = EdgeProcessor()
    topic = "factory/lineA/asset_01/status"

    status_payload = {
        "asset_id": "asset_01",
        "line": "lineA",
        "status": "EXHAUSTED",
        "timestamp": "2026-10-13T12:00:00Z",
        "reason": "source_exhausted",
    }
    result = processor.process_message(topic, status_payload)
    assert result.success is True
    assert result.category == "status"
    assert len(result.alerts) == 0  # EXHAUSTED is NOT an alert/anomaly!

    state = processor.get_asset_state("asset_01")
    assert state is not None
    assert state.last_status == "EXHAUSTED"


def test_fault_isolation_across_multiple_assets():
    """Verify that an error/malformed payload on asset_01 does not impede processing asset_02."""
    processor = EdgeProcessor()

    # Asset 01 sends malformed payload
    res1 = processor.process_message("factory/lineA/asset_01/telemetry", b"BAD_PAYLOAD")
    assert res1.success is False

    # Asset 02 sends valid payload
    res2 = processor.process_message("factory/lineB/asset_02/telemetry", sample_valid_telemetry("asset_02", seq=1))
    assert res2.success is True
    assert res2.processed_telemetry.asset_id == "asset_02"


@pytest.mark.asyncio
async def test_mqtt_adapter_contracts_and_qos():
    """Verify EdgeMQTTAdapter publishes with correct topic patterns, QoS, and retain flags."""
    adapter = EdgeMQTTAdapter(config=EdgeConfig(dry_run=True))
    await adapter.connect()

    processor = EdgeProcessor()
    res = processor.process_message("factory/lineA/asset_01/telemetry", sample_valid_telemetry("asset_01", seq=1))

    # Publish processed
    await adapter.publish_processed("lineA", "asset_01", res.processed_telemetry)

    # Publish alert
    alert = res.alerts[0] if res.alerts else processor.anomaly_detector.create_anomaly_alert("lineA", {
        "asset_id": "asset_01", "sensor_name": "torque", "observed_value": 90.0,
        "bound_type": "max", "bound_value": 80.0, "severity": "WARNING"
    })
    await adapter.publish_alert("lineA", "asset_01", alert)

    history = adapter.get_published_history()
    assert len(history) == 2

    # Check processed message: QoS 0, retain False
    m_proc = next(m for m in history if m["topic"].endswith("/telemetry/processed"))
    assert m_proc["qos"] == 0
    assert m_proc["retain"] is False

    # Check alert message: QoS 1, retain False
    m_alert = next(m for m in history if m["topic"].endswith("/alerts"))
    assert m_alert["qos"] == 1
    assert m_alert["retain"] is False


@pytest.mark.asyncio
async def test_queue_overflow_handling():
    """Verify queue overflow drops message and increments dropped counter without crashing."""
    adapter = EdgeMQTTAdapter(config=EdgeConfig(dry_run=True, max_queue_size=2))
    await adapter.connect()

    # Fill queue to capacity (2 items)
    await adapter.inject_message("topic1", "data1")
    await adapter.inject_message("topic2", "data2")
    assert adapter.incoming_queue.full() is True

    # 3rd item triggers overflow handling
    await adapter.inject_message("topic3", "data3")
    assert adapter.dropped_messages_count == 1

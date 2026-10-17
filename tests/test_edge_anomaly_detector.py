"""
Unit Test Suite for Edge Anomaly Detector (Phase 5).

Covers:
1. Normal values inside bounds generate zero anomalies.
2. Out-of-bounds low/high values generate SENSOR_THRESHOLD_ANOMALY.
3. Demonstration thresholds are fully configurable.
4. Alert cooldown policy suppresses repeated identical alerts.
5. Materially new anomalies (different sensor or opposite bound) pass immediately.
6. Cooldown expiration restores alert emission.
7. Explicit terminology: SENSOR_THRESHOLD_ANOMALY (not confirmed failure/prediction).
"""

import pytest

from edge.anomaly_detector import EdgeAnomalyDetector
from edge.config import SensorThresholdBounds, ThresholdConfig


def test_normal_telemetry_generates_zero_anomalies():
    """Verify readings well within normal demonstration bounds produce zero anomalies."""
    detector = EdgeAnomalyDetector()
    reading = {
        "asset_id": "asset_01",
        "timestamp": "2026-10-13T12:00:00Z",
        "air_temperature": 300.0,
        "process_temperature": 310.0,
        "rotational_speed": 1500.0,
        "torque": 40.0,
        "tool_wear": 50.0,
    }
    anomalies = detector.evaluate_reading(reading)
    assert len(anomalies) == 0


def test_out_of_bounds_sensor_generates_classified_anomaly():
    """Verify values exceeding maximum or falling below minimum generate correct anomaly records."""
    detector = EdgeAnomalyDetector()
    # Torque is 85.0 (max demo bound is 80.0), speed is 950.0 (min demo bound is 1000.0)
    reading = {
        "asset_id": "asset_01",
        "timestamp": "2026-10-13T12:00:00Z",
        "air_temperature": 300.0,
        "process_temperature": 310.0,
        "rotational_speed": 950.0,
        "torque": 85.0,
        "tool_wear": 50.0,
    }
    anomalies = detector.evaluate_reading(reading)
    assert len(anomalies) == 2

    # Check torque anomaly
    torque_anom = next(a for a in anomalies if a["sensor_name"] == "torque")
    assert torque_anom["bound_type"] == "max"
    assert torque_anom["observed_value"] == 85.0
    assert torque_anom["bound_value"] == 80.0
    assert torque_anom["alert_type"] == "SENSOR_THRESHOLD_ANOMALY"

    # Check rotational speed anomaly
    speed_anom = next(a for a in anomalies if a["sensor_name"] == "rotational_speed")
    assert speed_anom["bound_type"] == "min"
    assert speed_anom["observed_value"] == 950.0
    assert speed_anom["bound_value"] == 1000.0
    assert speed_anom["alert_type"] == "SENSOR_THRESHOLD_ANOMALY"


def test_custom_configurable_thresholds():
    """Verify detector respects custom configurable threshold bounds."""
    custom_thresholds = ThresholdConfig(
        air_temperature=SensorThresholdBounds(minimum=290.0, maximum=302.0),
        torque=SensorThresholdBounds(minimum=10.0, maximum=50.0),
    )
    detector = EdgeAnomalyDetector(thresholds=custom_thresholds)

    # 303.0 exceeds custom air_temperature max (302.0), but is within default max (306.0)
    reading = {
        "asset_id": "asset_02",
        "timestamp": "2026-10-13T12:00:00Z",
        "air_temperature": 303.0,
        "process_temperature": 310.0,
        "rotational_speed": 1500.0,
        "torque": 40.0,
        "tool_wear": 50.0,
    }
    anomalies = detector.evaluate_reading(reading)
    assert len(anomalies) == 1
    assert anomalies[0]["sensor_name"] == "air_temperature"
    assert anomalies[0]["bound_value"] == 302.0


def test_alert_cooldown_deduplication():
    """Verify repeated identical anomalies are suppressed during active cooldown."""
    detector = EdgeAnomalyDetector(cooldown_seconds=10.0)

    # First occurrence at t = 100.0 -> should emit
    assert detector.should_emit_alert("asset_01", "torque", "max", current_monotonic_time=100.0) is True

    # Immediate duplicate at t = 101.0 -> suppressed under cooldown
    assert detector.should_emit_alert("asset_01", "torque", "max", current_monotonic_time=101.0) is False

    # Second check at t = 105.0 -> still suppressed
    assert detector.should_emit_alert("asset_01", "torque", "max", current_monotonic_time=105.0) is False

    # Check at t = 110.5 (> 10s cooldown) -> allowed again
    assert detector.should_emit_alert("asset_01", "torque", "max", current_monotonic_time=110.5) is True


def test_cooldown_permits_materially_new_anomalies():
    """Verify different sensors or opposite bounds are not blocked by another sensor's cooldown."""
    detector = EdgeAnomalyDetector(cooldown_seconds=10.0)

    # Torque max alert emitted at t = 100.0
    assert detector.should_emit_alert("asset_01", "torque", "max", current_monotonic_time=100.0) is True

    # Rotational speed min alert at t = 101.0 should emit immediately (different sensor)
    assert detector.should_emit_alert("asset_01", "rotational_speed", "min", current_monotonic_time=101.0) is True

    # Torque min alert at t = 102.0 should emit immediately (different bound)
    assert detector.should_emit_alert("asset_01", "torque", "min", current_monotonic_time=102.0) is True

    # Asset 2 torque max alert at t = 103.0 should emit immediately (different asset)
    assert detector.should_emit_alert("asset_02", "torque", "max", current_monotonic_time=103.0) is True


def test_alert_payload_generation_and_terminology():
    """Verify generated alert payload uses SENSOR_THRESHOLD_ANOMALY terminology."""
    detector = EdgeAnomalyDetector()
    anomaly = {
        "sensor_name": "air_temperature",
        "observed_value": 308.5,
        "bound_type": "max",
        "bound_value": 306.0,
        "severity": "WARNING",
        "timestamp": "2026-10-13T12:00:00Z",
        "asset_id": "asset_01",
        "alert_type": "SENSOR_THRESHOLD_ANOMALY",
        "description": "Sensor air_temperature exceeded demonstration maximum",
    }
    alert = detector.create_anomaly_alert(line="lineA", anomaly=anomaly)
    d = alert.to_dict()

    assert d["alert_type"] == "SENSOR_THRESHOLD_ANOMALY"
    assert d["asset_id"] == "asset_01"
    assert d["line"] == "lineA"
    assert d["source"] == "edge"
    assert "details" in d
    assert d["details"]["sensor_name"] == "air_temperature"

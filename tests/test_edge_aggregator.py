"""
Unit Test Suite for Edge Aggregator (Phase 5).

Covers:
1. Buffers observations until interval (default 10) is reached.
2. Correctly calculates mean, minimum, and maximum for each of the 5 raw sensors.
3. Multi-asset isolation: observations from asset_01 and asset_02 never mix.
4. Partial interval flushing on orderly shutdown (is_partial=True).
5. Ground-truth leakage prevention in summary payload.
"""

import pytest

from edge.aggregator import EdgeAggregator
from edge.models import PROHIBITED_LEAKAGE_COLUMNS, RAW_SENSOR_FIELDS


def make_sample_reading(asset_id: str, seq: int, air_temp: float = 300.0, torque: float = 40.0):
    return {
        "asset_id": asset_id,
        "timestamp": f"2026-10-13T12:00:{seq:02d}Z",
        "sequence_number": seq,
        "air_temperature": air_temp,
        "process_temperature": 310.0,
        "rotational_speed": 1500.0,
        "torque": torque,
        "tool_wear": 20.0 + seq,
    }


def test_aggregator_buffers_until_interval():
    """Verify aggregator returns None for observations 1..9, and emits summary at observation 10."""
    agg = EdgeAggregator(interval=10)

    for i in range(1, 10):
        reading = make_sample_reading("asset_01", i)
        summary = agg.add_observation(reading, line="lineA")
        assert summary is None
        assert agg.get_buffer_count("asset_01") == i

    # 10th observation triggers emission
    reading_10 = make_sample_reading("asset_01", 10)
    summary_10 = agg.add_observation(reading_10, line="lineA", anomaly_count=1, gap_count=0)
    assert summary_10 is not None
    assert summary_10.observation_count == 10
    assert summary_10.asset_id == "asset_01"
    assert summary_10.line == "lineA"
    assert summary_10.is_partial is False
    assert agg.get_buffer_count("asset_01") == 0


def test_aggregator_statistics_accuracy():
    """Verify calculation of mean, min, and max across 10 observations."""
    agg = EdgeAggregator(interval=10)

    # Torque varying from 31.0 to 40.0
    for i in range(1, 11):
        reading = make_sample_reading("asset_01", i, air_temp=300.0, torque=30.0 + i)
        summary = agg.add_observation(reading, line="lineA")

    assert summary is not None
    stats = summary.sensor_statistics["torque"]
    assert stats["min"] == 31.0
    assert stats["max"] == 40.0
    assert stats["mean"] == 35.5  # average of 31..40 is 35.5


def test_aggregator_multi_asset_isolation():
    """Verify observations from asset_01 and asset_02 are tracked in strictly separate windows."""
    agg = EdgeAggregator(interval=10)

    # 7 observations for asset_01
    for i in range(1, 8):
        agg.add_observation(make_sample_reading("asset_01", i, torque=10.0), line="lineA")

    # 5 observations for asset_02
    for i in range(1, 6):
        agg.add_observation(make_sample_reading("asset_02", i, torque=50.0), line="lineB")

    assert agg.get_buffer_count("asset_01") == 7
    assert agg.get_buffer_count("asset_02") == 5

    # 3 more for asset_01 -> triggers asset_01 summary
    for i in range(8, 11):
        summary_01 = agg.add_observation(make_sample_reading("asset_01", i, torque=10.0), line="lineA")

    assert summary_01 is not None
    assert summary_01.asset_id == "asset_01"
    assert summary_01.observation_count == 10
    assert summary_01.sensor_statistics["torque"]["mean"] == 10.0

    # asset_02 buffer must still be untouched at 5 observations
    assert agg.get_buffer_count("asset_02") == 5


def test_flush_partial_aggregations_on_shutdown():
    """Verify flush_all emits partial summaries (is_partial=True) without dropping data."""
    agg = EdgeAggregator(interval=10)

    # 4 observations for asset_01
    for i in range(1, 5):
        agg.add_observation(make_sample_reading("asset_01", i), line="lineA")

    # 3 observations for asset_02
    for i in range(1, 4):
        agg.add_observation(make_sample_reading("asset_02", i), line="lineB")

    flushed = agg.flush_all()
    assert len(flushed) == 2

    s1 = next(s for s in flushed if s.asset_id == "asset_01")
    assert s1.observation_count == 4
    assert s1.is_partial is True

    s2 = next(s for s in flushed if s.asset_id == "asset_02")
    assert s2.observation_count == 3
    assert s2.is_partial is True

    # Buffer must be empty after flush
    assert agg.get_buffer_count("asset_01") == 0
    assert agg.get_buffer_count("asset_02") == 0


def test_summary_payload_ground_truth_isolation():
    """Verify summary payload contains zero ground-truth columns."""
    agg = EdgeAggregator(interval=2)
    agg.add_observation(make_sample_reading("asset_01", 1), line="lineA")
    summary = agg.add_observation(make_sample_reading("asset_01", 2), line="lineA")

    assert summary is not None
    d = summary.to_dict()
    for col in PROHIBITED_LEAKAGE_COLUMNS:
        assert col not in d

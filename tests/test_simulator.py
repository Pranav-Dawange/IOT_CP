"""
Unit and Integration Test Suite for Phase 4 Industrial IoT Simulator.

Covers:
1. Exact mapping of 20 synthetic assets to 20 non-overlapping 500-row contiguous slices (0..9999).
2. Synthetic trajectory semantics & metadata separation.
3. Monotonic cursor and sequence advancement during dropout (no replay, observable gaps).
4. Multi-device concurrency and independence (dropout on one device never blocks others).
5. Source exhaustion behavior (stops after 500 rows, emits EXHAUSTED, no replay unless loop=True).
6. Explicit fault injection (missing_field, wrong_type, null_value, corrupted_json without silent repair).
"""

import asyncio
import json
from pathlib import Path
import pytest

from simulator.connectivity import ConnectivityManager
from simulator.device import SimulatedDevice
from simulator.models import (
    AssetConfig,
    ConnectivityState,
    FaultInjectionConfig,
    LifecycleState,
    TelemetryPayload,
)
from simulator.mqtt_client import AsyncMQTTTransport
from simulator.registry import build_default_assets_registry, DeviceRegistry
from simulator.sensor_generator import SensorDataGenerator


# -----------------------------------------------------------------------------
# 1. Device Registry & Asset Mapping Tests
# -----------------------------------------------------------------------------

def test_registry_has_exact_twenty_assets():
    """Verify registry contains exactly 20 assets named asset_01 to asset_20."""
    registry = DeviceRegistry()
    registry.validate_registry_integrity()
    assets = registry.get_all_assets()
    assert len(assets) == 20
    expected_ids = [f"asset_{i:02d}" for i in range(1, 21)]
    assert [a.asset_id for a in assets] == expected_ids


def test_registry_contiguous_non_overlapping_500_row_slices():
    """Verify each asset has exactly 500 contiguous rows covering 0..9999 with zero overlaps."""
    registry = DeviceRegistry()
    assets = registry.get_all_assets()

    current_expected = 0
    for idx, asset in enumerate(assets):
        assert asset.source_row_start == current_expected
        assert asset.source_row_end == current_expected + 499
        assert asset.total_source_rows == 500
        current_expected += 500

    assert current_expected == 10000


def test_registry_metadata_and_line_distribution():
    """Verify synthetic assets are distributed across 4 production lines with simulated metadata."""
    registry = DeviceRegistry()
    for line in ["lineA", "lineB", "lineC", "lineD"]:
        line_assets = registry.get_assets_by_line(line)
        assert len(line_assets) == 5
        for asset in line_assets:
            assert asset.line == line
            assert asset.asset_type in ["motor", "pump", "compressor", "spindle_drive"]
            assert "Cell-" in asset.location


# -----------------------------------------------------------------------------
# 2. Sensor Data Generator & Chronological Ordering Tests
# -----------------------------------------------------------------------------

def test_sensor_generator_slice_and_chronology():
    """Verify sensor data generator loads exact slice and preserves CSV row order."""
    generator = SensorDataGenerator(
        asset_id="asset_01",
        source_row_start=0,
        source_row_end=499,
        fault_config=FaultInjectionConfig(noise_enabled=False),
    )
    assert len(generator.raw_sensor_data) == 500
    assert generator.raw_sensor_data.shape[1] == 5

    # Local cursor 0 corresponds to global row 0
    reading = generator.generate_valid_reading(local_cursor=0, sequence_number=1, timestamp="2026-10-10T12:00:00Z")
    assert isinstance(reading, TelemetryPayload)
    assert reading.sequence_number == 1
    assert reading.asset_id == "asset_01"


def test_sensor_generator_exhaustion_boundary():
    """Verify generator raises IndexError when cursor reaches or exceeds 500."""
    generator = SensorDataGenerator(
        asset_id="asset_01",
        source_row_start=0,
        source_row_end=499,
        fault_config=FaultInjectionConfig(noise_enabled=False),
    )
    assert not generator.is_exhausted(499)
    assert generator.is_exhausted(500)
    with pytest.raises(IndexError):
        generator.generate_valid_reading(local_cursor=500, sequence_number=501, timestamp="2026-10-10T12:00:00Z")


# -----------------------------------------------------------------------------
# 3. Explicit Fault Injection Tests (No Silent Repair)
# -----------------------------------------------------------------------------

def test_fault_injection_missing_field():
    """Verify missing_field injection omits a mandatory feature and fails schema parse."""
    generator = SensorDataGenerator(
        asset_id="asset_01",
        source_row_start=0,
        source_row_end=499,
        fault_config=FaultInjectionConfig(noise_enabled=False),
    )
    malformed = generator.generate_malformed_reading(
        local_cursor=10, sequence_number=11, timestamp="2026-10-10T12:00:00Z", specific_fault="missing_field"
    )
    assert isinstance(malformed, dict)
    assert "_fault_injected" in malformed
    # Must fail TelemetryPayload validation
    with pytest.raises(ValueError, match="missing required fields"):
        TelemetryPayload.from_dict(malformed)


def test_fault_injection_wrong_type():
    """Verify wrong_type injection substitutes string for float and fails schema parse."""
    generator = SensorDataGenerator(
        asset_id="asset_01",
        source_row_start=0,
        source_row_end=499,
        fault_config=FaultInjectionConfig(noise_enabled=False),
    )
    malformed = generator.generate_malformed_reading(
        local_cursor=10, sequence_number=11, timestamp="2026-10-10T12:00:00Z", specific_fault="wrong_type"
    )
    assert isinstance(malformed, dict)
    with pytest.raises(TypeError, match="must be numeric"):
        TelemetryPayload.from_dict(malformed)


def test_fault_injection_null_value():
    """Verify null_value injection puts None in a numeric field and fails schema parse."""
    generator = SensorDataGenerator(
        asset_id="asset_01",
        source_row_start=0,
        source_row_end=499,
        fault_config=FaultInjectionConfig(noise_enabled=False),
    )
    malformed = generator.generate_malformed_reading(
        local_cursor=10, sequence_number=11, timestamp="2026-10-10T12:00:00Z", specific_fault="null_value"
    )
    assert isinstance(malformed, dict)
    with pytest.raises(TypeError, match="must be numeric"):
        TelemetryPayload.from_dict(malformed)


def test_fault_injection_corrupted_json():
    """Verify corrupted_json produces invalid unparseable bytes."""
    generator = SensorDataGenerator(
        asset_id="asset_01",
        source_row_start=0,
        source_row_end=499,
        fault_config=FaultInjectionConfig(noise_enabled=False),
    )
    malformed = generator.generate_malformed_reading(
        local_cursor=10, sequence_number=11, timestamp="2026-10-10T12:00:00Z", specific_fault="corrupted_json"
    )
    assert isinstance(malformed, bytes)
    # Must fail JSON decoding
    with pytest.raises(json.JSONDecodeError):
        json.loads(malformed.decode("utf-8"))


# -----------------------------------------------------------------------------
# 4. Monotonic Cursor & Sequence Number Advancement During Dropout (No Replay)
# -----------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cursor_and_sequence_advancement_during_dropout():
    """
    CRITICAL TEST:
    Advance cursor and sequence number during disconnected ticks.
    Skipped rows are NEVER replayed; sequence gap is observable upon reconnection.
    """
    transport = AsyncMQTTTransport(dry_run=True)
    await transport.connect()

    config = AssetConfig(
        asset_id="asset_01",
        line="lineA",
        sampling_interval_ms=10,
        source_row_start=0,
        source_row_end=499,
    )
    fault_config = FaultInjectionConfig(
        noise_enabled=False,
        dropout_probability=0.0,  # Controlled manually
        malformed_probability=0.0,
    )
    device = SimulatedDevice(
        config=config,
        transport=transport,
        fault_config=fault_config,
    )

    # Tick 1: ONLINE -> sequence 1, cursor 0
    t1 = await device.tick()
    assert t1["published"] is True
    assert t1["sequence_number"] == 1
    assert t1["cursor"] == 0

    # Tick 2: ONLINE -> sequence 2, cursor 1
    t2 = await device.tick()
    assert t2["published"] is True
    assert t2["sequence_number"] == 2
    assert t2["cursor"] == 1

    # Induce manual network dropout for 3 ticks
    device.connectivity_manager.force_disconnect(duration_ticks=3)

    # Tick 3: DISCONNECTED -> sequence 3, cursor 2 (telemetry suppressed)
    t3 = await device.tick()
    assert t3["published"] is False
    assert t3["sequence_number"] == 3
    assert t3["cursor"] == 2

    # Tick 4: DISCONNECTED -> sequence 4, cursor 3 (telemetry suppressed)
    t4 = await device.tick()
    assert t4["published"] is False
    assert t4["sequence_number"] == 4
    assert t4["cursor"] == 3

    # Tick 5: RECONNECTING -> sequence 5, cursor 4 (telemetry still suppressed during reconnection attempt)
    t5 = await device.tick()
    assert t5["published"] is False
    assert t5["sequence_number"] == 5
    assert t5["cursor"] == 4

    # Tick 6: Auto-reconnects to ONLINE -> sequence 6, cursor 5
    t6 = await device.tick()
    assert t6["published"] is True
    assert t6["sequence_number"] == 6
    assert t6["cursor"] == 5
    # Sequence number jumped from 2 to 6, rows 2..4 were skipped and NOT replayed!
    assert t6["payload"]["sequence_number"] == 6

    # Verify published telemetry history contains gap: seq 1, seq 2, then seq 6
    history = transport.get_published_history()
    telemetry_msgs = [m for m in history if m["topic"].endswith("/telemetry")]
    seq_nums = [m["payload_repr"]["sequence_number"] for m in telemetry_msgs]
    assert seq_nums == [1, 2, 6]


# -----------------------------------------------------------------------------
# 5. Multi-Device Concurrency & Isolation Tests
# -----------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_multi_device_isolation_during_dropout():
    """Verify network dropout on device 1 does not impede, delay, or affect device 2."""
    transport = AsyncMQTTTransport(dry_run=True)
    await transport.connect()

    cfg1 = AssetConfig(asset_id="asset_01", line="lineA", source_row_start=0, source_row_end=499)
    cfg2 = AssetConfig(asset_id="asset_02", line="lineA", source_row_start=500, source_row_end=999)

    fault1 = FaultInjectionConfig(noise_enabled=False, dropout_probability=0.0, malformed_probability=0.0)
    fault2 = FaultInjectionConfig(noise_enabled=False, dropout_probability=0.0, malformed_probability=0.0)

    dev1 = SimulatedDevice(config=cfg1, transport=transport, fault_config=fault1)
    dev2 = SimulatedDevice(config=cfg2, transport=transport, fault_config=fault2)

    # Disconnect dev1, keep dev2 online
    dev1.connectivity_manager.force_disconnect(duration_ticks=10)

    # Run 3 sequential ticks on each device, concurrently across devices
    async def run_device_ticks(dev, tick_count):
        ticks = []
        for _ in range(tick_count):
            ticks.append(await dev.tick())
        return ticks

    dev1_ticks, dev2_ticks = await asyncio.gather(
        run_device_ticks(dev1, 3),
        run_device_ticks(dev2, 3),
    )

    # dev1 should have suppressed all 3 ticks
    assert all(t["published"] is False for t in dev1_ticks)
    assert dev1.sequence_number == 4

    # dev2 should have published all 3 ticks with sequential sequence numbers
    assert all(t["published"] is True for t in dev2_ticks)
    assert [t["sequence_number"] for t in dev2_ticks] == [1, 2, 3]
    assert dev2.sequence_number == 4


# -----------------------------------------------------------------------------
# 6. Source Exhaustion Tests
# -----------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_source_exhaustion_halts_and_emits_status():
    """
    Verify device exhausts after consuming all source rows:
    - Transitions to LifecycleState.EXHAUSTED
    - Emits StatusPayload with status='EXHAUSTED'
    - Halts further ticks
    """
    transport = AsyncMQTTTransport(dry_run=True)
    await transport.connect()

    # Create a small slice of 3 rows for fast exhaustion testing
    cfg = AssetConfig(asset_id="asset_01", line="lineA", source_row_start=0, source_row_end=2)
    fault = FaultInjectionConfig(noise_enabled=False, dropout_probability=0.0, malformed_probability=0.0)

    device = SimulatedDevice(config=cfg, transport=transport, fault_config=fault, loop_mode=False)

    # Tick 1, 2, 3
    t1 = await device.tick()
    t2 = await device.tick()
    t3 = await device.tick()

    assert t1["published"] is True
    assert t2["published"] is True
    assert t3["published"] is True
    assert t3["exhausted"] is True
    assert device.is_exhausted is True

    # Tick 4 after exhaustion must return None and do nothing
    t4 = await device.tick()
    assert t4 is None

    # Check that status 'EXHAUSTED' was published
    history = transport.get_published_history()
    status_msgs = [m for m in history if m["topic"].endswith("/status")]
    exhausted_status = [m for m in status_msgs if m["payload_repr"].get("status") == "EXHAUSTED"]
    assert len(exhausted_status) >= 1
    assert exhausted_status[0]["payload_repr"]["reason"] == "source_exhausted"


@pytest.mark.asyncio
async def test_loop_mode_wraps_cursor_without_exhaustion():
    """Verify loop_mode=True wraps cursor back to 0 without terminating."""
    transport = AsyncMQTTTransport(dry_run=True)
    await transport.connect()

    cfg = AssetConfig(asset_id="asset_01", line="lineA", source_row_start=0, source_row_end=2)
    fault = FaultInjectionConfig(noise_enabled=False, dropout_probability=0.0, malformed_probability=0.0)

    device = SimulatedDevice(config=cfg, transport=transport, fault_config=fault, loop_mode=True)

    await device.tick()  # cursor 0
    await device.tick()  # cursor 1
    await device.tick()  # cursor 2 -> wraps local_cursor to 0

    assert not device.is_exhausted
    t4 = await device.tick()  # cursor 0 again
    assert t4["cursor"] == 0
    assert t4["sequence_number"] == 4

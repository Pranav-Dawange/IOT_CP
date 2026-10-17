"""
Comprehensive Verification Script for Phase 4 Industrial IoT Simulator.

Executes standalone end-to-end operational verification across:
1. Device Registry integrity and synthetic trajectory mapping.
2. Ground-truth failure label & identifier isolation.
3. Monotonic cursor and sequence advancement during dropout (no row replay).
4. Terminal source exhaustion and status notification.
5. Multi-device async concurrency and failure isolation.
6. Explicit fault injection (missing_field, wrong_type, null_value, corrupted_json).
7. MQTT topic hierarchy, QoS (telemetry 0, status 1, alerts 1), and retain flags.

Usage:
    python simulator/verify_simulator.py
"""

import asyncio
import json
from pathlib import Path
import sys

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from simulator.connectivity import ConnectivityManager
from simulator.device import SimulatedDevice
from simulator.models import (
    AlertPayload,
    AssetConfig,
    ConnectivityState,
    FaultInjectionConfig,
    LifecycleState,
    PROHIBITED_LEAKAGE_COLUMNS,
    RAW_SENSOR_FEATURE_NAMES,
    StatusPayload,
    TelemetryPayload,
)
from simulator.mqtt_client import AsyncMQTTTransport
from simulator.registry import DeviceRegistry
from simulator.sensor_generator import SensorDataGenerator


async def verify_registry() -> bool:
    print("[1/7] Verifying Device Registry & Synthetic Asset Mapping...")
    registry = DeviceRegistry()
    registry.validate_registry_integrity()
    assets = registry.get_all_assets()
    assert len(assets) == 20, f"Expected 20 assets, got {len(assets)}"

    current_row = 0
    for idx, asset in enumerate(assets):
        expected_id = f"asset_{idx + 1:02d}"
        assert asset.asset_id == expected_id, f"Asset ID mismatch: {asset.asset_id} vs {expected_id}"
        assert asset.source_row_start == current_row, f"Start mismatch for {asset.asset_id}"
        assert asset.source_row_end == current_row + 499, f"End mismatch for {asset.asset_id}"
        assert asset.total_source_rows == 500
        current_row += 500

    assert current_row == 10000, f"Total rows must be 10000, got {current_row}"
    print(f"  -> OK: 20 assets correctly partitioned into 20 contiguous 500-row blocks (0..9999).")
    return True


async def verify_ground_truth_isolation() -> bool:
    print("[2/7] Verifying Strict Ground-Truth & Identifier Isolation...")
    generator = SensorDataGenerator("asset_01", 0, 499, fault_config=FaultInjectionConfig(noise_enabled=False))

    # Test that emitted reading contains strictly the 5 raw sensor features and metadata
    reading = generator.generate_valid_reading(local_cursor=0, sequence_number=1, timestamp="2026-10-10T12:00:00Z")
    d = reading.to_dict()

    for col in PROHIBITED_LEAKAGE_COLUMNS:
        assert col not in d, f"SECURITY VIOLATION: Column '{col}' leaked into telemetry dictionary!"

    # Verify TelemetryPayload.from_dict rejects prohibited columns
    for col in PROHIBITED_LEAKAGE_COLUMNS:
        bad = d.copy()
        bad[col] = 1
        rejected = False
        try:
            TelemetryPayload.from_dict(bad)
        except ValueError:
            rejected = True
        assert rejected, f"Schema failed to reject prohibited column '{col}'!"

    print("  -> OK: Zero leakage. All ground-truth failure labels and dataset IDs strictly prohibited.")
    return True


async def verify_cursor_and_dropout_semantics() -> bool:
    print("[3/7] Verifying Cursor & Sequence Monotonicity with Intermittent Dropout...")
    transport = AsyncMQTTTransport(dry_run=True)
    await transport.connect()

    cfg = AssetConfig(asset_id="asset_01", line="lineA", source_row_start=0, source_row_end=499)
    fault = FaultInjectionConfig(noise_enabled=False, dropout_probability=0.0, malformed_probability=0.0)
    dev = SimulatedDevice(config=cfg, transport=transport, fault_config=fault)

    # 2 online ticks
    t1 = await dev.tick()
    t2 = await dev.tick()
    assert t1["published"] is True and t1["sequence_number"] == 1 and t1["cursor"] == 0
    assert t2["published"] is True and t2["sequence_number"] == 2 and t2["cursor"] == 1

    # Induce 3 ticks of network dropout
    dev.connectivity_manager.force_disconnect(duration_ticks=3)
    t3 = await dev.tick()  # DISCONNECTED (cursor 2, seq 3)
    t4 = await dev.tick()  # DISCONNECTED (cursor 3, seq 4)
    t5 = await dev.tick()  # RECONNECTING (cursor 4, seq 5)

    assert not t3["published"] and t3["sequence_number"] == 3 and t3["cursor"] == 2
    assert not t4["published"] and t4["sequence_number"] == 4 and t4["cursor"] == 3
    assert not t5["published"] and t5["sequence_number"] == 5 and t5["cursor"] == 4

    # Tick 6: Reconnected ONLINE (cursor 5, seq 6)
    t6 = await dev.tick()
    assert t6["published"] is True and t6["sequence_number"] == 6 and t6["cursor"] == 5

    history = transport.get_published_history()
    telem_seqs = [m["payload_repr"]["sequence_number"] for m in history if m["topic"].endswith("/telemetry")]
    assert telem_seqs == [1, 2, 6], f"Expected seqs [1, 2, 6], got {telem_seqs}"
    print("  -> OK: Cursors and sequence numbers advance monotonically during dropouts; skipped rows never replayed.")
    return True


async def verify_source_exhaustion() -> bool:
    print("[4/7] Verifying Source Exhaustion Semantics (Terminal State)...")
    transport = AsyncMQTTTransport(dry_run=True)
    await transport.connect()

    cfg = AssetConfig(asset_id="asset_01", line="lineA", source_row_start=0, source_row_end=2)
    dev = SimulatedDevice(config=cfg, transport=transport, loop_mode=False)

    t1 = await dev.tick()
    t2 = await dev.tick()
    t3 = await dev.tick()

    assert t3["exhausted"] is True
    assert dev.is_exhausted is True

    t4 = await dev.tick()
    assert t4 is None, "Exhausted device must not execute further ticks!"

    history = transport.get_published_history()
    exhausted_statuses = [
        m for m in history if m["topic"].endswith("/status") and m["payload_repr"].get("status") == "EXHAUSTED"
    ]
    assert len(exhausted_statuses) >= 1, "Status 'EXHAUSTED' was not published!"
    print("  -> OK: Device halts cleanly after assigned slice, emits terminal EXHAUSTED status, and does not restart.")
    return True


async def verify_multi_device_isolation() -> bool:
    print("[5/7] Verifying Multi-Device Concurrency & Isolation...")
    transport = AsyncMQTTTransport(dry_run=True)
    await transport.connect()

    cfg1 = AssetConfig(asset_id="asset_01", line="lineA", source_row_start=0, source_row_end=499)
    cfg2 = AssetConfig(asset_id="asset_02", line="lineA", source_row_start=500, source_row_end=999)

    dev1 = SimulatedDevice(config=cfg1, transport=transport)
    dev2 = SimulatedDevice(config=cfg2, transport=transport)

    # Force dropout on dev1 only
    dev1.connectivity_manager.force_disconnect(duration_ticks=5)

    async def run_ticks(d, n):
        return [await d.tick() for _ in range(n)]

    dev1_results, dev2_results = await asyncio.gather(run_ticks(dev1, 3), run_ticks(dev2, 3))

    assert all(not r["published"] for r in dev1_results), "Dev1 should have suppressed telemetry during dropout"
    assert all(r["published"] for r in dev2_results), "Dev2 should continue publishing independently"
    assert [r["sequence_number"] for r in dev2_results] == [1, 2, 3]

    print("  -> OK: Device 1 dropout did not impede or block Device 2 execution.")
    return True


async def verify_explicit_fault_injection() -> bool:
    print("[6/7] Verifying Explicit Fault Injection (No Silent Repair)...")
    gen = SensorDataGenerator("asset_01", 0, 499)

    # 1. missing_field
    mf = gen.generate_malformed_reading(0, 1, "2026-10-10T12:00:00Z", specific_fault="missing_field")
    assert isinstance(mf, dict) and "_fault_injected" in mf
    try:
        TelemetryPayload.from_dict(mf)
        assert False, "missing_field should have failed validation"
    except ValueError:
        pass

    # 2. wrong_type
    wt = gen.generate_malformed_reading(0, 2, "2026-10-10T12:00:00Z", specific_fault="wrong_type")
    assert isinstance(wt, dict) and "_fault_injected" in wt
    try:
        TelemetryPayload.from_dict(wt)
        assert False, "wrong_type should have failed validation"
    except TypeError:
        pass

    # 3. null_value
    nv = gen.generate_malformed_reading(0, 3, "2026-10-10T12:00:00Z", specific_fault="null_value")
    assert isinstance(nv, dict) and "_fault_injected" in nv
    try:
        TelemetryPayload.from_dict(nv)
        assert False, "null_value should have failed validation"
    except TypeError:
        pass

    # 4. corrupted_json
    cj = gen.generate_malformed_reading(0, 4, "2026-10-10T12:00:00Z", specific_fault="corrupted_json")
    assert isinstance(cj, bytes)
    try:
        json.loads(cj.decode("utf-8"))
        assert False, "corrupted_json should have failed json.loads"
    except json.JSONDecodeError:
        pass

    print("  -> OK: All 4 fault types generated properly and rejected by schema parser without silent repair.")
    return True


async def verify_topic_qos_and_transport() -> bool:
    print("[7/7] Verifying MQTT Topic Routing, QoS, and Transport Versatility...")
    transport = AsyncMQTTTransport(dry_run=True)
    await transport.connect()

    # Telemetry: QoS 0, retain False
    await transport.publish_telemetry("lineA", "asset_01", {"asset_id": "asset_01"})
    # Status: QoS 1, retain True
    await transport.publish_status("lineA", "asset_01", {"status": "ONLINE"})
    # Alert: QoS 1, retain False
    await transport.publish_alert("lineA", "asset_01", {"alert": "HIGH_TEMP"})
    # Raw bytes: corrupted JSON
    await transport.publish_telemetry("lineB", "asset_02", b"RAW_CORRUPTED_BYTES")

    hist = transport.get_published_history()
    assert hist[0]["topic"] == "factory/lineA/asset_01/telemetry" and hist[0]["qos"] == 0 and not hist[0]["retain"]
    assert hist[1]["topic"] == "factory/lineA/asset_01/status" and hist[1]["qos"] == 1 and hist[1]["retain"]
    assert hist[2]["topic"] == "factory/lineA/asset_01/alerts" and hist[2]["qos"] == 1 and not hist[2]["retain"]
    assert hist[3]["raw_payload"] == b"RAW_CORRUPTED_BYTES"

    print("  -> OK: Topic hierarchy, QoS levels, retain flags, and raw byte transports verified.")
    return True


async def run_all_verifications():
    print("==================================================================")
    print("PHASE 4: SIMULATED INDUSTRIAL DEVICES & MQTT LAYER VERIFICATION")
    print("==================================================================")

    results = [
        await verify_registry(),
        await verify_ground_truth_isolation(),
        await verify_cursor_and_dropout_semantics(),
        await verify_source_exhaustion(),
        await verify_multi_device_isolation(),
        await verify_explicit_fault_injection(),
        await verify_topic_qos_and_transport(),
    ]

    print("==================================================================")
    if all(results):
        print("ALL 7 VERIFICATION GATES PASSED SUCCESSFULLY!")
    else:
        print("SOME VERIFICATION CHECKS FAILED.")
        sys.exit(1)
    print("==================================================================")


if __name__ == "__main__":
    asyncio.run(run_all_verifications())

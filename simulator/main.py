"""
Main CLI Entrypoint for Phase 4 Industrial Simulator.

Runs concurrent simulated devices using asyncio, publishing raw sensor telemetry,
status, and alerts to an MQTT broker according to the industrial multi-asset architecture.

Usage Examples:
    # Run a single asset in dry-run mode for 5 ticks
    python simulator/main.py --assets asset_01 --dry-run --ticks 5

    # Run all 20 assets concurrently with 10x speedup
    python simulator/main.py --all --dry-run --ticks 5 --speedup 10

    # Run assets 1 to 5 against a live Mosquitto broker
    python simulator/main.py --assets asset_01,asset_02,asset_03,asset_04,asset_05 --broker-host localhost --broker-port 1883
"""

import argparse
import asyncio
import logging
from pathlib import Path
import signal
import sys

# Ensure project root is in sys.path for direct script execution
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from simulator.device import SimulatedDevice
from simulator.models import FaultInjectionConfig
from simulator.mqtt_client import AsyncMQTTTransport
from simulator.registry import DeviceRegistry

logger = logging.getLogger("simulator.main")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Phase 4 Multi-Asset Industrial IoT Simulator (AI4I Synthetic Trajectories)"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--assets",
        type=str,
        help="Comma-separated list of asset IDs to run (e.g. 'asset_01' or 'asset_01,asset_02')",
    )
    group.add_argument(
        "--all",
        action="store_true",
        help="Run all 20 configured synthetic assets concurrently",
    )

    parser.add_argument(
        "--interval-ms",
        type=int,
        default=1000,
        help="Nominal sampling interval in milliseconds (default: 1000)",
    )
    parser.add_argument(
        "--speedup",
        type=float,
        default=1.0,
        help="Simulation speedup multiplier (e.g., 10.0 runs 10x faster; default: 1.0)",
    )
    parser.add_argument(
        "--ticks",
        type=int,
        default=None,
        help="Maximum simulation ticks to execute per device (default: None, runs until exhaustion)",
    )
    parser.add_argument(
        "--loop",
        action="store_true",
        default=False,
        help="Restart synthetic trajectory from row 0 upon exhaustion (default: False, terminal EXHAUSTED)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Dry-run mode: do not connect to live MQTT broker socket, print and record publishes locally",
    )
    parser.add_argument(
        "--broker-host",
        type=str,
        default="localhost",
        help="MQTT broker hostname or IP address (default: localhost)",
    )
    parser.add_argument(
        "--broker-port",
        type=int,
        default=1883,
        help="MQTT broker port (default: 1883)",
    )
    parser.add_argument(
        "--dropout-prob",
        type=float,
        default=0.01,
        help="Probability of network dropout per tick (default: 0.01)",
    )
    parser.add_argument(
        "--malformed-prob",
        type=float,
        default=0.005,
        help="Probability of malformed payload injection per tick (default: 0.005)",
    )
    parser.add_argument(
        "--no-noise",
        action="store_true",
        default=False,
        help="Disable sensor measurement noise perturbation",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging level (default: INFO)",
    )
    return parser.parse_args()


async def run_simulation(args: argparse.Namespace) -> None:
    # Set up device registry
    registry = DeviceRegistry()
    registry.validate_registry_integrity()

    if args.all:
        selected_configs = registry.get_all_assets()
    else:
        requested_ids = [a.strip() for a in args.assets.split(",") if a.strip()]
        selected_configs = []
        for aid in requested_ids:
            try:
                cfg = registry.get_asset(aid)
                selected_configs.append(cfg)
            except KeyError:
                logger.error(f"Asset ID '{aid}' not found in registry (available: asset_01 .. asset_20)")
                sys.exit(1)

    logger.info(
        f"Starting simulator for {len(selected_configs)} asset(s): "
        f"{[c.asset_id for c in selected_configs]}"
    )
    logger.info(
        f"Configuration: interval={args.interval_ms}ms, speedup={args.speedup}x, "
        f"ticks={args.ticks or 'unlimited'}, loop={args.loop}, dry_run={args.dry_run}"
    )

    # Configure fault injection
    fault_config = FaultInjectionConfig(
        noise_enabled=not args.no_noise,
        dropout_probability=args.dropout_prob,
        malformed_probability=args.malformed_prob,
    )

    # Initialize MQTT transport
    loop = asyncio.get_running_loop()
    transport = AsyncMQTTTransport(
        broker_host=args.broker_host,
        broker_port=args.broker_port,
        client_id="ai4i_simulator_master",
        dry_run=args.dry_run,
        loop=loop,
    )

    connected = await transport.connect(timeout_sec=5.0)
    if not connected and not args.dry_run:
        logger.error(
            f"Failed to connect to MQTT broker at {args.broker_host}:{args.broker_port}. "
            "Ensure Mosquitto is running or use --dry-run."
        )
        sys.exit(1)

    # Create simulated devices
    devices: List[SimulatedDevice] = []
    for cfg in selected_configs:
        cfg.sampling_interval_ms = args.interval_ms
        dev = SimulatedDevice(
            config=cfg,
            transport=transport,
            fault_config=fault_config,
            loop_mode=args.loop,
        )
        devices.append(dev)

    # Handle OS termination signals safely across platforms
    stop_event = asyncio.Event()

    def signal_handler():
        logger.info("Shutdown signal received. Stopping simulation devices...")
        for dev in devices:
            dev.stop()
        stop_event.set()

    # Windows does not support add_signal_handler for SIGINT, so handle try/except
    try:
        if sys.platform != "win32":
            loop.add_signal_handler(signal.SIGINT, signal_handler)
            loop.add_signal_handler(signal.SIGTERM, signal_handler)
    except (NotImplementedError, RuntimeError):
        pass

    # Launch all device runner tasks concurrently
    device_tasks = [
        asyncio.create_task(dev.run(max_ticks=args.ticks, speedup=args.speedup))
        for dev in devices
    ]

    try:
        await asyncio.gather(*device_tasks)
    except asyncio.CancelledError:
        logger.info("Simulation tasks cancelled.")
    finally:
        for dev in devices:
            dev.stop()
        await transport.disconnect()

    # Print summary statistics
    history = transport.get_published_history()
    telemetry_count = sum(1 for m in history if m["topic"].endswith("/telemetry"))
    status_count = sum(1 for m in history if m["topic"].endswith("/status"))
    alert_count = sum(1 for m in history if m["topic"].endswith("/alerts"))
    exhausted_count = sum(1 for d in devices if d.is_exhausted)

    logger.info("==================================================")
    logger.info("SIMULATION EXECUTION SUMMARY")
    logger.info(f"Total devices simulated : {len(devices)}")
    logger.info(f"Devices exhausted       : {exhausted_count}")
    logger.info(f"Total published messages: {len(history)}")
    logger.info(f"  - Telemetry (QoS 0)   : {telemetry_count}")
    logger.info(f"  - Status    (QoS 1)   : {status_count}")
    logger.info(f"  - Alerts    (QoS 1)   : {alert_count}")
    logger.info("==================================================")


def main():
    args = parse_arguments()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    try:
        asyncio.run(run_simulation(args))
    except KeyboardInterrupt:
        logger.info("Simulation halted by user (KeyboardInterrupt).")


if __name__ == "__main__":
    main()

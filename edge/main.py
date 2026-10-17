"""
Main CLI Entrypoint for Phase 5 Edge Processing Layer.

Runs the edge processing event loop, consuming incoming telemetry and status streams,
performing rolling smoothing, threshold anomaly detection, periodic aggregation,
and publishing processed feeds and alerts back to MQTT.

Usage Examples:
    # Run edge processor in dry-run mode
    python edge/main.py --dry-run

    # Run connected to local Mosquitto broker
    python edge/main.py --broker-host localhost --broker-port 1883
"""

import argparse
import asyncio
import logging
from pathlib import Path
import signal
import sys

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from edge.config import EdgeConfig
from edge.mqtt_adapter import EdgeMQTTAdapter
from edge.processor import EdgeProcessor

logger = logging.getLogger("edge.main")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Phase 5 Edge Processing Service for Smart Industrial Monitoring"
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
        "--dry-run",
        action="store_true",
        default=False,
        help="Run in dry-run mode without connecting to live MQTT broker socket",
    )
    parser.add_argument(
        "--smoothing-window",
        type=int,
        default=5,
        help="Per-asset rolling moving average window size (default: 5)",
    )
    parser.add_argument(
        "--aggregation-interval",
        type=int,
        default=10,
        help="Per-asset telemetry aggregation interval count (default: 10)",
    )
    parser.add_argument(
        "--alert-cooldown",
        type=float,
        default=10.0,
        help="Cooldown period in seconds between repeated identical threshold alerts (default: 10.0)",
    )
    parser.add_argument(
        "--queue-size",
        type=int,
        default=1000,
        help="Bounded queue capacity for incoming messages (default: 1000)",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging level (default: INFO)",
    )
    return parser.parse_args()


async def run_edge_service(args: argparse.Namespace) -> None:
    config = EdgeConfig(
        broker_host=args.broker_host,
        broker_port=args.broker_port,
        dry_run=args.dry_run,
        smoothing_window_size=args.smoothing_window,
        aggregation_interval=args.aggregation_interval,
        alert_cooldown_seconds=args.alert_cooldown,
        max_queue_size=args.queue_size,
    )

    loop = asyncio.get_running_loop()
    adapter = EdgeMQTTAdapter(config=config, loop=loop)
    processor = EdgeProcessor(config=config)

    logger.info("Initializing Edge Processing Service...")
    logger.info(
        f"Settings: smoothing_window={config.smoothing_window_size}, "
        f"aggregation_interval={config.aggregation_interval}, "
        f"cooldown={config.alert_cooldown_seconds}s, queue_size={config.max_queue_size}"
    )

    connected = await adapter.connect(timeout_sec=5.0)
    if not connected and not args.dry_run:
        logger.error(
            f"Failed to connect to MQTT broker at {config.broker_host}:{config.broker_port}. "
            "Ensure Mosquitto is running or pass --dry-run."
        )
        sys.exit(1)

    logger.info("Edge Processor listening for messages on factory/+/+ topics...")

    stop_event = asyncio.Event()

    def signal_handler():
        logger.info("Shutdown signal received. Stopping edge processor...")
        stop_event.set()

    try:
        if sys.platform != "win32":
            loop.add_signal_handler(signal.SIGINT, signal_handler)
            loop.add_signal_handler(signal.SIGTERM, signal_handler)
    except (NotImplementedError, RuntimeError):
        pass

    messages_processed = 0
    summaries_published = 0
    alerts_published = 0

    try:
        while not stop_event.is_set():
            try:
                # Wait for next incoming message with short timeout to check stop_event
                topic, payload_data = await asyncio.wait_for(
                    adapter.incoming_queue.get(), timeout=1.0
                )
            except asyncio.TimeoutError:
                continue

            result = processor.process_message(topic, payload_data)
            messages_processed += 1

            line = result.line or "unknown"
            asset_id = result.asset_id or "unknown"

            # Publish processed telemetry
            if result.processed_telemetry:
                await adapter.publish_processed(line, asset_id, result.processed_telemetry)

            # Publish periodic summary
            if result.aggregated_summary:
                await adapter.publish_summary(line, asset_id, result.aggregated_summary)
                summaries_published += 1

            # Publish diagnostic alerts
            for alert in result.alerts:
                await adapter.publish_alert(alert.line, alert.asset_id, alert)
                alerts_published += 1

            adapter.incoming_queue.task_done()

    except asyncio.CancelledError:
        logger.info("Edge processor task cancelled.")
    finally:
        logger.info("Flushing partial aggregations before shutdown...")
        partial_summaries = processor.flush_partial_aggregations()
        for summary in partial_summaries:
            await adapter.publish_summary(summary.line, summary.asset_id, summary)
            summaries_published += 1
            logger.info(f"Flushed partial summary for asset '{summary.asset_id}' ({summary.observation_count} obs).")

        await adapter.disconnect()

        logger.info("==================================================")
        logger.info("EDGE PROCESSOR EXECUTION SUMMARY")
        logger.info(f"Messages processed      : {messages_processed}")
        logger.info(f"Summaries published     : {summaries_published}")
        logger.info(f"Alerts published        : {alerts_published}")
        logger.info(f"Queue overflow drops    : {adapter.dropped_messages_count}")
        logger.info("==================================================")


def main():
    args = parse_arguments()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    try:
        asyncio.run(run_edge_service(args))
    except KeyboardInterrupt:
        logger.info("Edge processor halted by user (KeyboardInterrupt).")


if __name__ == "__main__":
    main()

"""
MQTT Consumer Service for Backend Ingestion (Phase 6).

Ingests:
- 'factory/+/+/telemetry/processed'
- 'factory/+/+/telemetry/summary'
- 'factory/+/+/status'
- 'factory/+/+/alerts'

Contracts:
1. Thread-safe ingestion: Decouples Paho network callbacks from asyncio via a bounded queue.
2. Robust error & malformed handling: Rejects malformed JSON and prohibited leakage columns without crashing.
3. Database isolation: Opens and closes scoped DB sessions per batch/message.
4. Non-blocking async loop: Never blocks FastAPI's event loop.
"""

import asyncio
from datetime import datetime, timezone
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple, Union

import paho.mqtt.client as mqtt

from backend.app.config import Settings, get_settings
from backend.app.database.connection import SessionLocal
from backend.app.services.telemetry_service import TelemetryService
from edge.models import PROHIBITED_LEAKAGE_COLUMNS

logger = logging.getLogger("backend.mqtt_consumer")


def parse_backend_topic(topic: str) -> Optional[Dict[str, str]]:
    """
    Parse topics subscribed to by backend:
    - factory/{line}/{asset_id}/telemetry/processed
    - factory/{line}/{asset_id}/telemetry/summary
    - factory/{line}/{asset_id}/status
    - factory/{line}/{asset_id}/alerts
    """
    parts = topic.strip("/").split("/")
    if len(parts) == 4 and parts[0] == "factory":
        # factory/{line}/{asset_id}/{channel}
        return {"line": parts[1], "asset_id": parts[2], "channel": parts[3]}
    elif len(parts) == 5 and parts[0] == "factory" and parts[3] == "telemetry":
        # factory/{line}/{asset_id}/telemetry/{subchannel}
        return {"line": parts[1], "asset_id": parts[2], "channel": f"telemetry_{parts[4]}"}
    return None


class MQTTConsumerService:
    """
    Background MQTT ingestion service feeding telemetry, summaries, status, and alerts
    into TimescaleDB and the live prediction engine.
    """

    def __init__(
        self,
        telemetry_service: TelemetryService,
        settings: Optional[Settings] = None,
        loop: Optional[asyncio.AbstractEventLoop] = None,
    ):
        self.settings = settings or get_settings()
        self.telemetry_service = telemetry_service
        self._loop = loop

        self._connected_event = asyncio.Event()
        self._stop_event = asyncio.Event()
        self._paho_client: Optional[mqtt.Client] = None
        self._is_started = False

        self.incoming_queue: asyncio.Queue[Tuple[str, bytes]] = asyncio.Queue(
            maxsize=self.settings.max_queue_size
        )
        self.worker_task: Optional[asyncio.Task] = None

        # Telemetry metrics
        self.messages_received: int = 0
        self.messages_processed: int = 0
        self.malformed_count: int = 0
        self.dropped_count: int = 0

    @property
    def is_connected(self) -> bool:
        return self._connected_event.is_set()

    async def start(self) -> bool:
        """Start the consumer background worker and connect to MQTT broker."""
        if self._loop is None:
            self._loop = asyncio.get_running_loop()

        self._stop_event.clear()
        self.worker_task = asyncio.create_task(self._process_queue_loop())

        if not self.settings.enable_mqtt_ingestion:
            logger.info("MQTT Ingestion is disabled in configuration.")
            return False

        try:
            self._paho_client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id=self.settings.mqtt_client_id,
            )
        except AttributeError:
            self._paho_client = mqtt.Client(client_id=self.settings.mqtt_client_id)

        self._paho_client.on_connect = self._on_connect
        self._paho_client.on_disconnect = self._on_disconnect
        self._paho_client.on_message = self._on_message

        try:
            self._paho_client.connect_async(
                self.settings.mqtt_host,
                self.settings.mqtt_port,
                keepalive=self.settings.mqtt_keepalive,
            )
            self._paho_client.loop_start()
            self._is_started = True

            # Wait for connection ready event with timeout
            try:
                await asyncio.wait_for(self._connected_event.wait(), timeout=3.0)
                logger.info(
                    f"MQTTConsumer connected to broker at {self.settings.mqtt_host}:{self.settings.mqtt_port}"
                )
                return True
            except asyncio.TimeoutError:
                logger.warning(
                    f"MQTTConsumer timed out connecting to {self.settings.mqtt_host}:{self.settings.mqtt_port}. "
                    "Will continue background reconnect attempts."
                )
                return False

        except Exception as e:
            logger.warning(f"Could not initiate connection to MQTT broker: {e}")
            return False

    def _on_connect(self, client: Any, userdata: Any, flags: Any, rc: Any, *args: Any) -> None:
        """Paho callback on network thread."""
        rc_code = rc.value if hasattr(rc, "value") else rc
        if rc_code == 0:
            topics = [
                (self.settings.telemetry_topic, 0),
                (self.settings.summary_topic, 0),
                (self.settings.status_topic, 1),
                (self.settings.alerts_topic, 1),
            ]
            client.subscribe(topics)
            logger.info(f"MQTTConsumer subscribed to topics: {[t[0] for t in topics]}")
            if self._loop and not self._loop.is_closed():
                self._loop.call_soon_threadsafe(self._connected_event.set)
        else:
            logger.error(f"MQTT connection refused with code {rc_code}")

    def _on_disconnect(self, client: Any, userdata: Any, rc: Any, *args: Any) -> None:
        """Paho callback on network thread."""
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._connected_event.clear)

    def _on_message(self, client: Any, userdata: Any, message: Any) -> None:
        """Enqueue incoming message thread-safely."""
        if not self._loop or self._loop.is_closed():
            return

        self.messages_received += 1
        topic = message.topic
        payload = message.payload

        def enqueue():
            if self.incoming_queue.full():
                self.dropped_count += 1
                logger.warning(
                    f"MQTTConsumer incoming queue is full! Dropped message on {topic}. "
                    f"Total dropped: {self.dropped_count}"
                )
            else:
                self.incoming_queue.put_nowait((topic, payload))

        self._loop.call_soon_threadsafe(enqueue)

    async def inject_message(self, topic: str, payload: Union[bytes, str, dict]) -> None:
        """Test utility for injecting messages directly into the queue."""
        if isinstance(payload, dict):
            raw = json.dumps(payload).encode("utf-8")
        elif isinstance(payload, str):
            raw = payload.encode("utf-8")
        else:
            raw = payload
        await self.incoming_queue.put((topic, raw))

    async def _process_queue_loop(self) -> None:
        """Background worker consuming messages from incoming_queue."""
        while not self._stop_event.is_set():
            try:
                topic, raw_payload = await asyncio.wait_for(
                    self.incoming_queue.get(), timeout=1.0
                )
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            try:
                await self._process_single_message(topic, raw_payload)
                self.messages_processed += 1
            except Exception as e:
                logger.error(f"Error processing MQTT message on topic '{topic}': {e}", exc_info=True)
            finally:
                self.incoming_queue.task_done()

    async def _process_single_message(self, topic: str, raw_payload: bytes) -> None:
        """Process and route a single message."""
        parsed_topic = parse_backend_topic(topic)
        if not parsed_topic:
            logger.warning(f"Ignored message with unhandled topic structure: {topic}")
            return

        line = parsed_topic["line"]
        asset_id = parsed_topic["asset_id"]
        channel = parsed_topic["channel"]

        # 1. Parse JSON safely
        try:
            payload_data = json.loads(raw_payload.decode("utf-8"))
        except Exception as e:
            self.malformed_count += 1
            logger.warning(f"Malformed JSON payload on topic '{topic}': {e}")
            return

        if not isinstance(payload_data, dict):
            self.malformed_count += 1
            logger.warning(f"Payload on '{topic}' is not a JSON object: {type(payload_data).__name__}")
            return

        # 2. Strict Ground-Truth Isolation Check
        for col in PROHIBITED_LEAKAGE_COLUMNS:
            if col in payload_data:
                self.malformed_count += 1
                logger.error(
                    f"SECURITY ALERT: Prohibited ground-truth leakage column '{col}' "
                    f"detected in message on '{topic}'! Discarding message."
                )
                return

        # 3. Asset ID consistency check
        payload_asset_id = payload_data.get("asset_id")
        if payload_asset_id and str(payload_asset_id) != asset_id:
            self.malformed_count += 1
            logger.warning(
                f"Asset ID mismatch between topic ('{asset_id}') and payload ('{payload_asset_id}')."
            )
            return

        # 4. Route to service with scoped DB session
        db = SessionLocal()
        try:
            if channel == "telemetry_processed":
                await self.telemetry_service.handle_processed_telemetry(db, payload_data, line=line)
            elif channel == "telemetry_summary":
                payload_data["line"] = line
                await self.telemetry_service.handle_summary(db, payload_data)
            elif channel == "status":
                payload_data["line"] = line
                await self.telemetry_service.handle_status(db, payload_data)
            elif channel == "alerts":
                payload_data["line"] = line
                await self.telemetry_service.handle_alert(db, payload_data)
        finally:
            db.close()

    async def stop(self) -> None:
        """Gracefully stop worker task and disconnect MQTT client."""
        self._stop_event.set()
        if self.worker_task and not self.worker_task.done():
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass

        if self._paho_client and self._is_started:
            try:
                self._paho_client.disconnect()
                self._paho_client.loop_stop()
            except Exception as e:
                logger.debug(f"Error during MQTT client disconnect: {e}")
            finally:
                self._is_started = False
                self._connected_event.clear()

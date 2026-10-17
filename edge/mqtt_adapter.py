"""
MQTT Transport Adapter for Phase 5 Edge Processing Layer.

RESPONSIBILITIES & CONTRACTS:
1. Subscribes to 'factory/+/+/telemetry' and 'factory/+/+/status'.
2. Decouples network I/O from asyncio using Paho's threaded network loop (loop_start/loop_stop).
3. Thread-safe incoming message dispatch to a bounded asyncio.Queue:
   handles queue overflow explicitly by dropping and recording dropped message counts.
4. Topic hierarchy and QoS routing:
   - Processed telemetry: factory/{line}/{asset_id}/telemetry/processed (QoS 0, retain False)
   - Periodic summaries:  factory/{line}/{asset_id}/telemetry/summary   (QoS 0, retain False)
   - Edge alerts:         factory/{line}/{asset_id}/alerts             (QoS 1, retain False)
5. Dry-run mode for local unit testing and standalone verification without an external broker.
"""

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional, Tuple, Union

import paho.mqtt.client as mqtt

from edge.config import EdgeConfig
from edge.models import (
    AggregatedSummaryPayload,
    EdgeAlertPayload,
    ProcessedTelemetryPayload,
)

logger = logging.getLogger("edge.mqtt")


class EdgeMQTTAdapter:
    """
    Asynchronous MQTT adapter for Edge Processor with bounded message ingestion.
    """

    def __init__(
        self,
        config: Optional[EdgeConfig] = None,
        loop: Optional[asyncio.AbstractEventLoop] = None,
    ):
        self.config = config or EdgeConfig()
        self._loop = loop
        self._connected_event = asyncio.Event()

        # Bounded incoming queue for asyncio worker
        self.incoming_queue: asyncio.Queue[Tuple[str, Union[bytes, str, dict]]] = asyncio.Queue(
            maxsize=self.config.max_queue_size
        )
        self.dropped_messages_count: int = 0

        # Dry-run / test inspection tracking
        self._published_history: List[Dict[str, Any]] = []

        self._paho_client: Optional[mqtt.Client] = None
        self._is_started = False

    @property
    def is_connected(self) -> bool:
        return self._connected_event.is_set()

    def get_published_history(self) -> List[Dict[str, Any]]:
        return list(self._published_history)

    def clear_published_history(self) -> None:
        self._published_history.clear()

    async def connect(self, timeout_sec: float = 5.0) -> bool:
        """Connect to broker and subscribe to factory telemetry and status topics."""
        if self._loop is None:
            self._loop = asyncio.get_running_loop()

        if self.config.dry_run:
            logger.info("EdgeMQTTAdapter running in DRY-RUN mode.")
            self._connected_event.set()
            self._is_started = True
            return True

        try:
            self._paho_client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id=self.config.client_id,
            )
        except AttributeError:
            self._paho_client = mqtt.Client(client_id=self.config.client_id)

        self._paho_client.on_connect = self._on_connect_callback
        self._paho_client.on_disconnect = self._on_disconnect_callback
        self._paho_client.on_message = self._on_message_callback

        try:
            self._paho_client.connect_async(
                self.config.broker_host,
                self.config.broker_port,
                keepalive=self.config.keepalive,
            )
            self._paho_client.loop_start()
            self._is_started = True

            await asyncio.wait_for(self._connected_event.wait(), timeout=timeout_sec)
            logger.info(
                f"EdgeMQTTAdapter connected to {self.config.broker_host}:{self.config.broker_port}"
            )
            return True

        except asyncio.TimeoutError:
            logger.warning(
                f"Timed out after {timeout_sec}s waiting for connection to "
                f"{self.config.broker_host}:{self.config.broker_port}."
            )
            return False
        except Exception as e:
            logger.error(f"Error connecting to MQTT broker: {e}")
            return False

    def _on_connect_callback(self, client: Any, userdata: Any, flags: Any, rc: Any, *args: Any) -> None:
        """Paho callback executed in network thread upon broker connection."""
        rc_code = rc.value if hasattr(rc, "value") else rc
        if rc_code == 0:
            # Subscribe to factory telemetry and status topics
            client.subscribe([(self.config.telemetry_topic_pattern, 0), (self.config.status_topic_pattern, 1)])
            logger.info(
                f"Subscribed to patterns: '{self.config.telemetry_topic_pattern}', "
                f"'{self.config.status_topic_pattern}'"
            )
            if self._loop and not self._loop.is_closed():
                self._loop.call_soon_threadsafe(self._connected_event.set)
        else:
            logger.error(f"MQTT connection refused with code {rc_code}")

    def _on_disconnect_callback(self, client: Any, userdata: Any, rc: Any, *args: Any) -> None:
        """Paho callback executed when connection drops."""
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._connected_event.clear)

    def _on_message_callback(self, client: Any, userdata: Any, message: Any) -> None:
        """
        Paho network thread callback: thread-safely enqueues incoming message
        into the bounded asyncio queue.
        """
        if not self._loop or self._loop.is_closed():
            return

        topic = message.topic
        payload = message.payload  # raw bytes

        def enqueue_item():
            if self.incoming_queue.full():
                self.dropped_messages_count += 1
                logger.warning(
                    f"Incoming queue overflow (size={self.incoming_queue.maxsize}). "
                    f"Dropped message on topic '{topic}'. Total dropped: {self.dropped_messages_count}"
                )
            else:
                self.incoming_queue.put_nowait((topic, payload))

        self._loop.call_soon_threadsafe(enqueue_item)

    async def inject_message(self, topic: str, payload: Union[bytes, str, dict]) -> None:
        """Utility for local testing: inject message directly into the incoming queue."""
        if self.incoming_queue.full():
            self.dropped_messages_count += 1
            logger.warning("Incoming queue full during test injection; message dropped.")
        else:
            await self.incoming_queue.put((topic, payload))

    async def disconnect(self) -> None:
        """Gracefully disconnect and stop background network loop."""
        if self.config.dry_run:
            self._connected_event.clear()
            self._is_started = False
            return

        if self._paho_client and self._is_started:
            try:
                self._paho_client.disconnect()
                self._paho_client.loop_stop()
            except Exception as e:
                logger.error(f"Error during disconnect: {e}")
            finally:
                self._is_started = False
                self._connected_event.clear()

    async def publish(
        self,
        topic: str,
        payload: Union[Dict[str, Any], str, bytes],
        qos: int = 0,
        retain: bool = False,
    ) -> bool:
        """Publish payload to MQTT broker."""
        if isinstance(payload, bytes):
            raw_bytes = payload
        elif isinstance(payload, str):
            raw_bytes = payload.encode("utf-8")
        elif isinstance(payload, dict):
            raw_bytes = json.dumps(payload).encode("utf-8")
        else:
            raise TypeError(f"Unsupported payload type {type(payload)}")

        record = {
            "topic": topic,
            "raw_payload": raw_bytes,
            "payload_repr": payload,
            "qos": qos,
            "retain": retain,
        }
        self._published_history.append(record)

        if self.config.dry_run:
            return True

        if not self._is_started or not self._paho_client:
            logger.warning(f"Cannot publish to {topic}: MQTT client not connected.")
            return False

        try:
            info = self._paho_client.publish(topic, raw_bytes, qos=qos, retain=retain)
            return info.rc == mqtt.MQTT_ERR_SUCCESS
        except Exception as e:
            logger.error(f"Publish failed on topic {topic}: {e}")
            return False

    async def publish_processed(
        self, line: str, asset_id: str, payload: ProcessedTelemetryPayload
    ) -> bool:
        """Publish processed telemetry: factory/{line}/{asset_id}/telemetry/processed (QoS 0, retain False)."""
        topic = f"factory/{line}/{asset_id}/telemetry/processed"
        return await self.publish(topic, payload.to_dict(), qos=0, retain=False)

    async def publish_summary(
        self, line: str, asset_id: str, payload: AggregatedSummaryPayload
    ) -> bool:
        """Publish aggregation summary: factory/{line}/{asset_id}/telemetry/summary (QoS 0, retain False)."""
        topic = f"factory/{line}/{asset_id}/telemetry/summary"
        return await self.publish(topic, payload.to_dict(), qos=0, retain=False)

    async def publish_alert(
        self, line: str, asset_id: str, payload: EdgeAlertPayload
    ) -> bool:
        """Publish edge diagnostic alert: factory/{line}/{asset_id}/alerts (QoS 1, retain False)."""
        topic = f"factory/{line}/{asset_id}/alerts"
        return await self.publish(topic, payload.to_dict(), qos=1, retain=False)

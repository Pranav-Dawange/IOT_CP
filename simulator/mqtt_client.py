"""
Async-Friendly MQTT Client Transport Wrapper for Phase 4 Simulator.

RESPONSIBILITIES & CONTRACTS:
1. Uses paho-mqtt with background network loop (loop_start/loop_stop) so network I/O
   never blocks the asyncio event loop.
2. Thread-safe connection-ready signaling: Stores the active asyncio event loop and invokes
   loop.call_soon_threadsafe(connected_event.set) from network thread callbacks.
3. Startup waits for connection readiness with a configurable timeout.
4. Payload transport supports dict, str, and bytes.
   - For corrupted_json, publishes raw invalid bytes/text directly without json.dumps().
5. Strict topic hierarchy:
   - Telemetry: factory/{line}/{asset_id}/telemetry (QoS 0, retain False)
   - Status:    factory/{line}/{asset_id}/status    (QoS 1, retain True)
   - Alerts:    factory/{line}/{asset_id}/alerts    (QoS 1, retain False)
6. Supports dry-run mode for local verification and automated testing without an active broker.
"""

import asyncio
import json
import logging
import os
from typing import Any, Callable, Dict, List, Optional, Union

import paho.mqtt.client as mqtt

logger = logging.getLogger("simulator.mqtt")


class AsyncMQTTTransport:
    """
    Non-blocking MQTT Transport Client for multi-asset device simulator.
    """

    def __init__(
        self,
        broker_host: Optional[str] = None,
        broker_port: Optional[int] = None,
        client_id: str = "ai4i_industrial_simulator",
        dry_run: bool = False,
        loop: Optional[asyncio.AbstractEventLoop] = None,
    ):
        self.broker_host = broker_host or os.getenv("MQTT_HOST", "localhost")
        self.broker_port = broker_port or int(os.getenv("MQTT_PORT", "1883"))
        self.client_id = client_id
        self.dry_run = dry_run

        self._loop = loop
        self._connected_event = asyncio.Event()
        self._published_history: List[Dict[str, Any]] = []  # For testing and dry-run inspection

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
        """
        Connect to MQTT broker asynchronously with thread-safe connection-ready signaling.
        """
        if self._loop is None:
            self._loop = asyncio.get_running_loop()

        if self.dry_run:
            logger.info("AsyncMQTTTransport running in DRY-RUN mode (no broker socket connection).")
            self._connected_event.set()
            self._is_started = True
            return True

        # Initialize Paho MQTT client
        # Support both paho-mqtt v2 and v1 callback APIs
        try:
            self._paho_client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id=self.client_id,
            )
        except AttributeError:
            self._paho_client = mqtt.Client(client_id=self.client_id)

        # Wire callbacks with thread-safe asyncio signaling
        self._paho_client.on_connect = self._on_connect_callback
        self._paho_client.on_disconnect = self._on_disconnect_callback

        try:
            self._paho_client.connect_async(self.broker_host, self.broker_port, keepalive=60)
            self._paho_client.loop_start()
            self._is_started = True

            # Wait for connection ready event with timeout
            await asyncio.wait_for(self._connected_event.wait(), timeout=timeout_sec)
            logger.info(f"Connected to MQTT broker at {self.broker_host}:{self.broker_port}")
            return True

        except asyncio.TimeoutError:
            logger.warning(
                f"Timed out after {timeout_sec}s waiting for connection to {self.broker_host}:{self.broker_port}."
            )
            return False
        except Exception as e:
            logger.error(f"Error connecting to MQTT broker: {e}")
            return False

    def _on_connect_callback(self, client: Any, userdata: Any, flags: Any, rc: Any, *args: Any) -> None:
        """Paho network thread callback: thread-safely signal asyncio event."""
        # rc == 0 or rc.is_passthrough for v2
        rc_code = rc.value if hasattr(rc, "value") else rc
        if rc_code == 0:
            if self._loop and not self._loop.is_closed():
                self._loop.call_soon_threadsafe(self._connected_event.set)
        else:
            logger.error(f"MQTT connection refused with code: {rc_code}")

    def _on_disconnect_callback(self, client: Any, userdata: Any, rc: Any, *args: Any) -> None:
        """Paho network thread callback: thread-safely clear connection event."""
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._connected_event.clear)

    async def disconnect(self) -> None:
        """Gracefully disconnect and stop background network loop."""
        if self.dry_run:
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
        """
        Publish message to MQTT topic.

        Supports dict, str, and raw bytes (for corrupted JSON testing).
        Never passes raw bytes or malformed strings through json.dumps().
        """
        # Serialize payload based on type
        if isinstance(payload, bytes):
            raw_data = payload
        elif isinstance(payload, str):
            raw_data = payload.encode("utf-8")
        elif isinstance(payload, dict):
            raw_data = json.dumps(payload).encode("utf-8")
        else:
            raise TypeError(f"Unsupported payload type {type(payload)}. Must be dict, str, or bytes.")

        # Record publication for testing and dry-run
        pub_record = {
            "topic": topic,
            "raw_payload": raw_data,
            "payload_repr": payload,
            "qos": qos,
            "retain": retain,
        }
        self._published_history.append(pub_record)

        if self.dry_run:
            return True

        if not self._is_started or not self._paho_client:
            logger.warning(f"Cannot publish to {topic}: transport is not connected.")
            return False

        try:
            # publish is non-blocking with loop_start()
            info = self._paho_client.publish(topic, raw_data, qos=qos, retain=retain)
            return info.rc == mqtt.MQTT_ERR_SUCCESS
        except Exception as e:
            logger.error(f"Publish failed on {topic}: {e}")
            return False

    async def publish_telemetry(
        self,
        line: str,
        asset_id: str,
        payload: Union[Dict[str, Any], str, bytes],
    ) -> bool:
        """Publish sensor telemetry: QoS 0, Retain False."""
        topic = f"factory/{line}/{asset_id}/telemetry"
        return await self.publish(topic, payload, qos=0, retain=False)

    async def publish_status(
        self,
        line: str,
        asset_id: str,
        payload: Union[Dict[str, Any], str],
    ) -> bool:
        """Publish device connectivity/lifecycle status: QoS 1, Retain True."""
        topic = f"factory/{line}/{asset_id}/status"
        return await self.publish(topic, payload, qos=1, retain=True)

    async def publish_alert(
        self,
        line: str,
        asset_id: str,
        payload: Union[Dict[str, Any], str],
    ) -> bool:
        """Publish device diagnostic alert: QoS 1, Retain False."""
        topic = f"factory/{line}/{asset_id}/alerts"
        return await self.publish(topic, payload, qos=1, retain=False)

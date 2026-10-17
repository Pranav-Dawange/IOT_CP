"""
Simulated Device Implementation for Phase 4 Industrial Simulator.

MANDATORY SEMANTIC REQUIREMENTS:
1. Cursor & Sequence Monotonicity:
   The source cursor and sequence number advance on every sampling tick, INCLUDING disconnected ticks.
2. Intermittent Dropout (No Replay):
   When disconnected, telemetry is suppressed. Upon reconnection, publishing resumes at the new cursor;
   skipped rows are NEVER replayed, creating observable sequence-number and telemetry gaps.
3. Source Exhaustion:
   After 500 rows have been consumed:
   - Device transitions to terminal lifecycle state: EXHAUSTED.
   - Publishes status message with status='EXHAUSTED', reason='source_exhausted'.
   - Halts simulation loop.
   - Never restarts from row 0 unless opt-in loop_mode=True is set.
4. Independent Asset Concurrency:
   Dropout, timing, and state in one device cannot block or affect any other device.
5. Global Row Indexing in Status Payloads:
   source_row_index in status payloads reports the global CSV index (source_row_start + local_cursor).
"""

import asyncio
import logging
import random
from typing import Any, Dict, Optional

from simulator.connectivity import ConnectivityManager
from simulator.models import (
    AssetConfig,
    FaultInjectionConfig,
    get_utc_iso_timestamp,
    LifecycleState,
    StatusPayload,
)
from simulator.mqtt_client import AsyncMQTTTransport
from simulator.sensor_generator import SensorDataGenerator

logger = logging.getLogger("simulator.device")


class SimulatedDevice:
    """
    Simulates a single industrial device streaming telemetry from an assigned AI4I slice.
    """

    def __init__(
        self,
        config: AssetConfig,
        transport: AsyncMQTTTransport,
        sensor_generator: Optional[SensorDataGenerator] = None,
        connectivity_manager: Optional[ConnectivityManager] = None,
        fault_config: Optional[FaultInjectionConfig] = None,
        loop_mode: bool = False,
    ):
        self.config = config
        self.transport = transport
        self.fault_config = fault_config or FaultInjectionConfig()
        self.loop_mode = loop_mode

        self.sensor_generator = sensor_generator or SensorDataGenerator(
            asset_id=config.asset_id,
            source_row_start=config.source_row_start,
            source_row_end=config.source_row_end,
            fault_config=self.fault_config,
        )

        self.connectivity_manager = connectivity_manager or ConnectivityManager(
            asset_id=config.asset_id,
            line=config.line,
            fault_config=self.fault_config,
        )

        # Operational state
        self.local_cursor: int = 0
        self.sequence_number: int = 1
        self._stop_event = asyncio.Event()
        self.lifecycle_state: LifecycleState = LifecycleState.INITIALIZING

    @property
    def asset_id(self) -> str:
        return self.config.asset_id

    @property
    def line(self) -> str:
        return self.config.line

    @property
    def is_exhausted(self) -> bool:
        return self.lifecycle_state == LifecycleState.EXHAUSTED

    @property
    def is_running(self) -> bool:
        return self.lifecycle_state == LifecycleState.RUNNING

    def get_global_row_index(self) -> int:
        """Global CSV row index corresponding to current local cursor."""
        return self.config.source_row_start + min(self.local_cursor, self.config.total_source_rows - 1)

    async def publish_status_update(self, reason: Optional[str] = None) -> bool:
        """Publish current connectivity and lifecycle status message (QoS 1, Retain True)."""
        status_value = (
            LifecycleState.EXHAUSTED.value
            if self.is_exhausted
            else self.connectivity_manager.connectivity_state.value
        )
        payload = StatusPayload(
            asset_id=self.asset_id,
            line=self.line,
            status=status_value,
            timestamp=get_utc_iso_timestamp(),
            sequence_number=self.sequence_number,
            source_row_index=self.get_global_row_index(),
            reason=reason,
            lifecycle_state=self.lifecycle_state.value,
        )
        return await self.transport.publish_status(self.line, self.asset_id, payload.to_dict())

    async def tick(self) -> Optional[Dict[str, Any]]:
        """
        Execute a single simulation tick.

        Returns:
            Dict containing tick summary info (or None if stopped/exhausted).
        """
        if self.lifecycle_state in (LifecycleState.STOPPED, LifecycleState.EXHAUSTED):
            return None

        # Check connectivity transitions
        state_changed, reason = self.connectivity_manager.evaluate_tick_connectivity()
        if state_changed:
            await self.publish_status_update(reason=reason)

        current_cursor = self.local_cursor
        current_seq = self.sequence_number
        timestamp = get_utc_iso_timestamp()

        # Advance cursor and sequence number on EVERY tick (including disconnected)
        self.local_cursor += 1
        self.sequence_number += 1

        published_payload = None
        was_published = False

        # Publish telemetry ONLY if connectivity state is ONLINE
        if self.connectivity_manager.is_online and current_cursor < self.config.total_source_rows:
            # Check fault injection
            if (
                self.fault_config.malformed_probability > 0.0
                and random.random() < self.fault_config.malformed_probability
            ):
                malformed_reading = self.sensor_generator.generate_malformed_reading(
                    local_cursor=current_cursor,
                    sequence_number=current_seq,
                    timestamp=timestamp,
                )
                await self.transport.publish_telemetry(self.line, self.asset_id, malformed_reading)
                published_payload = malformed_reading
                was_published = True
            else:
                valid_reading = self.sensor_generator.generate_valid_reading(
                    local_cursor=current_cursor,
                    sequence_number=current_seq,
                    timestamp=timestamp,
                )
                await self.transport.publish_telemetry(self.line, self.asset_id, valid_reading.to_dict())
                published_payload = valid_reading.to_dict()
                was_published = True

        # Check source exhaustion after processing current observation
        if self.local_cursor >= self.config.total_source_rows:
            if self.loop_mode:
                # Wrap local cursor, keep sequence number strictly increasing
                self.local_cursor = 0
            else:
                self.lifecycle_state = LifecycleState.EXHAUSTED
                self.connectivity_manager.mark_exhausted()
                await self.publish_status_update(reason="source_exhausted")
                self._stop_event.set()

        return {
            "asset_id": self.asset_id,
            "cursor": current_cursor,
            "global_row": self.config.source_row_start + current_cursor,
            "sequence_number": current_seq,
            "connectivity": self.connectivity_manager.connectivity_state.value,
            "published": was_published,
            "payload": published_payload,
            "exhausted": self.is_exhausted,
        }

    async def run(self, max_ticks: Optional[int] = None, speedup: float = 1.0) -> None:
        """
        Run continuous simulation loop for this device until exhausted or stopped.
        """
        self.lifecycle_state = LifecycleState.RUNNING
        self.connectivity_manager.start()
        await self.publish_status_update(reason="device_started")

        base_interval_sec = (self.config.sampling_interval_ms / 1000.0) / max(0.01, speedup)
        ticks_executed = 0

        try:
            while not self._stop_event.is_set() and not self.is_exhausted:
                if max_ticks is not None and ticks_executed >= max_ticks:
                    break

                await self.tick()
                ticks_executed += 1

                if self.is_exhausted or self._stop_event.is_set():
                    break

                # Apply sampling jitter
                jitter_sec = 0.0
                if self.fault_config.jitter_max_ms > 0:
                    jitter_sec = (
                        random.uniform(self.fault_config.jitter_min_ms, self.fault_config.jitter_max_ms)
                        / 1000.0
                    ) / max(0.01, speedup)

                sleep_duration = max(0.001, base_interval_sec + jitter_sec)
                await asyncio.sleep(sleep_duration)

        except asyncio.CancelledError:
            pass
        finally:
            if not self.is_exhausted:
                self.lifecycle_state = LifecycleState.STOPPED
                await self.publish_status_update(reason="device_stopped")

    def stop(self) -> None:
        """Signal device to stop running."""
        self._stop_event.set()
        if not self.is_exhausted:
            self.lifecycle_state = LifecycleState.STOPPED

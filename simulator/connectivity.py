"""
Device Connectivity and Lifecycle Management for Phase 4 Simulator.

Maintains strict separation between:
1. ConnectivityState (ONLINE, DISCONNECTED, RECONNECTING): Describes network connection health.
2. LifecycleState (INITIALIZING, RUNNING, STOPPED, EXHAUSTED): Describes device execution lifecycle.

EXHAUSTED is a terminal lifecycle condition: once an asset reaches EXHAUSTED,
it halts publishing and never triggers network reconnection or further telemetry ticks.
"""

import random
from typing import Optional, Tuple

from simulator.models import ConnectivityState, FaultInjectionConfig, LifecycleState, StatusPayload


class ConnectivityManager:
    """
    Manages network connectivity state machine and dropout simulation for a device.
    """

    def __init__(
        self,
        asset_id: str,
        line: str,
        fault_config: Optional[FaultInjectionConfig] = None,
    ):
        self.asset_id = asset_id
        self.line = line
        self.fault_config = fault_config or FaultInjectionConfig()

        self.connectivity_state: ConnectivityState = ConnectivityState.ONLINE
        self.lifecycle_state: LifecycleState = LifecycleState.INITIALIZING
        self._disconnect_remaining_ticks: int = 0

    @property
    def is_online(self) -> bool:
        return self.connectivity_state == ConnectivityState.ONLINE

    @property
    def is_exhausted(self) -> bool:
        return self.lifecycle_state == LifecycleState.EXHAUSTED

    def start(self) -> None:
        """Transition lifecycle state to RUNNING."""
        self.lifecycle_state = LifecycleState.RUNNING
        self.connectivity_state = ConnectivityState.ONLINE

    def mark_exhausted(self) -> None:
        """Mark device as terminally EXHAUSTED. No reconnection or publishing can follow."""
        self.lifecycle_state = LifecycleState.EXHAUSTED

    def force_disconnect(self, duration_ticks: int = 3) -> None:
        """Deterministically force connection drop for testing."""
        if not self.is_exhausted:
            self.connectivity_state = ConnectivityState.DISCONNECTED
            self._disconnect_remaining_ticks = duration_ticks

    def force_reconnect(self) -> None:
        """Deterministically restore connection for testing."""
        if not self.is_exhausted:
            self.connectivity_state = ConnectivityState.ONLINE
            self._disconnect_remaining_ticks = 0

    def evaluate_tick_connectivity(self) -> Tuple[bool, Optional[str]]:
        """
        Evaluate and update connectivity state for a new simulation tick.

        Returns:
            (state_changed, transition_reason)
        """
        # If terminally exhausted, connectivity transitions do not occur
        if self.is_exhausted:
            return False, None

        previous_state = self.connectivity_state

        if self.connectivity_state == ConnectivityState.DISCONNECTED:
            self._disconnect_remaining_ticks -= 1
            if self._disconnect_remaining_ticks <= 0:
                self.connectivity_state = ConnectivityState.RECONNECTING
                return True, "reconnecting_attempt"
            return False, None

        elif self.connectivity_state == ConnectivityState.RECONNECTING:
            # Reconnection succeeds
            self.connectivity_state = ConnectivityState.ONLINE
            return True, "reconnection_successful"

        elif self.connectivity_state == ConnectivityState.ONLINE:
            # Check stochastic dropout
            if random.random() < self.fault_config.dropout_probability:
                self.connectivity_state = ConnectivityState.DISCONNECTED
                self._disconnect_remaining_ticks = self.fault_config.dropout_duration_ticks
                return True, "intermittent_dropout_detected"
            return False, None

        return False, None

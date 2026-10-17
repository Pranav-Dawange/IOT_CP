"""
Threshold-Based Anomaly Detector for Phase 5 Edge Processing Layer.

IMPORTANT CONTRACTS:
1. Operates on explicit configurable demonstration bounds.
2. Terminology: Uses strictly 'SENSOR_THRESHOLD_ANOMALY'.
   Does NOT label threshold violations as confirmed machine failures or predictions.
3. Alert Deduplication / Cooldown:
   Implements configurable cooldown per (asset_id, sensor_name, bound_type) to prevent
   flooding the MQTT broker on repeated identical violations, while allowing materially
   new anomalies to be alerted immediately.
"""

from datetime import datetime, timezone
import time
from typing import Any, Dict, List, Optional, Set, Tuple

from edge.config import ThresholdConfig
from edge.models import EdgeAlertPayload, get_utc_iso_timestamp, RAW_SENSOR_FIELDS


class EdgeAnomalyDetector:
    """
    Evaluates telemetry readings against configurable min/max bounds and manages alert cooldowns.
    """

    def __init__(
        self,
        thresholds: Optional[ThresholdConfig] = None,
        cooldown_seconds: float = 10.0,
    ):
        self.thresholds = thresholds or ThresholdConfig()
        self.cooldown_seconds = cooldown_seconds

        # Map of (asset_id, sensor_name, bound_type) -> last_alerted_monotonic_time
        self._last_alert_times: Dict[Tuple[str, str, str], float] = {}

    def set_thresholds(self, thresholds: ThresholdConfig) -> None:
        """Update detection thresholds at runtime."""
        self.thresholds = thresholds

    def evaluate_reading(
        self,
        reading: Dict[str, Any],
        smoothed_reading: Optional[Dict[str, float]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Evaluate raw sensor values against configured min/max threshold bounds.

        Returns:
            List of detected anomaly records.
        """
        asset_id = str(reading["asset_id"])
        timestamp = str(reading.get("timestamp", get_utc_iso_timestamp()))
        anomalies: List[Dict[str, Any]] = []

        for feat in RAW_SENSOR_FIELDS:
            if feat not in reading:
                continue

            val = float(reading[feat])
            bounds = self.thresholds.get_bounds(feat)
            if bounds is None:
                continue

            # Minimum bound violation
            if bounds.minimum is not None and val < bounds.minimum:
                anomalies.append({
                    "sensor_name": feat,
                    "observed_value": val,
                    "bound_type": "min",
                    "bound_value": bounds.minimum,
                    "severity": "WARNING",
                    "timestamp": timestamp,
                    "asset_id": asset_id,
                    "alert_type": "SENSOR_THRESHOLD_ANOMALY",
                    "description": (
                        f"Sensor '{feat}' value {val:.2f} fell below minimum demonstration "
                        f"bound of {bounds.minimum:.2f}"
                    ),
                })

            # Maximum bound violation
            elif bounds.maximum is not None and val > bounds.maximum:
                anomalies.append({
                    "sensor_name": feat,
                    "observed_value": val,
                    "bound_type": "max",
                    "bound_value": bounds.maximum,
                    "severity": "WARNING",
                    "timestamp": timestamp,
                    "asset_id": asset_id,
                    "alert_type": "SENSOR_THRESHOLD_ANOMALY",
                    "description": (
                        f"Sensor '{feat}' value {val:.2f} exceeded maximum demonstration "
                        f"bound of {bounds.maximum:.2f}"
                    ),
                })

        return anomalies

    def should_emit_alert(
        self,
        asset_id: str,
        sensor_name: str,
        bound_type: str,
        current_monotonic_time: Optional[float] = None,
    ) -> bool:
        """
        Determine if an alert should be emitted based on the cooldown policy.

        Returns:
            True if alert should be emitted (cooldown expired or first occurrence);
            False if suppressed under active cooldown.
        """
        now = current_monotonic_time if current_monotonic_time is not None else time.monotonic()
        key = (asset_id, sensor_name, bound_type)

        last_time = self._last_alert_times.get(key)
        if last_time is None or (now - last_time) >= self.cooldown_seconds:
            self._last_alert_times[key] = now
            return True

        return False

    def filter_anomalies_for_alerting(
        self,
        anomalies: List[Dict[str, Any]],
        current_monotonic_time: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """
        Filter anomaly list, returning only those that pass cooldown deduplication.
        """
        emit_list: List[Dict[str, Any]] = []
        for anom in anomalies:
            if self.should_emit_alert(
                asset_id=anom["asset_id"],
                sensor_name=anom["sensor_name"],
                bound_type=anom["bound_type"],
                current_monotonic_time=current_monotonic_time,
            ):
                emit_list.append(anom)
        return emit_list

    def create_anomaly_alert(self, line: str, anomaly: Dict[str, Any]) -> EdgeAlertPayload:
        """
        Build an EdgeAlertPayload from an anomaly dict.
        """
        return EdgeAlertPayload(
            asset_id=anomaly["asset_id"],
            line=line,
            timestamp=anomaly.get("timestamp", get_utc_iso_timestamp()),
            alert_type="SENSOR_THRESHOLD_ANOMALY",
            severity=anomaly.get("severity", "WARNING"),
            message=anomaly.get("description", "Sensor threshold demonstration bound exceeded"),
            details={
                "sensor_name": anomaly["sensor_name"],
                "observed_value": anomaly["observed_value"],
                "bound_type": anomaly["bound_type"],
                "bound_value": anomaly["bound_value"],
            },
            source="edge",
        )

    def reset_asset_cooldown(self, asset_id: str) -> None:
        """Clear cooldown history for a specific asset."""
        keys_to_del = [k for k in self._last_alert_times if k[0] == asset_id]
        for k in keys_to_del:
            del self._last_alert_times[k]

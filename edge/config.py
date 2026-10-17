"""
Configuration Settings for Phase 5 Edge Processing Layer.

IMPORTANT ARCHITECTURAL & METHODOLOGICAL CONTRACTS:
1. Demonstration Thresholds:
   The threshold bounds defined here are explicit demonstration defaults for testing
   and rapid operational verification. They are NOT certified industrial safety limits.
2. Raw Sensor Preservation:
   The edge processor preserves incoming raw sensor values unchanged in the processed
   telemetry stream. Smoothed values are stored separately in the `edge` metadata object.
3. Edge Alerts vs ML Predictions:
   Threshold anomalies detected at the edge are labeled `SENSOR_THRESHOLD_ANOMALY`
   and are strictly distinct from future ML-based impending machine failure predictions.
4. Ground-Truth Isolation:
   No ground-truth failure labels or dataset identifiers are ever accepted or published.
"""

from dataclasses import dataclass, field
import os
from typing import Dict, List, Optional, Tuple


@dataclass
class SensorThresholdBounds:
    """
    Min/max bounds for a single sensor feature.
    """
    minimum: Optional[float] = None
    maximum: Optional[float] = None


@dataclass
class ThresholdConfig:
    """
    Configurable demonstration thresholds for the 5 raw sensor features.
    
    NOTE: These are demonstration defaults and must be validated against
    actual machine specifications before any physical deployment.
    """
    air_temperature: SensorThresholdBounds = field(
        default_factory=lambda: SensorThresholdBounds(minimum=294.0, maximum=306.0)
    )
    process_temperature: SensorThresholdBounds = field(
        default_factory=lambda: SensorThresholdBounds(minimum=304.0, maximum=315.0)
    )
    rotational_speed: SensorThresholdBounds = field(
        default_factory=lambda: SensorThresholdBounds(minimum=1000.0, maximum=3000.0)
    )
    torque: SensorThresholdBounds = field(
        default_factory=lambda: SensorThresholdBounds(minimum=0.0, maximum=80.0)
    )
    tool_wear: SensorThresholdBounds = field(
        default_factory=lambda: SensorThresholdBounds(minimum=0.0, maximum=260.0)
    )

    def get_bounds(self, sensor_name: str) -> Optional[SensorThresholdBounds]:
        """Look up bounds by sensor field name."""
        return getattr(self, sensor_name, None)


@dataclass
class EdgeConfig:
    """
    Central configuration for Edge Processing Layer.
    """
    # Broker & MQTT Connection
    broker_host: str = field(default_factory=lambda: os.getenv("MQTT_HOST", "localhost"))
    broker_port: int = field(default_factory=lambda: int(os.getenv("MQTT_PORT", "1883")))
    client_id: str = "ai4i_edge_processor"
    keepalive: int = 60
    dry_run: bool = False

    # Topics to subscribe to
    telemetry_topic_pattern: str = "factory/+/+/telemetry"
    status_topic_pattern: str = "factory/+/+/status"

    # Queue Settings
    max_queue_size: int = 1000

    # Smoothing Window (per-asset rolling moving average)
    smoothing_window_size: int = 5

    # Periodic Aggregation (per-asset observation window)
    aggregation_interval: int = 10
    flush_partial_on_shutdown: bool = True

    # Alert Cooldown & Deduplication
    alert_cooldown_seconds: float = 10.0

    # Anomaly Detection Bounds
    thresholds: ThresholdConfig = field(default_factory=ThresholdConfig)

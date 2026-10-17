"""
Data Models and Telemetry Schemas for Phase 4 Industrial Simulator.

Defines schemas for:
- Asset metadata and synthetic trajectory configuration
- Valid telemetry payloads (strictly 5 raw ML sensor features)
- Status payloads with connectivity state and global source row indexing
- Alert payloads
- Simulation and fault injection parameters
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union


class ConnectivityState(str, Enum):
    """Network connectivity states for simulated industrial assets."""
    ONLINE = "ONLINE"
    DISCONNECTED = "DISCONNECTED"
    RECONNECTING = "RECONNECTING"


class LifecycleState(str, Enum):
    """Device lifecycle states independent of network connectivity."""
    INITIALIZING = "INITIALIZING"
    RUNNING = "RUNNING"
    STOPPED = "STOPPED"
    EXHAUSTED = "EXHAUSTED"


# Exact feature naming and ordering contract for valid telemetry
RAW_SENSOR_FEATURE_NAMES: List[str] = [
    "Air temperature [K]",
    "Process temperature [K]",
    "Rotational speed [rpm]",
    "Torque [Nm]",
    "Tool wear [min]",
]

# Prohibited columns that must NEVER be published to telemetry MQTT topics
PROHIBITED_LEAKAGE_COLUMNS: List[str] = [
    "Machine failure",
    "TWF",
    "HDF",
    "PWF",
    "OSF",
    "RNF",
    "UDI",
    "Product ID",
    "Type",
]


@dataclass
class AssetConfig:
    """
    Configuration and metadata for a simulated synthetic industrial device.

    NOTE: AI4I 2020 ordered records are partitioned into 20 non-overlapping contiguous slices.
    Each 500-row slice represents a synthetic operational trajectory, not a genuine machine-level history.
    asset_type, line, and location are simulated metadata, not facts provided by AI4I.
    """
    asset_id: str
    asset_type: str = "motor"
    line: str = "lineA"
    location: str = "Factory-1-Cell-01"
    firmware_version: str = "1.0.0"
    sampling_interval_ms: int = 1000
    source_row_start: int = 0
    source_row_end: int = 499
    enabled: bool = True

    @property
    def total_source_rows(self) -> int:
        return self.source_row_end - self.source_row_start + 1

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TelemetryPayload:
    """
    Strict schema for valid sensor telemetry published to:
    factory/{line}/{asset_id}/telemetry

    Strictly contains ONLY the 5 raw sensor features required by the frozen GRU model
    plus operational metadata (asset_id, timestamp, sequence_number).
    """
    asset_id: str
    timestamp: str
    sequence_number: int
    air_temperature: float
    process_temperature: float
    rotational_speed: float
    torque: float
    tool_wear: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TelemetryPayload":
        # Validate that prohibited ground truth columns are not present
        for col in PROHIBITED_LEAKAGE_COLUMNS:
            if col in data:
                raise ValueError(f"Prohibited column '{col}' detected in telemetry payload!")

        # Validate required fields
        required_fields = [
            "asset_id", "timestamp", "sequence_number",
            "air_temperature", "process_temperature",
            "rotational_speed", "torque", "tool_wear",
        ]
        missing = [f for f in required_fields if f not in data]
        if missing:
            raise ValueError(f"TelemetryPayload missing required fields: {missing}")

        # Validate types
        if not isinstance(data["asset_id"], str):
            raise TypeError("asset_id must be a string")
        if not isinstance(data["sequence_number"], int):
            raise TypeError("sequence_number must be an integer")

        numeric_fields = ["air_temperature", "process_temperature", "rotational_speed", "torque", "tool_wear"]
        for f in numeric_fields:
            val = data[f]
            if val is None or not isinstance(val, (int, float)):
                raise TypeError(f"Field '{f}' must be numeric, got {type(val).__name__} ({val})")

        return cls(
            asset_id=str(data["asset_id"]),
            timestamp=str(data["timestamp"]),
            sequence_number=int(data["sequence_number"]),
            air_temperature=float(data["air_temperature"]),
            process_temperature=float(data["process_temperature"]),
            rotational_speed=float(data["rotational_speed"]),
            torque=float(data["torque"]),
            tool_wear=float(data["tool_wear"]),
        )


@dataclass
class StatusPayload:
    """
    Device status message published to:
    factory/{line}/{asset_id}/status (QoS 1, Retain True)

    source_row_index represents the global CSV row index (source_row_start + local_cursor),
    while the device's internal cursor remains local to its 500-row slice.
    """
    asset_id: str
    line: str
    status: str
    timestamp: str
    sequence_number: int
    source_row_index: int
    reason: Optional[str] = None
    lifecycle_state: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        if self.reason is None:
            d.pop("reason", None)
        if self.lifecycle_state is None:
            d.pop("lifecycle_state", None)
        return d


@dataclass
class AlertPayload:
    """
    Diagnostic alert message published to:
    factory/{line}/{asset_id}/alerts (QoS 1, Retain False)
    """
    asset_id: str
    line: str
    alert_type: str
    severity: Literal["INFO", "WARNING", "ERROR"]
    message: str
    timestamp: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


MalformedType = Literal["missing_field", "wrong_type", "null_value", "corrupted_json", "random"]


@dataclass
class FaultInjectionConfig:
    """
    Configuration parameters for simulation perturbations and explicit fault injection.
    """
    noise_enabled: bool = True
    temperature_noise_std: float = 0.05   # std dev in Kelvin
    speed_noise_std: float = 2.0          # std dev in RPM
    torque_noise_std: float = 0.1         # std dev in Nm
    tool_wear_noise_std: float = 0.0      # wear is cumulative, standard 0.0

    jitter_min_ms: int = 0
    jitter_max_ms: int = 30

    dropout_probability: float = 0.01     # 1% chance per tick to experience network dropout
    dropout_duration_ticks: int = 3       # disconnected for 3 ticks

    malformed_probability: float = 0.005  # 0.5% chance to inject an intentionally malformed message
    malformed_type: MalformedType = "random"


def get_utc_iso_timestamp() -> str:
    """Return standard ISO-8601 UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()

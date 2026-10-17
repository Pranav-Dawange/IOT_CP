"""
Data Models and Payload Contracts for Phase 5 Edge Processing Layer.

Strictly enforces:
1. Valid telemetry schema parsing and numeric verification (no NaN, Inf, null).
2. Asset ID consistency between topic and payload.
3. Zero leakage of ground-truth labels (Machine failure, TWF, etc.) or dataset IDs.
4. Processed telemetry contract: original raw sensor values preserved unchanged,
   with edge enrichment (smoothed values, anomalies, gaps) in the 'edge' sub-object.
5. Summary payload contract: per-sensor statistics (mean, min, max) over aggregation intervals.
6. Edge alert schema: explicit alert types distinct from ML predictions.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import math
import re
from typing import Any, Dict, List, Literal, Optional, Tuple, Union

# Exact raw feature names required in telemetry
RAW_SENSOR_FIELDS: List[str] = [
    "air_temperature",
    "process_temperature",
    "rotational_speed",
    "torque",
    "tool_wear",
]

# Prohibited columns that must NEVER be accepted or emitted
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

# Standard Topic Hierarchy Regex: factory/{line}/{asset_id}/{channel}
TOPIC_REGEX = re.compile(r"^factory/([^/]+)/([^/]+)/([^/]+)$")


def parse_topic(topic: str) -> Optional[Dict[str, str]]:
    """
    Parse a factory topic into components.
    
    Returns:
        Dict with 'line', 'asset_id', 'channel' if valid, else None.
    """
    match = TOPIC_REGEX.match(topic)
    if not match:
        return None
    return {
        "line": match.group(1),
        "asset_id": match.group(2),
        "channel": match.group(3),
    }


def get_utc_iso_timestamp() -> str:
    """Return ISO-8601 UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()


@dataclass
class EdgeMetadata:
    """
    Edge enrichment container embedded within ProcessedTelemetryPayload.
    """
    processing_timestamp: str
    validation_status: str
    smoothing_window_size: int
    smoothed_values: Dict[str, float]
    anomaly_flags: List[Dict[str, Any]] = field(default_factory=list)
    sequence_gaps: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ProcessedTelemetryPayload:
    """
    Output contract published to:
    factory/{line}/{asset_id}/telemetry/processed (QoS 0, retain False)

    CRITICAL INVARIANT:
    The 5 original raw sensor fields must remain untouched and un-smoothed,
    allowing downstream inference consumers to build GRU windows from
    exact raw values.
    """
    asset_id: str
    timestamp: str
    sequence_number: int
    air_temperature: float
    process_temperature: float
    rotational_speed: float
    torque: float
    tool_wear: float
    edge: EdgeMetadata

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "asset_id": self.asset_id,
            "timestamp": self.timestamp,
            "sequence_number": self.sequence_number,
            "air_temperature": self.air_temperature,
            "process_temperature": self.process_temperature,
            "rotational_speed": self.rotational_speed,
            "torque": self.torque,
            "tool_wear": self.tool_wear,
            "edge": self.edge.to_dict(),
        }
        # Double-check prohibited column isolation
        for col in PROHIBITED_LEAKAGE_COLUMNS:
            if col in d or col in d["edge"]:
                raise ValueError(f"Prohibited leakage column '{col}' detected in processed telemetry!")
        return d


@dataclass
class AggregatedSummaryPayload:
    """
    Periodic aggregation summary published to:
    factory/{line}/{asset_id}/telemetry/summary (QoS 0, retain False)
    """
    asset_id: str
    line: str
    interval_start_timestamp: str
    interval_end_timestamp: str
    observation_count: int
    sensor_statistics: Dict[str, Dict[str, float]]
    anomaly_count: int
    gap_count: int
    is_partial: bool = False

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        for col in PROHIBITED_LEAKAGE_COLUMNS:
            if col in d:
                raise ValueError(f"Prohibited column '{col}' detected in aggregated summary!")
        return d


AlertType = Literal[
    "SENSOR_THRESHOLD_ANOMALY",
    "MALFORMED_TELEMETRY",
    "DATA_GAP_DETECTED",
    "DUPLICATE_OR_OUT_OF_ORDER_READING",
]


@dataclass
class EdgeAlertPayload:
    """
    Diagnostic alert published to:
    factory/{line}/{asset_id}/alerts (QoS 1, retain False)
    """
    asset_id: str
    line: str
    timestamp: str
    alert_type: AlertType
    severity: Literal["INFO", "WARNING", "ERROR"]
    message: str
    details: Dict[str, Any] = field(default_factory=dict)
    source: str = "edge"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        for col in PROHIBITED_LEAKAGE_COLUMNS:
            if col in d:
                raise ValueError(f"Prohibited column '{col}' detected in edge alert!")
        return d


@dataclass
class AssetEdgeState:
    """
    Maintains operational status and health tracking per asset at the edge.
    """
    asset_id: str
    line: str
    last_status: str = "UNKNOWN"
    last_seen_timestamp: Optional[str] = None
    last_sequence_number: Optional[int] = None
    total_valid_observations: int = 0
    total_malformed_observations: int = 0
    total_anomalies: int = 0
    total_gaps: int = 0


def validate_raw_telemetry(data: Any, expected_asset_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Validate an incoming telemetry payload dictionary.

    Enforces:
    1. Must be a dict.
    2. Zero prohibited ground-truth columns.
    3. Mandatory metadata: asset_id (str), timestamp (str), sequence_number (int >= 1).
    4. Asset ID matches expected_asset_id from MQTT topic (if supplied).
    5. All 5 sensor features present, numeric, finite (no NaN, Inf, null).

    Returns:
        Cleaned dict with parsed numeric types.
    Raises:
        ValueError or TypeError on validation failure.
    """
    if not isinstance(data, dict):
        raise TypeError(f"Payload must be a JSON object (dict), got {type(data).__name__}")

    # 1. Prohibited leakage check
    for col in PROHIBITED_LEAKAGE_COLUMNS:
        if col in data:
            raise ValueError(f"Prohibited ground-truth/identifier column '{col}' detected in telemetry!")

    # 2. Required metadata fields
    for req in ["asset_id", "timestamp", "sequence_number"]:
        if req not in data:
            raise ValueError(f"Missing required metadata field: '{req}'")

    asset_id = str(data["asset_id"])
    if not asset_id.strip():
        raise ValueError("Field 'asset_id' cannot be empty")

    if expected_asset_id is not None and asset_id != expected_asset_id:
        raise ValueError(
            f"Asset ID mismatch: topic specified '{expected_asset_id}', payload contains '{asset_id}'"
        )

    # 3. Sequence number verification
    seq_num = data["sequence_number"]
    if not isinstance(seq_num, int) or isinstance(seq_num, bool):
        raise TypeError(f"Field 'sequence_number' must be an integer, got {type(seq_num).__name__}")
    if seq_num < 1:
        raise ValueError(f"Field 'sequence_number' must be >= 1, got {seq_num}")

    # 4. Mandatory 5 raw sensor features verification
    cleaned_sensors: Dict[str, float] = {}
    for feat in RAW_SENSOR_FIELDS:
        if feat not in data:
            raise ValueError(f"Missing mandatory sensor feature: '{feat}'")
        val = data[feat]
        if val is None:
            raise TypeError(f"Sensor feature '{feat}' has null value")
        if not isinstance(val, (int, float)) or isinstance(val, bool):
            raise TypeError(f"Sensor feature '{feat}' must be numeric, got {type(val).__name__} ({val})")

        fval = float(val)
        if math.isnan(fval):
            raise ValueError(f"Sensor feature '{feat}' is NaN")
        if math.isinf(fval):
            raise ValueError(f"Sensor feature '{feat}' is Infinite")

        cleaned_sensors[feat] = fval

    return {
        "asset_id": asset_id,
        "timestamp": str(data["timestamp"]),
        "sequence_number": seq_num,
        **cleaned_sensors,
    }

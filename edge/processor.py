"""
Core Edge Processor for Phase 5 Edge Processing Layer.

Coordinates:
1. Strict telemetry and status topic validation.
2. Safe rejection and alerting for malformed JSON or invalid sensor data.
3. Per-asset sequence number tracking (detecting gaps, duplicates, out-of-order).
4. Per-asset rolling moving average smoothing (default window 5, strictly isolated).
5. Sensor threshold anomaly detection with cooldown deduplication.
6. Processed telemetry contract: original raw sensors preserved unchanged,
   with edge enrichments embedded in the 'edge' sub-object.
7. Periodic aggregation (default 10 observations) and partial summary flush on shutdown.
8. Independent connectivity tracking for each asset.
"""

from collections import deque
from dataclasses import dataclass, field
import json
import logging
from typing import Any, Dict, List, Optional, Tuple, Union

from edge.aggregator import EdgeAggregator
from edge.anomaly_detector import EdgeAnomalyDetector
from edge.config import EdgeConfig
from edge.models import (
    AggregatedSummaryPayload,
    AssetEdgeState,
    EdgeAlertPayload,
    EdgeMetadata,
    get_utc_iso_timestamp,
    parse_topic,
    ProcessedTelemetryPayload,
    RAW_SENSOR_FIELDS,
    validate_raw_telemetry,
)

logger = logging.getLogger("edge.processor")


@dataclass
class ProcessingResult:
    """
    Output resulting from processing an incoming MQTT message.
    """
    success: bool
    category: str  # 'telemetry', 'status', 'rejected', 'ignored'
    line: Optional[str] = None
    asset_id: Optional[str] = None
    processed_telemetry: Optional[ProcessedTelemetryPayload] = None
    aggregated_summary: Optional[AggregatedSummaryPayload] = None
    alerts: List[EdgeAlertPayload] = field(default_factory=list)
    error_message: Optional[str] = None


class EdgeProcessor:
    """
    Stateful Edge Processor managing multiple industrial assets.
    """

    def __init__(self, config: Optional[EdgeConfig] = None):
        self.config = config or EdgeConfig()
        self.anomaly_detector = EdgeAnomalyDetector(
            thresholds=self.config.thresholds,
            cooldown_seconds=self.config.alert_cooldown_seconds,
        )
        self.aggregator = EdgeAggregator(interval=self.config.aggregation_interval)

        # Per-asset smoothing buffers: asset_id -> deque of dicts (len <= window_size)
        self._smoothing_buffers: Dict[str, deque] = {}

        # Per-asset sequence tracking: asset_id -> last_sequence_number
        self._last_sequence_numbers: Dict[str, int] = {}

        # Per-asset state tracking: asset_id -> AssetEdgeState
        self._asset_states: Dict[str, AssetEdgeState] = {}

    def get_asset_state(self, asset_id: str) -> Optional[AssetEdgeState]:
        """Query edge operational state for an asset."""
        return self._asset_states.get(asset_id)

    def get_all_asset_states(self) -> Dict[str, AssetEdgeState]:
        """Return all tracked asset states."""
        return dict(self._asset_states)

    def _get_or_create_state(self, asset_id: str, line: str) -> AssetEdgeState:
        if asset_id not in self._asset_states:
            self._asset_states[asset_id] = AssetEdgeState(asset_id=asset_id, line=line)
        return self._asset_states[asset_id]

    def _compute_smoothed_values(self, asset_id: str, raw_reading: Dict[str, Any]) -> Tuple[Dict[str, float], int]:
        """
        Update asset's rolling buffer and compute moving averages for the 5 raw features.
        
        For readings 1..4, computes average of currently available readings.
        After 5 readings, computes average of latest 5.
        """
        if asset_id not in self._smoothing_buffers:
            self._smoothing_buffers[asset_id] = deque(maxlen=self.config.smoothing_window_size)

        buffer = self._smoothing_buffers[asset_id]
        buffer.append({feat: float(raw_reading[feat]) for feat in RAW_SENSOR_FIELDS})

        window_count = len(buffer)
        smoothed: Dict[str, float] = {}
        for feat in RAW_SENSOR_FIELDS:
            vals = [obs[feat] for obs in buffer]
            smoothed[feat] = round(sum(vals) / window_count, 2)

        return smoothed, window_count

    def process_message(
        self,
        topic: str,
        payload_data: Union[str, bytes, dict],
        monotonic_time: Optional[float] = None,
    ) -> ProcessingResult:
        """
        Process any incoming MQTT message received on factory/+/+ topics.
        """
        parsed_topic = parse_topic(topic)
        if not parsed_topic:
            return ProcessingResult(
                success=False,
                category="rejected",
                error_message=f"Invalid topic hierarchy: '{topic}'",
            )

        line = parsed_topic["line"]
        asset_id = parsed_topic["asset_id"]
        channel = parsed_topic["channel"]

        # -----------------------------------------------------------------
        # 1. Handle Status Messages
        # -----------------------------------------------------------------
        if channel == "status":
            return self._process_status_message(line, asset_id, payload_data)

        # -----------------------------------------------------------------
        # 2. Handle Telemetry Messages
        # -----------------------------------------------------------------
        if channel == "telemetry":
            return self._process_telemetry_message(line, asset_id, payload_data, monotonic_time)

        return ProcessingResult(
            success=False,
            category="ignored",
            line=line,
            asset_id=asset_id,
            error_message=f"Ignored channel '{channel}' on topic '{topic}'",
        )

    def _process_status_message(
        self,
        line: str,
        asset_id: str,
        payload_data: Union[str, bytes, dict],
    ) -> ProcessingResult:
        """Process device connectivity status update."""
        state = self._get_or_create_state(asset_id, line)
        try:
            if isinstance(payload_data, (bytes, bytearray)):
                payload = json.loads(payload_data.decode("utf-8"))
            elif isinstance(payload_data, str):
                payload = json.loads(payload_data)
            elif isinstance(payload_data, dict):
                payload = payload_data
            else:
                raise TypeError(f"Unsupported payload type {type(payload_data).__name__}")

            status_str = str(payload.get("status", "UNKNOWN"))
            timestamp = str(payload.get("timestamp", get_utc_iso_timestamp()))
            seq = payload.get("sequence_number")

            state.last_status = status_str
            state.last_seen_timestamp = timestamp
            if isinstance(seq, int):
                state.last_sequence_number = seq

            logger.info(f"Asset '{asset_id}' status update: {status_str} (reason: {payload.get('reason')})")

            return ProcessingResult(
                success=True,
                category="status",
                line=line,
                asset_id=asset_id,
            )

        except Exception as e:
            err_msg = f"Failed to parse status payload on {line}/{asset_id}: {e}"
            logger.warning(err_msg)
            return ProcessingResult(
                success=False,
                category="rejected",
                line=line,
                asset_id=asset_id,
                error_message=err_msg,
            )

    def _process_telemetry_message(
        self,
        line: str,
        asset_id: str,
        payload_data: Union[str, bytes, dict],
        monotonic_time: Optional[float] = None,
    ) -> ProcessingResult:
        """Process incoming raw telemetry observation."""
        state = self._get_or_create_state(asset_id, line)
        timestamp_now = get_utc_iso_timestamp()

        # Step 1: JSON decoding
        decoded_dict = None
        if isinstance(payload_data, dict):
            decoded_dict = payload_data
        elif isinstance(payload_data, (bytes, bytearray)):
            try:
                decoded_dict = json.loads(payload_data.decode("utf-8"))
            except Exception as e:
                err_msg = f"Malformed JSON payload bytes: {e}"
                state.total_malformed_observations += 1
                alert = EdgeAlertPayload(
                    asset_id=asset_id,
                    line=line,
                    timestamp=timestamp_now,
                    alert_type="MALFORMED_TELEMETRY",
                    severity="ERROR",
                    message="Unparseable JSON bytes received on telemetry topic",
                    details={"error": str(e), "channel": "telemetry"},
                )
                return ProcessingResult(
                    success=False,
                    category="telemetry",
                    line=line,
                    asset_id=asset_id,
                    alerts=[alert],
                    error_message=err_msg,
                )
        elif isinstance(payload_data, str):
            try:
                decoded_dict = json.loads(payload_data)
            except Exception as e:
                err_msg = f"Malformed JSON payload text: {e}"
                state.total_malformed_observations += 1
                alert = EdgeAlertPayload(
                    asset_id=asset_id,
                    line=line,
                    timestamp=timestamp_now,
                    alert_type="MALFORMED_TELEMETRY",
                    severity="ERROR",
                    message="Unparseable JSON string received on telemetry topic",
                    details={"error": str(e), "channel": "telemetry"},
                )
                return ProcessingResult(
                    success=False,
                    category="telemetry",
                    line=line,
                    asset_id=asset_id,
                    alerts=[alert],
                    error_message=err_msg,
                )
        else:
            err_msg = f"Unexpected payload type: {type(payload_data).__name__}"
            state.total_malformed_observations += 1
            return ProcessingResult(
                success=False,
                category="telemetry",
                line=line,
                asset_id=asset_id,
                error_message=err_msg,
            )

        # Step 2: Validate Schema and Sensor Numeric Bounds
        try:
            valid_reading = validate_raw_telemetry(decoded_dict, expected_asset_id=asset_id)
        except Exception as e:
            err_msg = f"Invalid telemetry content: {e}"
            state.total_malformed_observations += 1
            alert = EdgeAlertPayload(
                asset_id=asset_id,
                line=line,
                timestamp=timestamp_now,
                alert_type="MALFORMED_TELEMETRY",
                severity="ERROR",
                message=str(e),
                details={"error": str(e), "keys_present": list(decoded_dict.keys()) if isinstance(decoded_dict, dict) else []},
            )
            return ProcessingResult(
                success=False,
                category="telemetry",
                line=line,
                asset_id=asset_id,
                alerts=[alert],
                error_message=err_msg,
            )

        # Telemetry is valid
        state.total_valid_observations += 1
        state.last_seen_timestamp = valid_reading["timestamp"]
        seq_num = valid_reading["sequence_number"]

        generated_alerts: List[EdgeAlertPayload] = []

        # Step 3: Sequence Number Tracking
        gap_info: Optional[Dict[str, Any]] = None
        gap_detected_count = 0
        if asset_id in self._last_sequence_numbers:
            last_seq = self._last_sequence_numbers[asset_id]
            expected_seq = last_seq + 1

            if seq_num > expected_seq:
                # Sequence gap detected
                gap_size = seq_num - expected_seq
                gap_detected_count = 1
                state.total_gaps += 1
                gap_info = {
                    "last_sequence_number": last_seq,
                    "expected_sequence_number": expected_seq,
                    "received_sequence_number": seq_num,
                    "missing_count": gap_size,
                }
                generated_alerts.append(EdgeAlertPayload(
                    asset_id=asset_id,
                    line=line,
                    timestamp=valid_reading["timestamp"],
                    alert_type="DATA_GAP_DETECTED",
                    severity="WARNING",
                    message=(
                        f"Detected sequence gap of {gap_size} message(s) between "
                        f"#{last_seq} and #{seq_num}."
                    ),
                    details=gap_info,
                ))

            elif seq_num == last_seq:
                # Duplicate sequence number
                generated_alerts.append(EdgeAlertPayload(
                    asset_id=asset_id,
                    line=line,
                    timestamp=valid_reading["timestamp"],
                    alert_type="DUPLICATE_OR_OUT_OF_ORDER_READING",
                    severity="WARNING",
                    message=f"Received duplicate sequence number #{seq_num}.",
                    details={"sequence_number": seq_num, "type": "duplicate"},
                ))

            elif seq_num < last_seq:
                # Out-of-order sequence number
                generated_alerts.append(EdgeAlertPayload(
                    asset_id=asset_id,
                    line=line,
                    timestamp=valid_reading["timestamp"],
                    alert_type="DUPLICATE_OR_OUT_OF_ORDER_READING",
                    severity="WARNING",
                    message=(
                        f"Received out-of-order sequence number #{seq_num} "
                        f"(last observed was #{last_seq})."
                    ),
                    details={
                        "received_sequence_number": seq_num,
                        "last_sequence_number": last_seq,
                        "type": "out_of_order",
                    },
                ))

        self._last_sequence_numbers[asset_id] = seq_num
        state.last_sequence_number = seq_num

        # Step 4: Per-Asset Rolling Moving Average Smoothing
        smoothed_values, window_count = self._compute_smoothed_values(asset_id, valid_reading)

        # Step 5: Threshold Anomaly Detection
        anomalies = self.anomaly_detector.evaluate_reading(valid_reading, smoothed_values)
        if anomalies:
            state.total_anomalies += len(anomalies)

        # Apply alert cooldown / deduplication policy
        alertable_anomalies = self.anomaly_detector.filter_anomalies_for_alerting(
            anomalies, current_monotonic_time=monotonic_time
        )
        for anom in alertable_anomalies:
            generated_alerts.append(self.anomaly_detector.create_anomaly_alert(line, anom))

        # Step 6: Construct Processed Telemetry Payload
        # (CRITICAL: Raw sensor values preserved intact!)
        edge_meta = EdgeMetadata(
            processing_timestamp=timestamp_now,
            validation_status="VALID",
            smoothing_window_size=window_count,
            smoothed_values=smoothed_values,
            anomaly_flags=anomalies,
            sequence_gaps=gap_info,
        )

        processed_payload = ProcessedTelemetryPayload(
            asset_id=asset_id,
            timestamp=valid_reading["timestamp"],
            sequence_number=seq_num,
            air_temperature=valid_reading["air_temperature"],
            process_temperature=valid_reading["process_temperature"],
            rotational_speed=valid_reading["rotational_speed"],
            torque=valid_reading["torque"],
            tool_wear=valid_reading["tool_wear"],
            edge=edge_meta,
        )

        # Step 7: Periodic Aggregator Window
        summary_payload = self.aggregator.add_observation(
            reading=valid_reading,
            line=line,
            anomaly_count=len(anomalies),
            gap_count=gap_detected_count,
        )

        return ProcessingResult(
            success=True,
            category="telemetry",
            line=line,
            asset_id=asset_id,
            processed_telemetry=processed_payload,
            aggregated_summary=summary_payload,
            alerts=generated_alerts,
        )

    def flush_partial_aggregations(self) -> List[AggregatedSummaryPayload]:
        """Flush partial aggregation windows on orderly shutdown."""
        return self.aggregator.flush_all()

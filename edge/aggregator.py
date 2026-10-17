"""
Periodic Telemetry Aggregator for Phase 5 Edge Processing Layer.

IMPORTANT CONTRACTS:
1. Aggregation is tracked independently per asset; readings from different assets NEVER mix.
2. Default aggregation interval: 10 valid observations.
3. Computes mean, minimum, and maximum for each of the 5 raw sensor features.
4. On orderly shutdown, flushes partial aggregation intervals instead of silently discarding them.
"""

from collections import defaultdict
from typing import Any, Dict, List, Optional

from edge.models import AggregatedSummaryPayload, RAW_SENSOR_FIELDS


class EdgeAggregator:
    """
    Manages per-asset rolling aggregation windows and summary payload generation.
    """

    def __init__(self, interval: int = 10):
        self.interval = interval

        # Internal buffers per asset: asset_id -> list of observation dicts
        self._buffers: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self._anomaly_counts: Dict[str, int] = defaultdict(int)
        self._gap_counts: Dict[str, int] = defaultdict(int)
        self._line_map: Dict[str, str] = {}

    def get_buffer_count(self, asset_id: str) -> int:
        """Current number of observations accumulated for this asset."""
        return len(self._buffers.get(asset_id, []))

    def add_observation(
        self,
        reading: Dict[str, Any],
        line: str,
        anomaly_count: int = 0,
        gap_count: int = 0,
    ) -> Optional[AggregatedSummaryPayload]:
        """
        Add a valid reading to an asset's aggregation window.

        Returns:
            AggregatedSummaryPayload if aggregation interval is reached; otherwise None.
        """
        asset_id = str(reading["asset_id"])
        self._line_map[asset_id] = line
        self._buffers[asset_id].append(reading)
        self._anomaly_counts[asset_id] += anomaly_count
        self._gap_counts[asset_id] += gap_count

        if len(self._buffers[asset_id]) >= self.interval:
            return self._build_summary(asset_id, is_partial=False)

        return None

    def _build_summary(self, asset_id: str, is_partial: bool = False) -> Optional[AggregatedSummaryPayload]:
        """Compute aggregate statistics and reset the asset's accumulation window."""
        observations = self._buffers.get(asset_id, [])
        if not observations:
            return None

        line = self._line_map.get(asset_id, "unknown")
        start_ts = str(observations[0]["timestamp"])
        end_ts = str(observations[-1]["timestamp"])
        count = len(observations)

        # Compute per-sensor mean, min, max
        stats: Dict[str, Dict[str, float]] = {}
        for feat in RAW_SENSOR_FIELDS:
            vals = [float(obs[feat]) for obs in observations]
            stats[feat] = {
                "mean": round(sum(vals) / count, 2),
                "min": round(min(vals), 2),
                "max": round(max(vals), 2),
            }

        total_anomalies = self._anomaly_counts[asset_id]
        total_gaps = self._gap_counts[asset_id]

        payload = AggregatedSummaryPayload(
            asset_id=asset_id,
            line=line,
            interval_start_timestamp=start_ts,
            interval_end_timestamp=end_ts,
            observation_count=count,
            sensor_statistics=stats,
            anomaly_count=total_anomalies,
            gap_count=total_gaps,
            is_partial=is_partial,
        )

        # Clear buffer
        self._buffers[asset_id] = []
        self._anomaly_counts[asset_id] = 0
        self._gap_counts[asset_id] = 0

        return payload

    def flush_asset(self, asset_id: str) -> Optional[AggregatedSummaryPayload]:
        """Flush partial observations for a specific asset on shutdown."""
        if len(self._buffers.get(asset_id, [])) > 0:
            return self._build_summary(asset_id, is_partial=True)
        return None

    def flush_all(self) -> List[AggregatedSummaryPayload]:
        """Flush partial observations for all assets on shutdown."""
        flushed: List[AggregatedSummaryPayload] = []
        asset_ids = list(self._buffers.keys())
        for aid in asset_ids:
            summary = self.flush_asset(aid)
            if summary is not None:
                flushed.append(summary)
        return flushed

    def reset(self, asset_id: Optional[str] = None) -> None:
        """Reset buffers."""
        if asset_id is not None:
            self._buffers.pop(asset_id, None)
            self._anomaly_counts.pop(asset_id, None)
            self._gap_counts.pop(asset_id, None)
        else:
            self._buffers.clear()
            self._anomaly_counts.clear()
            self._gap_counts.clear()
            self._line_map.clear()

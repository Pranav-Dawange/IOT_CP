"""
Asset Telemetry Buffer for Phase 3 Frozen GRU Inference.

Maintains per-asset rolling FIFO temporal windows (WINDOW_SIZE = 30)
for live industrial streaming telemetry.

METHODOLOGICAL GUARANTEES:
1. Strict Synthetic Asset Isolation: Every asset ID maintains an isolated FIFO buffer.
   No telemetry is ever mixed across asset boundaries.
2. Chronological Ordering: Live observations are appended sequentially.
3. Temporal Window Length: Maximum length = 30 timesteps.
4. Window Readiness: Returns None until exactly 30 observations have been recorded.
5. Rolling Dynamics: The 31st observation evicts the oldest (observation 1) and retains [2..31].
6. Zero Future Leakage: Operates strictly on historical and current observations.
"""

from collections import deque
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd

RAW_FEATURE_COLUMNS: List[str] = [
    "Air temperature [K]",
    "Process temperature [K]",
    "Rotational speed [rpm]",
    "Torque [Nm]",
    "Tool wear [min]",
]


def validate_single_reading(
    reading: Union[np.ndarray, List[float], Tuple[float, ...], Dict[str, float], pd.Series],
    expected_features: List[str] = RAW_FEATURE_COLUMNS,
) -> np.ndarray:
    """
    Validate a single sensor observation and return a 1D float64 array of shape (5,).

    Raises:
        ValueError: If features are missing, length != 5, or NaNs / Infs are detected.
    """
    if isinstance(reading, (dict, pd.Series)):
        missing_keys = [k for k in expected_features if k not in reading]
        if missing_keys:
            raise ValueError(
                f"Observation is missing required sensor features: {missing_keys}. "
                f"Expected features: {expected_features}"
            )
        arr = np.array([float(reading[k]) for k in expected_features], dtype=np.float64)
    elif isinstance(reading, (list, tuple, np.ndarray)):
        arr = np.asarray(reading, dtype=np.float64).ravel()
        if len(arr) != len(expected_features):
            raise ValueError(
                f"Observation length mismatch: expected {len(expected_features)} features, got {len(arr)}."
            )
    else:
        raise TypeError(
            f"Unsupported reading type: {type(reading)}. Expected list, tuple, np.ndarray, dict, or pd.Series."
        )

    # Validate numeric integrity
    if np.isnan(arr).any():
        nan_indices = np.where(np.isnan(arr))[0].tolist()
        nan_feats = [expected_features[i] for i in nan_indices]
        raise ValueError(f"Sensor observation contains NaN values in features: {nan_feats}")

    if np.isinf(arr).any():
        inf_indices = np.where(np.isinf(arr))[0].tolist()
        inf_feats = [expected_features[i] for i in inf_indices]
        raise ValueError(f"Sensor observation contains Infinite values in features: {inf_feats}")

    return arr


class AssetTelemetryBuffer:
    """
    Per-asset FIFO rolling buffer for streaming telemetry.
    """

    def __init__(
        self,
        window_size: int = 30,
        feature_names: Optional[List[str]] = None,
    ):
        """
        Args:
            window_size: Required temporal sequence length (default: 30).
            feature_names: Expected feature names in exact order (default: 5 raw sensor columns).
        """
        if window_size < 1:
            raise ValueError(f"window_size must be >= 1, got {window_size}")

        self.window_size = window_size
        self.feature_names = list(feature_names or RAW_FEATURE_COLUMNS)
        self.num_features = len(self.feature_names)

        # Isolated storage per asset_id
        self._buffers: Dict[str, deque] = {}
        self._timestamps: Dict[str, deque] = {}

    def add_reading(
        self,
        asset_id: str,
        reading: Union[np.ndarray, List[float], Tuple[float, ...], Dict[str, float], pd.Series],
        timestamp: Optional[Any] = None,
    ) -> Optional[np.ndarray]:
        """
        Append a single chronological observation for a specific asset.

        Args:
            asset_id: Unique synthetic asset identifier (e.g. 'asset_01').
            reading: 5-element sensor measurement.
            timestamp: Optional reading timestamp or index.

        Returns:
            np.ndarray of shape (30, 5) if buffer has reached window_size observations;
            None if fewer than 30 observations exist.
        """
        if not asset_id or not isinstance(asset_id, str):
            raise ValueError(f"asset_id must be a non-empty string, got: {asset_id!r}")

        # Validate sensor observation
        val_arr = validate_single_reading(reading, self.feature_names)

        # Initialize asset queue if first observation
        if asset_id not in self._buffers:
            self._buffers[asset_id] = deque(maxlen=self.window_size)
            self._timestamps[asset_id] = deque(maxlen=self.window_size)

        # FIFO append
        self._buffers[asset_id].append(val_arr)
        self._timestamps[asset_id].append(timestamp)

        # Check if window_size is fulfilled
        if len(self._buffers[asset_id]) == self.window_size:
            return np.array(self._buffers[asset_id], dtype=np.float64)
        return None

    def get_window(self, asset_id: str) -> Optional[np.ndarray]:
        """
        Retrieve latest window for asset_id without adding a new reading.
        Returns None if buffer has fewer than window_size observations.
        """
        if asset_id not in self._buffers or len(self._buffers[asset_id]) < self.window_size:
            return None
        return np.array(self._buffers[asset_id], dtype=np.float64)

    def get_latest_timestamp(self, asset_id: str) -> Optional[Any]:
        """Retrieve most recent timestamp associated with asset_id, if any."""
        if asset_id not in self._timestamps or len(self._timestamps[asset_id]) == 0:
            return None
        return self._timestamps[asset_id][-1]

    def is_ready(self, asset_id: str) -> bool:
        """Return True if asset has accumulated at least window_size observations."""
        return asset_id in self._buffers and len(self._buffers[asset_id]) == self.window_size

    def count(self, asset_id: str) -> int:
        """Return current observation count for asset_id."""
        if asset_id not in self._buffers:
            return 0
        return len(self._buffers[asset_id])

    def reset(self, asset_id: str) -> bool:
        """
        Clear buffer strictly for the requested asset_id.
        Other assets remain completely unaffected.

        Returns:
            True if asset was found and reset, False if asset was not tracked.
        """
        if asset_id in self._buffers:
            self._buffers[asset_id].clear()
            self._timestamps[asset_id].clear()
            return True
        return False

    def reset_all(self) -> None:
        """Clear all buffers across all assets."""
        self._buffers.clear()
        self._timestamps.clear()

    def list_active_assets(self) -> List[str]:
        """Return sorted list of asset IDs currently stored."""
        return sorted(list(self._buffers.keys()))

    def get_status(self, asset_id: Optional[str] = None) -> Dict[str, Any]:
        """Return buffer telemetry status dictionary."""
        if asset_id is not None:
            cnt = self.count(asset_id)
            return {
                "asset_id": asset_id,
                "buffered_readings": cnt,
                "window_size": self.window_size,
                "is_ready": (cnt == self.window_size),
                "latest_timestamp": self.get_latest_timestamp(asset_id),
            }
        return {
            "window_size": self.window_size,
            "num_tracked_assets": len(self._buffers),
            "assets": {aid: self.count(aid) for aid in self.list_active_assets()},
        }

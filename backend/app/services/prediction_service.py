"""
Live GRU Inference and Sequence Buffer Service (Phase 6).

STRICT CONTRACTUAL INVARIANTS:
1. Model & Scaler: Strictly uses frozen GRU checkpoint and training-fit scaler.
   No retraining, fine-tuning, or dynamic threshold adjustments.
2. Feature Integrity: Strictly inputs the 5 raw sensor features:
   [Air temperature, Process temperature, Rotational speed, Torque, Tool wear].
   NEVER inputs smoothed values, engineered features, or ground truth.
3. Sequence Integrity: Requires exactly 30 contiguous valid observations.
   If a sequence gap is detected in edge metadata or sequence progression,
   the asset's buffer is immediately reset to prevent cross-gap window construction.
4. Not-Ready Semantics: Returns None until 30 contiguous readings are accumulated.
5. Threshold: Evaluates sigmoid(logit) against 0.55 lookahead failure warning.
"""

from datetime import datetime, timezone
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from backend.app.config import Settings, get_settings
from ml.inference.asset_buffer import AssetTelemetryBuffer
from ml.inference.predictor import EXPECTED_RAW_FEATURES, FrozenGRUPredictor

logger = logging.getLogger("backend.prediction")


class PredictionService:
    """
    Manages per-asset rolling temporal windows and live GRU failure predictions.
    """

    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()

        # Locate model checkpoint and scaler relative to project root
        project_root = Path(__file__).resolve().parent.parent.parent.parent
        checkpoint_path = project_root / self.settings.gru_checkpoint_path
        scaler_path = project_root / self.settings.scaler_path

        logger.info(f"Loading FrozenGRUPredictor from: {checkpoint_path}")
        logger.info(f"Loading FeatureScaler from: {scaler_path}")

        self.predictor = FrozenGRUPredictor(
            checkpoint_path=checkpoint_path,
            scaler_path=scaler_path,
            threshold=self.settings.gru_threshold,
            device=self.settings.gru_device,
        )

        self.buffer = AssetTelemetryBuffer(
            window_size=self.settings.gru_window_size,
            feature_names=EXPECTED_RAW_FEATURES,
        )

        # Per-asset sequence number tracking for gap invalidation
        self._last_seen_sequences: Dict[str, int] = {}

    def get_buffer_status(self, asset_id: str) -> Dict[str, Any]:
        """Return buffer accumulation count and readiness for an asset."""
        return {
            "asset_id": asset_id,
            "accumulated_observations": self.buffer.count(asset_id),
            "required_window_size": self.buffer.window_size,
            "is_ready": self.buffer.is_ready(asset_id),
            "last_sequence_number": self._last_seen_sequences.get(asset_id),
        }

    def reset_buffer(self, asset_id: str) -> bool:
        """Reset temporal buffer for an asset."""
        self._last_seen_sequences.pop(asset_id, None)
        return self.buffer.reset(asset_id)

    def process_telemetry(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Ingest a valid processed telemetry payload and evaluate for failure prediction.

        Returns:
            Dict containing prediction result if buffer is ready (30 contiguous readings);
            None if buffer is still accumulating or was reset due to a sequence gap.
        """
        asset_id = str(payload["asset_id"])
        seq_num = int(payload["sequence_number"])
        timestamp = payload.get("timestamp")

        # -------------------------------------------------------------
        # 1. Critical Sequence-Integrity Rule: Check for Sequence Gaps
        # -------------------------------------------------------------
        edge_meta = payload.get("edge", {})
        has_edge_gap = edge_meta.get("sequence_gaps") is not None
        has_local_gap = (
            asset_id in self._last_seen_sequences
            and seq_num > (self._last_seen_sequences[asset_id] + 1)
        )

        if has_edge_gap or has_local_gap:
            prev_seq = self._last_seen_sequences.get(asset_id, "unknown")
            logger.warning(
                f"Sequence gap detected for asset '{asset_id}' (previous: #{prev_seq}, "
                f"received: #{seq_num}). Resetting GRU buffer to prevent cross-gap prediction."
            )
            self.buffer.reset(asset_id)

        self._last_seen_sequences[asset_id] = seq_num

        # -------------------------------------------------------------
        # 2. Extract strictly the 5 raw sensor features
        # -------------------------------------------------------------
        raw_reading = [
            float(payload["air_temperature"]),
            float(payload["process_temperature"]),
            float(payload["rotational_speed"]),
            float(payload["torque"]),
            float(payload["tool_wear"]),
        ]

        # -------------------------------------------------------------
        # 3. Append to isolated FIFO asset buffer
        # -------------------------------------------------------------
        window = self.buffer.add_reading(
            asset_id=asset_id,
            reading=raw_reading,
            timestamp=timestamp,
        )

        if window is None:
            # Buffer not yet filled (accumulating 1..29 readings)
            return None

        # -------------------------------------------------------------
        # 4. Window is complete (exactly 30 contiguous valid readings)
        #    Execute frozen GRU inference
        # -------------------------------------------------------------
        prediction_result = self.predictor.predict(
            window=window,
            asset_id=asset_id,
            timestamp=timestamp,
        )

        # Include sequence start/end timestamps from the buffer
        timestamps = self.buffer._timestamps.get(asset_id)
        if timestamps and len(timestamps) == self.buffer.window_size:
            prediction_result["sequence_start_timestamp"] = timestamps[0]
            prediction_result["sequence_end_timestamp"] = timestamps[-1]

        logger.info(
            f"Prediction calculated for asset '{asset_id}': "
            f"prob={prediction_result['failure_probability']:.4f}, "
            f"prediction={prediction_result['prediction']} "
            f"(threshold={prediction_result['threshold']})"
        )

        return prediction_result

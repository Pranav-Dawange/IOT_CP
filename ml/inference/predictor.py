"""
Frozen GRU Inference Predictor for Phase 3 Production Integration.

PREPROCESSING CONTRACT & INVARIANTS:
1. Model is strictly FROZEN (no retraining, no architecture modifications, no tuning).
2. Input features: EXACTLY the 5 raw sensor features in chronological order:
   - Air temperature [K]
   - Process temperature [K]
   - Rotational speed [rpm]
   - Torque [Nm]
   - Tool wear [min]
3. Scaler: StandardScaler fitted EXCLUSIVELY on the training split (data/processed/scaler.pkl).
   Do NOT fit/refit during inference.
   Do NOT use scaler_engineered.pkl.
   Do NOT compute engineered features.
4. Input window: Raw 30 x 5 sensor array (WINDOW_SIZE = 30).
5. Output:
   - Raw logit from GRUClassifier
   - Failure probability estimate via torch.sigmoid(logit)
   - Binary prediction via threshold 0.55 (PREDICTION_HORIZON = 10 timesteps lookahead).
"""

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd
import torch

from ml.models.gru import GRUClassifier
from ml.preprocessing.preprocess import FeatureScaler

# Feature ordering contract
EXPECTED_RAW_FEATURES: List[str] = [
    "Air temperature [K]",
    "Process temperature [K]",
    "Rotational speed [rpm]",
    "Torque [Nm]",
    "Tool wear [min]",
]

DEFAULT_CHECKPOINT_PATH: Path = Path("ml/checkpoints/gru_model.pt")
DEFAULT_SCALER_PATH: Path = Path("data/processed/scaler.pkl")
DEFAULT_THRESHOLD: float = 0.55
WINDOW_SIZE: int = 30
PREDICTION_HORIZON: int = 10
INPUT_SIZE: int = 5
HIDDEN_SIZE: int = 64
NUM_LAYERS: int = 2
DROPOUT: float = 0.2
BIDIRECTIONAL: bool = False


class FrozenGRUPredictor:
    """
    Frozen GRU Inference Engine for Industrial Asset Failure Prediction.
    """

    def __init__(
        self,
        checkpoint_path: Union[str, Path] = DEFAULT_CHECKPOINT_PATH,
        scaler_path: Union[str, Path] = DEFAULT_SCALER_PATH,
        threshold: float = DEFAULT_THRESHOLD,
        device: Optional[str] = None,
    ):
        """
        Initialize frozen predictor, load model checkpoint, and verify contracts.

        Args:
            checkpoint_path: Path to trained gru_model.pt.
            scaler_path: Path to train-fitted scaler.pkl.
            threshold: Decision threshold (default: 0.55).
            device: 'cpu' or 'cuda' (default: cpu for deterministic inference).
        """
        self.checkpoint_path = Path(checkpoint_path)
        self.scaler_path = Path(scaler_path)
        self.threshold = float(threshold)

        if not (0.0 <= self.threshold <= 1.0):
            raise ValueError(f"Threshold must be in [0.0, 1.0], got {self.threshold}")

        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.feature_names = list(EXPECTED_RAW_FEATURES)

        # 1. Load and validate FeatureScaler
        self._load_and_validate_scaler()

        # 2. Load, reconstruct, and freeze GRU model
        self._load_and_reconstruct_model()

    def _load_and_validate_scaler(self) -> None:
        """Validate scaler file existence, feature dimensions, and feature ordering."""
        if not self.scaler_path.is_file():
            raise FileNotFoundError(
                f"Fitted scaler not found at: {self.scaler_path.resolve()}. "
                f"Inference requires the scaler fitted strictly on the training split."
            )

        self.scaler = FeatureScaler.load(self.scaler_path)

        if not getattr(self.scaler, "fitted", False):
            raise RuntimeError(f"Loaded scaler from {self.scaler_path} is NOT marked as fitted.")

        if len(self.scaler.feature_names) != INPUT_SIZE:
            raise ValueError(
                f"Scaler expects {len(self.scaler.feature_names)} features, but model expects {INPUT_SIZE}."
            )

        if list(self.scaler.feature_names) != self.feature_names:
            raise ValueError(
                f"Scaler feature names mismatch!\n"
                f"Expected order: {self.feature_names}\n"
                f"Found in scaler: {list(self.scaler.feature_names)}"
            )

    def _load_and_reconstruct_model(self) -> None:
        """Load checkpoint, verify architecture & input dimensions, and freeze weights."""
        if not self.checkpoint_path.is_file():
            raise FileNotFoundError(
                f"Checkpoint not found at: {self.checkpoint_path.resolve()}. "
                f"Inference requires trained checkpoint: ml/checkpoints/gru_model.pt"
            )

        checkpoint = torch.load(self.checkpoint_path, map_location=self.device)
        state_dict = checkpoint.get("model_state_dict")

        if state_dict is None:
            raise KeyError(
                f"Checkpoint at {self.checkpoint_path} is missing 'model_state_dict'."
            )

        # Validate recurrent architecture type
        if "gru.weight_ih_l0" not in state_dict:
            if "lstm.weight_ih_l0" in state_dict:
                raise ValueError(
                    f"Checkpoint at {self.checkpoint_path} contains LSTM weights, "
                    f"but FrozenGRUPredictor requires a GRU model."
                )
            raise KeyError(
                f"Checkpoint at {self.checkpoint_path} is missing 'gru.weight_ih_l0'."
            )

        # Validate input dimension
        weight_ih = state_dict["gru.weight_ih_l0"]
        ckpt_input_size = weight_ih.shape[1]
        if ckpt_input_size != INPUT_SIZE:
            raise ValueError(
                f"Checkpoint expects {ckpt_input_size} input features, but FrozenGRUPredictor expects {INPUT_SIZE}."
            )

        # Check explicit metadata if present
        if checkpoint.get("model_type") and checkpoint["model_type"] != "gru":
            raise ValueError(
                f"Checkpoint metadata model_type='{checkpoint['model_type']}', expected 'gru'."
            )
        if checkpoint.get("input_size") and checkpoint["input_size"] != INPUT_SIZE:
            raise ValueError(
                f"Checkpoint metadata input_size={checkpoint['input_size']}, expected {INPUT_SIZE}."
            )
        if checkpoint.get("feature_set") and checkpoint["feature_set"] != "raw":
            raise ValueError(
                f"Checkpoint metadata feature_set='{checkpoint['feature_set']}', expected 'raw'."
            )

        # Reconstruct exact GRUClassifier architecture
        self.model = GRUClassifier(
            input_size=INPUT_SIZE,
            hidden_size=HIDDEN_SIZE,
            num_layers=NUM_LAYERS,
            dropout=DROPOUT,
            bidirectional=BIDIRECTIONAL,
        ).to(self.device)

        # Load weights
        self.model.load_state_dict(state_dict)

        # Force evaluation mode and freeze parameters
        self.model.eval()
        for param in self.model.parameters():
            param.requires_grad = False

        self.checkpoint_epoch = checkpoint.get("epoch", "N/A")
        self.checkpoint_val_loss = checkpoint.get("val_loss", "N/A")

    def _validate_raw_window(
        self,
        window: Union[np.ndarray, pd.DataFrame, List[List[float]], torch.Tensor],
    ) -> np.ndarray:
        """
        Validate incoming raw sensor window.

        Enforces:
        - Exactly 2 dimensions of shape (30, 5)
        - No NaN values
        - No Infinite values
        - Correct feature ordering
        """
        if isinstance(window, pd.DataFrame):
            # If DataFrame, check column names
            missing_cols = [c for c in self.feature_names if c not in window.columns]
            if missing_cols:
                raise ValueError(
                    f"DataFrame window is missing required sensor columns: {missing_cols}. "
                    f"Expected columns in exact order: {self.feature_names}"
                )
            arr = window[self.feature_names].to_numpy(dtype=np.float64)
        elif isinstance(window, torch.Tensor):
            arr = window.detach().cpu().numpy().astype(np.float64)
        else:
            try:
                arr = np.asarray(window, dtype=np.float64)
            except Exception as e:
                raise ValueError(f"Could not convert input window to numeric array: {e}")

        # Dimension checks
        if arr.ndim != 2:
            raise ValueError(
                f"Input window must be a 2D array of shape ({WINDOW_SIZE}, {INPUT_SIZE}), "
                f"got {arr.ndim}D array with shape {arr.shape}."
            )

        if arr.shape != (WINDOW_SIZE, INPUT_SIZE):
            raise ValueError(
                f"Input window shape mismatch: expected ({WINDOW_SIZE}, {INPUT_SIZE}), got {arr.shape}. "
                f"A complete temporal sequence of {WINDOW_SIZE} timesteps on {INPUT_SIZE} features is required."
            )

        # Numerical checks
        if np.isnan(arr).any():
            nan_rows, nan_cols = np.where(np.isnan(arr))
            first_col_name = self.feature_names[nan_cols[0]]
            raise ValueError(
                f"Input window contains NaN values (e.g. at timestep {nan_rows[0]}, feature '{first_col_name}'). "
                f"Inference requires valid numeric sensor observations."
            )

        if np.isinf(arr).any():
            inf_rows, inf_cols = np.where(np.isinf(arr))
            first_col_name = self.feature_names[inf_cols[0]]
            raise ValueError(
                f"Input window contains Infinite values (e.g. at timestep {inf_rows[0]}, feature '{first_col_name}')."
            )

        return arr

    def predict(
        self,
        window: Union[np.ndarray, pd.DataFrame, List[List[float]], torch.Tensor],
        asset_id: Optional[str] = None,
        timestamp: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Perform frozen GRU inference on a raw 30 x 5 sensor observation window.

        Preprocessing Steps:
        1. Validate raw (30, 5) window integrity (no NaNs/Infs).
        2. Transform using the frozen training-fit scaler.
        3. Convert to tensor (1, 30, 5).
        4. Forward pass under torch.no_grad().
        5. Compute failure probability estimate via torch.sigmoid(logit).
        6. Compare against threshold 0.55 to produce binary prediction.

        Args:
            window: 30 x 5 array of unscaled sensor measurements.
            asset_id: Optional asset identifier (e.g. 'asset_07').
            timestamp: Optional observation timestamp.

        Returns:
            Structured prediction dictionary matching the contract.
        """
        raw_arr = self._validate_raw_window(window)

        # Scale using training-fit scaler (DO NOT refit)
        scaled_arr = self.scaler.transform(raw_arr)

        # Convert to PyTorch tensor (1, sequence_length=30, input_size=5)
        tensor_input = (
            torch.tensor(scaled_arr, dtype=torch.float32).unsqueeze(0).to(self.device)
        )

        # Execute frozen inference
        with torch.no_grad():
            logit = self.model(tensor_input)
            prob = float(torch.sigmoid(logit).squeeze().item())

        prediction = 1 if prob >= self.threshold else 0

        result: Dict[str, Any] = {
            "failure_probability": round(prob, 4),
            "prediction": prediction,
            "threshold": self.threshold,
            "window_size": WINDOW_SIZE,
            "prediction_horizon": PREDICTION_HORIZON,
            "model_type": "GRU",
            "feature_set": "raw",
        }

        if asset_id is not None:
            result["asset_id"] = str(asset_id)

        if timestamp is not None:
            result["timestamp"] = timestamp

        return result

    def predict_batch(
        self,
        windows: Union[np.ndarray, torch.Tensor],
        asset_ids: Optional[List[str]] = None,
        timestamps: Optional[List[Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Batch inference for multiple 30 x 5 windows.

        Args:
            windows: Array of shape (B, 30, 5).
            asset_ids: Optional list of asset IDs of length B.
            timestamps: Optional list of timestamps of length B.

        Returns:
            List of structured prediction result dictionaries.
        """
        if isinstance(windows, torch.Tensor):
            arr = windows.detach().cpu().numpy().astype(np.float64)
        else:
            arr = np.asarray(windows, dtype=np.float64)

        if arr.ndim != 3 or arr.shape[1] != WINDOW_SIZE or arr.shape[2] != INPUT_SIZE:
            raise ValueError(
                f"Batch input shape must be (B, {WINDOW_SIZE}, {INPUT_SIZE}), got {arr.shape}."
            )

        if np.isnan(arr).any():
            raise ValueError("Batch input contains NaN values.")
        if np.isinf(arr).any():
            raise ValueError("Batch input contains Infinite values.")

        b_size = arr.shape[0]

        # Transform using training-fit scaler
        scaled_arr = self.scaler.transform(arr)
        tensor_input = torch.tensor(scaled_arr, dtype=torch.float32).to(self.device)

        with torch.no_grad():
            logits = self.model(tensor_input)
            probs = torch.sigmoid(logits).squeeze(-1).cpu().numpy().tolist()

        if isinstance(probs, float):
            probs = [probs]

        results = []
        for i, prob_val in enumerate(probs):
            prob_float = float(prob_val)
            pred = 1 if prob_float >= self.threshold else 0
            item: Dict[str, Any] = {
                "failure_probability": round(prob_float, 4),
                "prediction": pred,
                "threshold": self.threshold,
                "window_size": WINDOW_SIZE,
                "prediction_horizon": PREDICTION_HORIZON,
                "model_type": "GRU",
                "feature_set": "raw",
            }
            if asset_ids is not None and i < len(asset_ids):
                item["asset_id"] = str(asset_ids[i])
            if timestamps is not None and i < len(timestamps):
                item["timestamp"] = timestamps[i]
            results.append(item)

        return results

    def predict_from_buffer(
        self,
        asset_id: str,
        reading: Union[np.ndarray, List[float], Dict[str, float]],
        buffer: Any,
        timestamp: Optional[Any] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Convenience integration helper with AssetTelemetryBuffer.
        Appends reading; if buffer reaches 30 readings, generates prediction.

        Args:
            asset_id: Asset identifier.
            reading: Single observation (length 5).
            buffer: Instance of AssetTelemetryBuffer.
            timestamp: Optional observation timestamp.

        Returns:
            Prediction dict if buffer is ready (>= 30 readings); None if buffer is accumulating.
        """
        window = buffer.add_reading(asset_id, reading, timestamp=timestamp)
        if window is None:
            return None
        return self.predict(window, asset_id=asset_id, timestamp=timestamp)

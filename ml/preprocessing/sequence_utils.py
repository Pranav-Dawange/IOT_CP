"""
Sequence Utilities for PyTorch LSTM Input Preparation with Synthetic Asset Partitioning.

AI4I 2020 Predictive Maintenance System - Phase 2 Infrastructure.

METHODOLOGICAL PRINCIPLE:
"AI4I 2020 is not treated as a genuine per-machine time series. Ordered records are
assigned to synthetic assets, and temporal windows are constructed independently within each asset."

SYNTHETIC ASSET INTEGRITY RULES:
1. Configurable Synthetic Asset Assignment:
   Contiguous blocks of rows (default block_size = 500) are assigned to synthetic assets.
   (e.g., asset_01 -> rows 0..499, asset_02 -> rows 500..999, ...).
2. Chronological Ordering: Preserved strictly inside every asset.
3. Historical Window (WINDOW_SIZE = 30):
   Constructed separately within each asset. A sequence [t-29 ... t] is created ONLY
   when all 30 observations belong to the SAME asset.
4. Future Prediction Horizon (PREDICTION_HORIZON = 10):
   Target y[t] = 1 if Machine failure == 1 at ANY timestep in [t+1 ... t+10], otherwise 0.
   Constructed separately within each asset.
5. NEVER let the future horizon cross an asset boundary.
6. NEVER let the historical window cross an asset boundary.
7. Train / validation / test split boundaries remain strictly isolated.

IMPORTANT:
This module ONLY prepares sequential data structures and sliding windows.
It does NOT define model architectures, execute training loops, or compute loss.
"""

from typing import Any, Dict, List, Literal, Optional, Tuple, Union

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset

DEFAULT_WINDOW_SIZE: int = 30
DEFAULT_PREDICTION_HORIZON: int = 10
DEFAULT_ASSET_BLOCK_SIZE: int = 500
DEFAULT_STRIDE: int = 1
TargetMode = Literal["future_horizon", "last", "next", "any_window"]


def assign_synthetic_assets(
    n_samples: int,
    block_size: int = DEFAULT_ASSET_BLOCK_SIZE,
    prefix: str = "asset",
) -> np.ndarray:
    """
    Assign contiguous blocks of rows to synthetic asset IDs.

    Args:
        n_samples: Total number of rows.
        block_size: Number of contiguous rows per synthetic asset (default: 500).
        prefix: Asset identifier string prefix.

    Returns:
        Array of string asset IDs of length n_samples.
    """
    asset_ids = []
    for i in range(n_samples):
        asset_idx = (i // block_size) + 1
        asset_ids.append(f"{prefix}_{asset_idx:02d}")
    return np.array(asset_ids)


def create_sliding_window_arrays(
    features: Union[np.ndarray, "torch.Tensor"],
    targets: Optional[Union[np.ndarray, "torch.Tensor"]] = None,
    asset_ids: Optional[Union[np.ndarray, List[str]]] = None,
    window_size: int = DEFAULT_WINDOW_SIZE,
    prediction_horizon: int = DEFAULT_PREDICTION_HORIZON,
    asset_block_size: int = DEFAULT_ASSET_BLOCK_SIZE,
    stride: int = DEFAULT_STRIDE,
    target_mode: TargetMode = "future_horizon",
) -> Tuple[np.ndarray, Optional[np.ndarray]]:
    """
    Generate sliding window arrays partitioned strictly by synthetic asset.

    Guarantees:
    - No historical window crosses an asset boundary.
    - No future horizon crosses an asset boundary.

    Args:
        features: 2D array of sensor features of shape (N, D).
        targets: Optional 1D or 2D array of binary failure indicators of shape (N,) or (N, 1).
        asset_ids: Optional array of asset identifiers. If None, auto-generated from asset_block_size.
        window_size: Historical sensor timesteps ending at t (default: 30).
        prediction_horizon: Future lookahead timesteps [t+1..t+H] (default: 10).
        asset_block_size: Contiguous rows per synthetic asset if asset_ids is None (default: 500).
        stride: Step size between consecutive sequence windows (default: 1).
        target_mode: 'future_horizon', 'last', 'next', or 'any_window'.

    Returns:
        X_seq: Numpy array of shape (num_windows, window_size, D).
        y_seq: Numpy array of shape (num_windows,) if targets provided, else None.
    """
    if isinstance(features, torch.Tensor):
        features = features.detach().cpu().numpy()
    if targets is not None and isinstance(targets, torch.Tensor):
        targets = targets.detach().cpu().numpy()

    features = np.asarray(features, dtype=np.float32)
    n_samples, n_features = features.shape

    if targets is not None:
        targets = np.asarray(targets).ravel()
        if len(targets) != n_samples:
            raise ValueError(f"Features length ({n_samples}) != targets length ({len(targets)})")

    # Generate synthetic asset IDs if not provided
    if asset_ids is None:
        asset_ids = assign_synthetic_assets(n_samples, block_size=asset_block_size)
    else:
        asset_ids = np.asarray(asset_ids)
        if len(asset_ids) != n_samples:
            raise ValueError(f"Features length ({n_samples}) != asset_ids length ({len(asset_ids)})")

    # Identify contiguous asset blocks
    unique_assets = []
    asset_slices: List[Tuple[str, int, int]] = []

    current_asset = asset_ids[0]
    start_idx = 0
    for i in range(1, n_samples):
        if asset_ids[i] != current_asset:
            asset_slices.append((current_asset, start_idx, i))
            current_asset = asset_ids[i]
            start_idx = i
    asset_slices.append((current_asset, start_idx, n_samples))

    X_windows = []
    y_windows = []

    # Process each asset independently
    for asset_name, a_start, a_end in asset_slices:
        sub_features = features[a_start:a_end]
        sub_targets = targets[a_start:a_end] if targets is not None else None
        sub_len = a_end - a_start

        min_required = window_size + (prediction_horizon if target_mode == "future_horizon" else 0)
        if sub_len < min_required:
            continue

        if target_mode == "future_horizon":
            max_start = sub_len - window_size - prediction_horizon + 1
        elif target_mode == "next":
            max_start = sub_len - window_size
        else:
            max_start = sub_len - window_size + 1

        for local_start in range(0, max_start, stride):
            local_end = local_start + window_size
            window_x = sub_features[local_start:local_end]
            X_windows.append(window_x)

            if sub_targets is not None:
                if target_mode == "future_horizon":
                    horizon_y = sub_targets[local_end : local_end + prediction_horizon]
                    y_label = 1.0 if np.any(horizon_y == 1) else 0.0
                elif target_mode == "last":
                    y_label = float(sub_targets[local_end - 1])
                elif target_mode == "next":
                    y_label = float(sub_targets[local_end])
                elif target_mode == "any_window":
                    y_label = 1.0 if np.any(sub_targets[local_start:local_end] == 1) else 0.0
                else:
                    raise ValueError(f"Unknown target_mode: {target_mode}")
                y_windows.append(y_label)

    X_seq = np.array(X_windows, dtype=np.float32) if X_windows else np.empty((0, window_size, n_features), dtype=np.float32)
    y_seq = np.array(y_windows, dtype=np.float32) if (y_windows and targets is not None) else None

    return X_seq, y_seq


class LSTMSequenceDataset(Dataset):
    """
    Memory-efficient PyTorch Dataset for sequential sliding windows per synthetic asset.
    Generates windows strictly within each asset's boundary via pre-indexed slice tuples.
    """

    def __init__(
        self,
        features: Union[np.ndarray, torch.Tensor],
        targets: Optional[Union[np.ndarray, torch.Tensor]] = None,
        asset_ids: Optional[Union[np.ndarray, List[str]]] = None,
        window_size: int = DEFAULT_WINDOW_SIZE,
        prediction_horizon: int = DEFAULT_PREDICTION_HORIZON,
        asset_block_size: int = DEFAULT_ASSET_BLOCK_SIZE,
        stride: int = DEFAULT_STRIDE,
        target_mode: TargetMode = "future_horizon",
    ):
        super().__init__()
        if isinstance(features, torch.Tensor):
            self.features = features.float()
        else:
            self.features = torch.tensor(features, dtype=torch.float32)

        self.has_targets = targets is not None
        if self.has_targets:
            if isinstance(targets, torch.Tensor):
                self.targets = targets.float().view(-1)
            else:
                self.targets = torch.tensor(np.asarray(targets).ravel(), dtype=torch.float32)
            if len(self.targets) != len(self.features):
                raise ValueError("Features and targets must have identical length.")
        else:
            self.targets = None

        self.window_size = window_size
        self.prediction_horizon = prediction_horizon
        self.stride = stride
        self.target_mode = target_mode
        self.n_samples = len(self.features)

        # Generate synthetic asset IDs if not provided
        if asset_ids is None:
            self.asset_ids = assign_synthetic_assets(self.n_samples, block_size=asset_block_size)
        else:
            self.asset_ids = np.asarray(asset_ids)

        # Pre-index valid sequence slice coordinates strictly within each asset
        self.valid_slices: List[Tuple[int, int, int]] = []
        self._build_asset_slices()

    def _build_asset_slices(self) -> None:
        """Find contiguous asset boundaries and pre-index valid sequences."""
        # Detect asset boundaries
        asset_blocks: List[Tuple[int, int]] = []
        start_idx = 0
        current_asset = self.asset_ids[0]

        for i in range(1, self.n_samples):
            if self.asset_ids[i] != current_asset:
                asset_blocks.append((start_idx, i))
                current_asset = self.asset_ids[i]
                start_idx = i
        asset_blocks.append((start_idx, self.n_samples))

        # Generate valid windows within each asset block
        for a_start, a_end in asset_blocks:
            sub_len = a_end - a_start
            min_required = self.window_size + (
                self.prediction_horizon if self.target_mode == "future_horizon" else 0
            )
            if sub_len < min_required:
                continue

            if self.target_mode == "future_horizon":
                max_start = sub_len - self.window_size - self.prediction_horizon + 1
            elif self.target_mode == "next":
                max_start = sub_len - self.window_size
            else:
                max_start = sub_len - self.window_size + 1

            for local_start in range(0, max_start, self.stride):
                global_start_x = a_start + local_start
                global_end_x = global_start_x + self.window_size
                self.valid_slices.append((a_start, global_start_x, global_end_x))

    def __len__(self) -> int:
        return len(self.valid_slices)

    def __getitem__(self, idx: int) -> Union[torch.Tensor, Tuple[torch.Tensor, torch.Tensor]]:
        a_start, start_x, end_x = self.valid_slices[idx]
        x_window = self.features[start_x:end_x]  # Shape: (window_size, num_features)

        if not self.has_targets:
            return x_window

        if self.target_mode == "future_horizon":
            start_fut = end_x
            end_fut = end_x + self.prediction_horizon
            horizon_y = self.targets[start_fut:end_fut]
            y_val = torch.tensor(
                [1.0 if torch.any(horizon_y == 1.0) else 0.0], dtype=torch.float32
            )
        elif self.target_mode == "last":
            y_val = self.targets[end_x - 1].view(1)
        elif self.target_mode == "next":
            y_val = self.targets[end_x].view(1)
        elif self.target_mode == "any_window":
            y_val = torch.tensor(
                [1.0 if torch.any(self.targets[start_x:end_x] == 1.0) else 0.0],
                dtype=torch.float32,
            )
        else:
            raise ValueError(f"Unknown target_mode: {self.target_mode}")

        return x_window, y_val


def create_dataloaders(
    train_data: Tuple[np.ndarray, np.ndarray],
    val_data: Tuple[np.ndarray, np.ndarray],
    test_data: Optional[Tuple[np.ndarray, np.ndarray]] = None,
    window_size: int = DEFAULT_WINDOW_SIZE,
    prediction_horizon: int = DEFAULT_PREDICTION_HORIZON,
    asset_block_size: int = DEFAULT_ASSET_BLOCK_SIZE,
    batch_size: int = 64,
    shuffle_train: bool = True,
    target_mode: TargetMode = "future_horizon",
    num_workers: int = 0,
) -> Dict[str, DataLoader]:
    """Construct PyTorch DataLoaders partitioned by synthetic assets."""
    train_ds = LSTMSequenceDataset(
        features=train_data[0],
        targets=train_data[1],
        window_size=window_size,
        prediction_horizon=prediction_horizon,
        asset_block_size=asset_block_size,
        target_mode=target_mode,
    )
    val_ds = LSTMSequenceDataset(
        features=val_data[0],
        targets=val_data[1],
        window_size=window_size,
        prediction_horizon=prediction_horizon,
        asset_block_size=asset_block_size,
        target_mode=target_mode,
    )

    loaders = {
        "train": DataLoader(
            train_ds, batch_size=batch_size, shuffle=shuffle_train, num_workers=num_workers
        ),
        "val": DataLoader(
            val_ds, batch_size=batch_size, shuffle=False, num_workers=num_workers
        ),
    }

    if test_data is not None:
        test_ds = LSTMSequenceDataset(
            features=test_data[0],
            targets=test_data[1],
            window_size=window_size,
            prediction_horizon=prediction_horizon,
            asset_block_size=asset_block_size,
            target_mode=target_mode,
        )
        loaders["test"] = DataLoader(
            test_ds, batch_size=batch_size, shuffle=False, num_workers=num_workers
        )

    return loaders


def validate_sequence_shapes(
    X_seq: np.ndarray,
    y_seq: Optional[np.ndarray] = None,
    expected_window_size: int = DEFAULT_WINDOW_SIZE,
    expected_features: int = 5,
) -> Dict[str, Any]:
    """Validate sequence window dimensions, check for NaNs/Infs, and report summary statistics."""
    if X_seq.ndim != 3:
        raise ValueError(f"Expected 3D array (N, T, D), got {X_seq.ndim}D array")

    num_windows, seq_len, num_feat = X_seq.shape

    if seq_len != expected_window_size:
        raise ValueError(f"Expected seq_len={expected_window_size}, got {seq_len}")
    if num_feat != expected_features:
        raise ValueError(f"Expected num_features={expected_features}, got {num_feat}")

    if np.isnan(X_seq).any():
        raise ValueError("NaN values detected in sequence windows!")
    if np.isinf(X_seq).any():
        raise ValueError("Infinite values detected in sequence windows!")

    summary = {
        "num_windows": num_windows,
        "window_size": seq_len,
        "num_features": num_feat,
    }

    if y_seq is not None:
        y_flat = np.asarray(y_seq).ravel()
        if len(y_flat) != num_windows:
            raise ValueError(f"Window count {num_windows} != target count {len(y_flat)}")
        pos = int((y_flat == 1).sum())
        neg = int((y_flat == 0).sum())
        summary["positive_labels"] = pos
        summary["negative_labels"] = neg
        summary["positive_ratio"] = float(pos / num_windows) if num_windows > 0 else 0.0

    return summary

"""
PyTorch Dataset and DataLoader for Synthetic Asset-Partitioned Early Failure Prediction.

AI4I 2020 Predictive Maintenance System - Phase 2 Infrastructure.

METHODOLOGICAL PRINCIPLE:
"AI4I 2020 is not treated as a genuine per-machine time series. Ordered records are
assigned to synthetic assets, and temporal windows are constructed independently within each asset."

SYNTHETIC ASSET ISOLATION RULES:
1. Configurable Synthetic Asset Assignment:
   Contiguous blocks of rows (default asset_block_size = 500) simulate distinct assets.
   (e.g., asset_01 -> rows 0..499, asset_02 -> rows 500..999, ...).
2. Chronological Ordering:
   Preserved strictly inside every individual asset.
3. Historical Window (WINDOW_SIZE = 30):
   Generated separately within each asset. A sequence [t-29 ... t] is created ONLY
   when all 30 observations belong to the SAME asset.
4. Future Prediction Horizon (PREDICTION_HORIZON = 10):
   Target y[t] = 1 if Machine failure == 1 at ANY timestep in [t+1 ... t+10], otherwise 0.
   Constructed separately within each asset.
5. Boundary Safeguards:
   - A window crossing an asset boundary is NEVER generated.
   - A future horizon crossing an asset boundary is NEVER generated.
   - Train / validation / test splits remain strictly isolated.
"""

from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset


def assign_synthetic_assets(
    n_samples: int,
    block_size: int = 500,
    prefix: str = "asset",
) -> np.ndarray:
    """Assign contiguous blocks of rows to synthetic asset IDs."""
    asset_ids = []
    for i in range(n_samples):
        asset_idx = (i // block_size) + 1
        asset_ids.append(f"{prefix}_{asset_idx:02d}")
    return np.array(asset_ids)


class IndustrialLSTMDataset(Dataset):
    """
    PyTorch Dataset providing historical sensor windows paired with future failure horizon labels,
    partitioned strictly per synthetic asset.

    Each item returns:
        X: torch.FloatTensor of shape (window_size=30, num_features=5)
        y: torch.FloatTensor of shape (1,) with value 0.0 or 1.0 (failure in next horizon within same asset)
    """

    def __init__(
        self,
        features: Union[np.ndarray, torch.Tensor],
        targets: Union[np.ndarray, torch.Tensor],
        asset_ids: Optional[Union[np.ndarray, List[str]]] = None,
        window_size: int = 30,
        prediction_horizon: int = 10,
        asset_block_size: int = 500,
    ):
        """
        Args:
            features: 2D array of scaled sensor features of shape (N, 5).
            targets: 1D array of binary point failure labels of shape (N,).
            asset_ids: Optional array of string asset identifiers. If None, auto-generated from asset_block_size.
            window_size: Number of past/current sensor observations ending at t (default: 30).
            prediction_horizon: Number of future timesteps [t+1..t+H] inspected (default: 10).
            asset_block_size: Contiguous rows per synthetic asset if asset_ids is None (default: 500).
        """
        super().__init__()
        if isinstance(features, torch.Tensor):
            self.features = features.float()
        else:
            self.features = torch.tensor(features, dtype=torch.float32)

        if isinstance(targets, torch.Tensor):
            self.targets = targets.float().view(-1)
        else:
            self.targets = torch.tensor(np.asarray(targets).ravel(), dtype=torch.float32)

        if len(self.features) != len(self.targets):
            raise ValueError(
                f"Feature count ({len(self.features)}) must match target count ({len(self.targets)})."
            )

        self.window_size = window_size
        self.prediction_horizon = prediction_horizon
        self.asset_block_size = asset_block_size
        self.n_samples = len(self.features)

        # Generate synthetic asset IDs if not provided
        if asset_ids is None:
            self.asset_ids = assign_synthetic_assets(self.n_samples, block_size=asset_block_size)
        else:
            self.asset_ids = np.asarray(asset_ids)
            if len(self.asset_ids) != self.n_samples:
                raise ValueError(
                    f"Asset IDs length ({len(self.asset_ids)}) != features length ({self.n_samples})"
                )

        # Pre-index valid sequences strictly within asset boundaries
        self.valid_slices: List[Tuple[str, int, int]] = []
        self._build_asset_slices()

    def _build_asset_slices(self) -> None:
        """Find contiguous asset boundaries and pre-index valid sequences."""
        asset_blocks: List[Tuple[str, int, int]] = []
        start_idx = 0
        current_asset = self.asset_ids[0]

        for i in range(1, self.n_samples):
            if self.asset_ids[i] != current_asset:
                asset_blocks.append((current_asset, start_idx, i))
                current_asset = self.asset_ids[i]
                start_idx = i
        asset_blocks.append((current_asset, start_idx, self.n_samples))

        for asset_name, a_start, a_end in asset_blocks:
            sub_len = a_end - a_start
            min_required = self.window_size + self.prediction_horizon
            if sub_len < min_required:
                continue

            max_start = sub_len - self.window_size - self.prediction_horizon + 1
            for local_start in range(max_start):
                global_start_x = a_start + local_start
                global_end_x = global_start_x + self.window_size
                # All 30 observations in [global_start_x:global_end_x] are inside this asset.
                # All 10 future horizon observations in [global_end_x:global_end_x + prediction_horizon]
                # are also strictly inside this asset (since global_end_x + prediction_horizon <= a_end).
                self.valid_slices.append((asset_name, global_start_x, global_end_x))

    def __len__(self) -> int:
        return len(self.valid_slices)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Retrieves the valid sample at index idx.
        Guaranteed to belong strictly to a single synthetic asset.
        """
        asset_name, start_x, end_x = self.valid_slices[idx]

        # 30 historical sensor observations ending at t
        x_window = self.features[start_x:end_x]  # Shape: (window_size=30, num_features=5)

        # 10 future failure status observations [t+1..t+10] strictly within the same asset
        future_horizon = self.targets[end_x : end_x + self.prediction_horizon]  # Shape: (10,)

        # Target y[t] = 1 if ANY failure occurs in the next prediction_horizon timesteps
        y_val = torch.tensor(
            [1.0 if torch.any(future_horizon == 1.0) else 0.0], dtype=torch.float32
        )

        return x_window, y_val

    def get_sequence_targets(self) -> torch.Tensor:
        """
        Return all valid sequence-level targets y[t] as a 1D tensor.
        Enables exact recalculation of positive/negative class counts and pos_weight.
        """
        seq_targets = []
        for asset_name, start_x, end_x in self.valid_slices:
            horizon = self.targets[end_x : end_x + self.prediction_horizon]
            seq_targets.append(1.0 if torch.any(horizon == 1.0) else 0.0)
        return torch.tensor(seq_targets, dtype=torch.float32)

    @classmethod
    def from_npz(
        cls,
        npz_path: Union[str, Path],
        window_size: int = 30,
        prediction_horizon: int = 10,
        asset_block_size: int = 500,
    ) -> "IndustrialLSTMDataset":
        """Load dataset from compressed numpy archive and partition into synthetic assets."""
        path = Path(npz_path)
        if not path.is_file():
            raise FileNotFoundError(f"NPZ archive not found at: {path.resolve()}")

        archive = np.load(path)
        features = archive["features"]
        targets = archive["targets"]
        return cls(
            features=features,
            targets=targets,
            window_size=window_size,
            prediction_horizon=prediction_horizon,
            asset_block_size=asset_block_size,
        )


def create_lstm_dataloaders(
    train_npz: Union[str, Path] = "data/processed/train_scaled.npz",
    val_npz: Union[str, Path] = "data/processed/val_scaled.npz",
    test_npz: Optional[Union[str, Path]] = "data/processed/test_scaled.npz",
    window_size: int = 30,
    prediction_horizon: int = 10,
    asset_block_size: int = 500,
    batch_size: int = 64,
    shuffle_train: bool = True,
    num_workers: int = 0,
) -> Dict[str, DataLoader]:
    """
    Constructs PyTorch DataLoaders partitioned by synthetic assets.

    Args:
        train_npz: Path to train_scaled.npz.
        val_npz: Path to val_scaled.npz.
        test_npz: Path to test_scaled.npz (optional).
        window_size: Historical observations per window (default: 30).
        prediction_horizon: Future lookahead timesteps (default: 10).
        asset_block_size: Contiguous rows per synthetic asset (default: 500).
        batch_size: Mini-batch size (default: 64).
        shuffle_train: Whether to shuffle sequence windows during training.
        num_workers: Worker processes for data loading.

    Returns:
        Dict with keys 'train', 'val', and optionally 'test'.
    """
    train_dataset = IndustrialLSTMDataset.from_npz(
        train_npz,
        window_size=window_size,
        prediction_horizon=prediction_horizon,
        asset_block_size=asset_block_size,
    )
    val_dataset = IndustrialLSTMDataset.from_npz(
        val_npz,
        window_size=window_size,
        prediction_horizon=prediction_horizon,
        asset_block_size=asset_block_size,
    )

    loaders = {
        "train": DataLoader(
            train_dataset,
            batch_size=batch_size,
            shuffle=shuffle_train,
            num_workers=num_workers,
            pin_memory=False,
        ),
        "val": DataLoader(
            val_dataset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=False,
        ),
    }

    if test_npz is not None and Path(test_npz).is_file():
        test_dataset = IndustrialLSTMDataset.from_npz(
            test_npz,
            window_size=window_size,
            prediction_horizon=prediction_horizon,
            asset_block_size=asset_block_size,
        )
        loaders["test"] = DataLoader(
            test_dataset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=False,
        )

    return loaders

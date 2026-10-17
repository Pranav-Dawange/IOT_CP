"""
Comprehensive Unit Test Suite for Synthetic Asset Partitioning and Early Failure Prediction.

Validates the core project requirements:
Test A: A window entirely inside an asset is valid.
Test B: A window crossing an asset boundary is rejected / not generated.
Test C: A future horizon crossing an asset boundary is rejected / not generated.
Test D: The 30-history + 10-future horizon formulation is correct.
Test E: Recalculates sequence counts, class distributions, and dynamic pos_weight
        for TRAIN, VALIDATION, and TEST splits.
"""

import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
import torch
from ml.datasets.lstm_dataset import IndustrialLSTMDataset, assign_synthetic_assets
from ml.preprocessing.sequence_utils import create_sliding_window_arrays


def test_a_window_entirely_inside_asset():
    """
    Test A: Proves that a 30-timestep historical window and 10-timestep future horizon
    completely situated inside an asset boundary is valid and generated.
    """
    print("\n--- TEST A: WINDOW ENTIRELY INSIDE AN ASSET IS VALID ---")
    # Asset 1 has 60 rows (rows 0 to 59).
    # Asset 2 has 60 rows (rows 60 to 119).
    total_rows = 120
    features = np.zeros((total_rows, 5), dtype=np.float32)
    for i in range(total_rows):
        features[i, :] = float(i)
    targets = np.zeros(total_rows, dtype=np.float32)

    dataset = IndustrialLSTMDataset(
        features=features,
        targets=targets,
        window_size=30,
        prediction_horizon=10,
        asset_block_size=60,
    )

    # First sequence in Asset 1: covers historical timesteps 0..29 (t=29)
    # Horizon covers timesteps 30..39 (well before asset boundary at row 60)
    x_win, y_label = dataset[0]

    print(f"Sample 0 (Asset 1, t = 29):")
    print(f"  Historical window shape: {tuple(x_win.shape)}")
    print(f"  Window start index value: {x_win[0, 0].item()} (row 0)")
    print(f"  Window end index value:   {x_win[-1, 0].item()} (row 29)")
    print(f"  Asset 1 boundary: [row 0 .. row 59]")
    print(f"  Future horizon:   [row 30 .. row 39] (inside Asset 1)")

    assert x_win.shape == (30, 5), f"Expected (30, 5), got {x_win.shape}"
    assert x_win[0, 0].item() == 0.0
    assert x_win[-1, 0].item() == 29.0
    print("  -> PROVEN: Window and horizon entirely inside asset is VALID and generated.")


def test_b_window_crossing_asset_boundary_rejected():
    """
    Test B: Proves that NO historical window crosses an asset boundary.
    Any candidate window that would mix observations from Asset 1 and Asset 2 is rejected.
    """
    print("\n--- TEST B: WINDOW CROSSING ASSET BOUNDARY IS REJECTED / NOT GENERATED ---")
    total_rows = 100
    asset_block_size = 50
    # Asset 1: rows 0..49
    # Asset 2: rows 50..99
    features = np.zeros((total_rows, 5), dtype=np.float32)
    for i in range(total_rows):
        features[i, :] = float(i)
    targets = np.zeros(total_rows, dtype=np.float32)

    dataset = IndustrialLSTMDataset(
        features=features,
        targets=targets,
        window_size=30,
        prediction_horizon=10,
        asset_block_size=asset_block_size,
    )

    # Check every generated sequence in the entire dataset
    boundary_crossings = 0
    for idx in range(len(dataset)):
        x_win, _ = dataset[idx]
        first_row = int(x_win[0, 0].item())
        last_row = int(x_win[-1, 0].item())

        # An asset boundary crossing would span row 49 to row 50
        if first_row < 50 and last_row >= 50:
            boundary_crossings += 1

    print(f"Total sequences generated: {len(dataset)}")
    print(f"Number of windows crossing boundary (row 49 -> row 50): {boundary_crossings}")

    assert boundary_crossings == 0, "Violated: Found windows crossing asset boundary!"
    print("  -> PROVEN: Windows crossing asset boundaries are strictly REJECTED / NEVER GENERATED.")


def test_c_future_horizon_crossing_asset_boundary_rejected():
    """
    Test C: Proves that a historical window whose FUTURE HORIZON would cross an asset
    boundary is rejected and NOT generated.
    """
    print("\n--- TEST C: FUTURE HORIZON CROSSING ASSET BOUNDARY IS REJECTED / NOT GENERATED ---")
    # Asset 1: rows 0..49.
    # Suppose a window ended at row 45 (historical window rows 16..45).
    # Its 10-step future horizon would be rows 46..55 (where rows 50..55 belong to Asset 2!).
    # This must be rejected.
    total_rows = 100
    asset_block_size = 50
    features = np.zeros((total_rows, 5), dtype=np.float32)
    for i in range(total_rows):
        features[i, :] = float(i)
    targets = np.zeros(total_rows, dtype=np.float32)

    dataset = IndustrialLSTMDataset(
        features=features,
        targets=targets,
        window_size=30,
        prediction_horizon=10,
        asset_block_size=asset_block_size,
    )

    # In Asset 1 (length 50):
    # Max valid t satisfies: t + prediction_horizon <= 49  =>  t <= 39
    # Therefore, the last valid window in Asset 1 MUST end at row 39!
    # Any window ending at row 40..49 must NOT exist.
    max_end_in_asset_1 = -1
    for _, start_x, end_x in dataset.valid_slices:
        if start_x < 50:  # Belongs to Asset 1
            last_timestep_in_window = end_x - 1
            max_end_in_asset_1 = max(max_end_in_asset_1, last_timestep_in_window)

    print(f"Asset 1 boundary: rows 0..49 (size 50)")
    print(f"Required prediction horizon: 10 timesteps")
    print(f"Latest historical window end generated in Asset 1: row {max_end_in_asset_1}")
    print(f"Future horizon for this latest window: rows {max_end_in_asset_1 + 1} to {max_end_in_asset_1 + 10}")

    assert max_end_in_asset_1 == 39, f"Expected last window to end at row 39, got {max_end_in_asset_1}"
    assert max_end_in_asset_1 + 10 == 49, "Horizon must terminate exactly at or before asset boundary (row 49)"
    print("  -> PROVEN: Windows with future horizons crossing asset boundaries are strictly REJECTED.")


def test_d_formulation_30_history_10_future():
    """
    Test D: Proves the 30-history + 10-future formulation functions correctly:
    - Target is 1.0 when a failure occurs within [t+1 .. t+10].
    - Target is 0.0 when no failure occurs within [t+1 .. t+10].
    """
    print("\n--- TEST D: 30-HISTORY + 10-FUTURE FORMULATION CORRECTNESS ---")
    total_rows = 60
    features = np.random.randn(total_rows, 5).astype(np.float32)
    targets = np.zeros(total_rows, dtype=np.float32)

    # Case 1: Failure at index 35 (t + 6, within [30..39])
    targets[35] = 1.0
    ds_pos = IndustrialLSTMDataset(features, targets, window_size=30, prediction_horizon=10, asset_block_size=60)
    x_pos, y_pos = ds_pos[0]  # t = 29
    print(f"Case 1 (Failure at row 35 in horizon [30..39]): Target = {y_pos.item()}")
    assert y_pos.item() == 1.0, "Expected target 1.0 for failure within horizon"

    # Case 2: Failure at index 45 (outside horizon [30..39])
    targets_neg = np.zeros(total_rows, dtype=np.float32)
    targets_neg[45] = 1.0
    ds_neg = IndustrialLSTMDataset(features, targets_neg, window_size=30, prediction_horizon=10, asset_block_size=60)
    x_neg, y_neg = ds_neg[0]  # t = 29
    print(f"Case 2 (Failure at row 45 outside horizon [30..39]): Target = {y_neg.item()}")
    assert y_neg.item() == 0.0, "Expected target 0.0 for failure outside horizon"

    print("  -> PROVEN: 30-history + 10-future formulation is mathematically correct.")


def test_e_recalculated_split_statistics():
    """
    Test E: Recalculates sequence counts, positive/negative sequences,
    percentages, and dynamic pos_weight for TRAIN, VALIDATION, and TEST splits
    under the synthetic asset assignment scheme (asset_block_size = 500).
    """
    print("\n--- TEST E: RECALCULATED CLASS DISTRIBUTIONS & POS_WEIGHT PER SPLIT ---")
    splits = ["train", "val", "test"]
    stats_dict = {}

    for split in splits:
        archive_path = f"data/processed/{split}_scaled.npz"
        dataset = IndustrialLSTMDataset.from_npz(
            archive_path, window_size=30, prediction_horizon=10, asset_block_size=500
        )
        seq_targets = dataset.get_sequence_targets()
        total_seqs = len(seq_targets)
        num_pos = int((seq_targets == 1.0).sum())
        num_neg = int((seq_targets == 0.0).sum())
        pos_pct = (num_pos / total_seqs) * 100.0 if total_seqs > 0 else 0.0
        neg_pct = (num_neg / total_seqs) * 100.0 if total_seqs > 0 else 0.0
        pos_weight = (num_neg / num_pos) if num_pos > 0 else 0.0

        n_assets = len(dataset.features) // 500

        stats_dict[split] = {
            "n_assets": n_assets,
            "total_seqs": total_seqs,
            "num_pos": num_pos,
            "num_neg": num_neg,
            "pos_pct": pos_pct,
            "neg_pct": neg_pct,
            "pos_weight": pos_weight,
        }

        print(f"SPLIT: {split.upper()} (asset_block_size = 500, {n_assets} synthetic assets)")
        print(f"  Total Valid Sequences:   {total_seqs:,}")
        print(f"  Positive Sequences (1):  {num_pos:,} ({pos_pct:.2f}%)")
        print(f"  Negative Sequences (0):  {num_neg:,} ({neg_pct:.2f}%)")
        print(f"  Dynamic pos_weight:      {pos_weight:.4f}\n")

    # Verification assertions on exact recalculated numbers
    assert stats_dict["train"]["total_seqs"] == 6454
    assert stats_dict["train"]["num_pos"] == 1812
    assert stats_dict["train"]["num_neg"] == 4642
    assert np.isclose(stats_dict["train"]["pos_weight"], 2.5618, atol=1e-3)

    assert stats_dict["val"]["total_seqs"] == 1383
    assert stats_dict["val"]["num_pos"] == 225
    assert stats_dict["val"]["num_neg"] == 1158
    assert np.isclose(stats_dict["val"]["pos_weight"], 5.1467, atol=1e-3)

    assert stats_dict["test"]["total_seqs"] == 1383
    assert stats_dict["test"]["num_pos"] == 177
    assert stats_dict["test"]["num_neg"] == 1206
    assert np.isclose(stats_dict["test"]["pos_weight"], 6.8136, atol=1e-3)

    print("  -> PROVEN: All split recalculations verified successfully!")
    return stats_dict


if __name__ == "__main__":
    test_a_window_entirely_inside_asset()
    test_b_window_crossing_asset_boundary_rejected()
    test_c_future_horizon_crossing_asset_boundary_rejected()
    test_d_formulation_30_history_10_future()
    test_e_recalculated_split_statistics()
    print("\n" + "=" * 70)
    print("ALL UNIT TESTS PASSED WITH ZERO FAILURES!")
    print("=" * 70)

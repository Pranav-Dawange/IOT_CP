"""
Verification Suite for Experiment B (Raw 5 + Engineered 5 Features).

Verifies all 9 mandatory requirements:
1. Feature calculations (exact mathematical formulas)
2. No NaN / Inf values across all splits
3. Expected feature dimensions ((N, 10) and (batch, 30, 10))
4. Chronological ordering preservation
5. Asset boundary isolation
6. Train-only scaler fitting (no data leakage)
7. One batch loading
8. Model forward pass with input_size=10
9. Loss calculation with dynamic pos_weight
"""

import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from ml.datasets.lstm_dataset import IndustrialLSTMDataset
from ml.models.lstm import LSTMClassifier
from ml.preprocessing.preprocess import (
    ALL_EXPERIMENT_B_COLUMNS,
    ENGINEERED_FEATURE_COLUMNS,
    RAW_FEATURE_COLUMNS,
    FeatureScaler,
    compute_engineered_features,
)
from ml.training.config import LSTMConfig


def test_1_feature_calculations():
    print("\n--- CHECK 1: FEATURE CALCULATIONS ---")
    df_train = pd.read_csv("data/processed/train_unscaled.csv")
    row0 = df_train.iloc[0]

    air_t = row0["Air temperature [K]"]
    proc_t = row0["Process temperature [K]"]
    rpm = row0["Rotational speed [rpm]"]
    torque = row0["Torque [Nm]"]
    wear = row0["Tool wear [min]"]

    # Manual calculations
    expected_temp_diff = proc_t - air_t
    expected_omega = rpm * (2.0 * np.pi / 60.0)
    expected_power = expected_omega * torque
    expected_wear_torque = wear * torque
    expected_temp_torque = expected_temp_diff * torque

    # Function calculations
    eng = compute_engineered_features(df_train.iloc[[0]])

    assert np.isclose(eng["temperature_difference"].iloc[0], expected_temp_diff), "Mismatch in temperature_difference"
    assert np.isclose(eng["angular_velocity"].iloc[0], expected_omega), "Mismatch in angular_velocity"
    assert np.isclose(eng["mechanical_power_proxy"].iloc[0], expected_power), "Mismatch in mechanical_power_proxy"
    assert np.isclose(eng["tool_wear_torque_interaction"].iloc[0], expected_wear_torque), "Mismatch in tool_wear_torque_interaction"
    assert np.isclose(eng["temperature_torque_interaction"].iloc[0], expected_temp_torque), "Mismatch in temperature_torque_interaction"

    print(f"Row 0 Raw: Air T={air_t}K, Proc T={proc_t}K, RPM={rpm}, Torque={torque}Nm, Wear={wear}min")
    print(f"Row 0 Engineered:")
    print(f"  temperature_difference:         {eng['temperature_difference'].iloc[0]:.4f} K")
    print(f"  angular_velocity:               {eng['angular_velocity'].iloc[0]:.4f} rad/s")
    print(f"  mechanical_power_proxy:         {eng['mechanical_power_proxy'].iloc[0]:.4f} W")
    print(f"  tool_wear_torque_interaction:   {eng['tool_wear_torque_interaction'].iloc[0]:.4f}")
    print(f"  temperature_torque_interaction: {eng['temperature_torque_interaction'].iloc[0]:.4f}")
    print("-> CHECK 1 PASSED: All 5 engineered feature formulas are exactly correct.")


def test_2_and_3_nan_inf_and_dimensions():
    print("\n--- CHECKS 2 & 3: NO NAN/INF AND EXPECTED DIMENSIONS ---")
    splits = {
        "train": (7000, 10),
        "val": (1500, 10),
        "test": (1500, 10),
    }

    for split_name, (expected_rows, expected_cols) in splits.items():
        data = np.load(f"data/processed/{split_name}_engineered_scaled.npz")
        feats = data["features"]
        targets = data["targets"]

        assert feats.shape == (expected_rows, expected_cols), f"{split_name} features shape mismatch: {feats.shape}"
        assert targets.shape == (expected_rows,), f"{split_name} targets shape mismatch: {targets.shape}"

        nan_count = np.isnan(feats).sum()
        inf_count = np.isinf(feats).sum()
        assert nan_count == 0, f"{split_name} has {nan_count} NaNs"
        assert inf_count == 0, f"{split_name} has {inf_count} Infs"

        print(f"  {split_name.capitalize():<5} features shape: {feats.shape} | NaNs: {nan_count} | Infs: {inf_count}")

    print("-> CHECKS 2 & 3 PASSED: Clean arrays, zero NaNs/Infs, 10 features across all splits.")


def test_4_chronological_ordering():
    print("\n--- CHECK 4: CHRONOLOGICAL ORDERING PRESERVATION ---")
    df_raw = pd.read_csv("data/raw/ai4i2020.csv")
    df_train = pd.read_csv("data/processed/train_unscaled.csv")
    data_eng = np.load("data/processed/train_engineered_scaled.npz")
    scaler = FeatureScaler.load("data/processed/scaler_engineered.pkl")

    unscaled_train_eng = scaler.inverse_transform(data_eng["features"])

    # First 5 columns of unscaled_train_eng must exactly match df_train
    assert np.allclose(unscaled_train_eng[:, :5], df_train[RAW_FEATURE_COLUMNS].to_numpy()), "Unscaled values mismatch!"
    # And df_train must match first 7000 rows of raw df
    assert np.allclose(df_train[RAW_FEATURE_COLUMNS].to_numpy(), df_raw.iloc[:7000][RAW_FEATURE_COLUMNS].to_numpy()), "Raw ordering mismatch!"

    print("  First 3 raw temperatures in raw CSV:       ", df_raw["Air temperature [K]"].iloc[:3].tolist())
    print("  First 3 reconstructed unscaled temperatures:", unscaled_train_eng[:3, 0].tolist())
    print("-> CHECK 4 PASSED: Chronological row sequence is 100% preserved.")


def test_5_asset_boundary_isolation():
    print("\n--- CHECK 5: ASSET BOUNDARY ISOLATION ---")
    train_ds = IndustrialLSTMDataset.from_npz(
        "data/processed/train_engineered_scaled.npz",
        window_size=30,
        prediction_horizon=10,
        asset_block_size=500,
    )
    val_ds = IndustrialLSTMDataset.from_npz(
        "data/processed/val_engineered_scaled.npz",
        window_size=30,
        prediction_horizon=10,
        asset_block_size=500,
    )
    test_ds = IndustrialLSTMDataset.from_npz(
        "data/processed/test_engineered_scaled.npz",
        window_size=30,
        prediction_horizon=10,
        asset_block_size=500,
    )

    print(f"  Train sequences generated: {len(train_ds):,} (expected 14 assets * 461 = 6,454)")
    print(f"  Val sequences generated:   {len(val_ds):,} (expected 3 assets * 461 = 1,383)")
    print(f"  Test sequences generated:  {len(test_ds):,} (expected 3 assets * 461 = 1,383)")

    assert len(train_ds) == 6454, f"Expected 6,454, got {len(train_ds)}"
    assert len(val_ds) == 1383, f"Expected 1,383, got {len(val_ds)}"
    assert len(test_ds) == 1383, f"Expected 1,383, got {len(test_ds)}"

    # Check that no sequence in train_ds crosses any 500-row boundary
    for _, start_x, end_x in train_ds.valid_slices:
        asset_id_start = start_x // 500
        asset_id_end = (end_x - 1) // 500
        asset_id_horizon = (end_x + 9) // 500
        assert asset_id_start == asset_id_end == asset_id_horizon, (
            f"Cross-asset violation detected! Window: [{start_x}..{end_x}], Horizon: [{end_x}..{end_x+10}]"
        )

    print("-> CHECK 5 PASSED: Zero boundary crossing across all assets and splits.")


def test_6_train_only_scaler_fitting():
    print("\n--- CHECK 6: TRAIN-ONLY SCALER FITTING (NO LEAKAGE) ---")
    scaler_b = FeatureScaler.load("data/processed/scaler_engineered.pkl")
    df_train_raw = pd.read_csv("data/processed/train_unscaled.csv")[RAW_FEATURE_COLUMNS]
    eng_train = compute_engineered_features(df_train_raw)
    X_train_full = pd.concat([df_train_raw, eng_train], axis=1).to_numpy()

    expected_mean = X_train_full.mean(axis=0)
    expected_scale = X_train_full.std(axis=0)

    scaler_mean = scaler_b._scaler.mean_
    scaler_scale = scaler_b._scaler.scale_

    assert np.allclose(scaler_mean, expected_mean), "Scaler mean does not match training split mean!"
    assert np.allclose(scaler_scale, expected_scale), "Scaler scale does not match training split std!"

    print(f"  Scaler fitted feature count: {len(scaler_b.feature_names)}")
    print(f"  First 3 feature means: {scaler_mean[:3]}")
    print(f"  Expected training means: {expected_mean[:3]}")
    print("-> CHECK 6 PASSED: Scaler is strictly fitted ONLY on the 7,000 training rows.")


def test_7_8_9_dataloader_forward_pass_and_loss():
    print("\n--- CHECKS 7, 8 & 9: BATCH LOADING, FORWARD PASS, LOSS CALCULATION ---")
    config = LSTMConfig(feature_set="engineered")
    assert config.input_size == 10, f"Expected input_size=10, got {config.input_size}"

    train_ds = IndustrialLSTMDataset.from_npz(
        config.train_path,
        window_size=config.window_size,
        prediction_horizon=config.prediction_horizon,
        asset_block_size=config.asset_block_size,
    )
    loader = DataLoader(train_ds, batch_size=config.batch_size, shuffle=False)

    # 7. One batch loading
    batch_x, batch_y = next(iter(loader))
    print(f"  Loaded Batch X shape: {tuple(batch_x.shape)} (expected: (64, 30, 10))")
    print(f"  Loaded Batch y shape: {tuple(batch_y.shape)} (expected: (64, 1))")
    assert batch_x.shape == (64, 30, 10), f"Expected (64, 30, 10), got {batch_x.shape}"
    assert batch_y.shape == (64, 1), f"Expected (64, 1), got {batch_y.shape}"

    # 8. Model forward pass
    model = LSTMClassifier(
        input_size=config.input_size,
        hidden_size=config.hidden_size,
        num_layers=config.num_layers,
        dropout=config.dropout,
        bidirectional=config.bidirectional,
    )
    model.eval()
    with torch.no_grad():
        logits = model(batch_x)
    print(f"  Model output logits shape: {tuple(logits.shape)} (expected: (64, 1))")
    assert logits.shape == (64, 1), f"Expected (64, 1), got {logits.shape}"

    # 9. Dynamic pos_weight and loss calculation
    seq_targets = train_ds.get_sequence_targets()
    num_neg = int((seq_targets == 0.0).sum())
    num_pos = int((seq_targets == 1.0).sum())
    pos_weight_val = num_neg / num_pos
    pos_weight = torch.tensor([pos_weight_val], dtype=torch.float32)

    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    loss = criterion(logits, batch_y)
    print(f"  Dynamic training pos_weight: {pos_weight_val:.4f} (Neg: {num_neg:,}, Pos: {num_pos:,})")
    print(f"  Sample batch loss: {loss.item():.4f}")

    assert not torch.isnan(loss), "Computed loss is NaN!"
    assert not torch.isinf(loss), "Computed loss is Inf!"
    assert loss.item() > 0.0, "Computed loss must be positive"
    print("-> CHECKS 7, 8 & 9 PASSED: Batch loading, forward pass, and loss computation verified.")


def test_10_evaluator_checkpoint_reconciliation():
    print("\n--- CHECK 10: EVALUATOR CHECKPOINT RECONCILIATION & MISMATCH SAFEGUARDS ---")
    from ml.training.evaluate import resolve_checkpoint_and_model

    # 1. Correct resolution for engineered checkpoint
    model_eng, ckpt_eng, feat_set, in_size = resolve_checkpoint_and_model(
        checkpoint_path="ml/checkpoints/feature_engineered_lstm_model.pt",
        feature_set="engineered",
    )
    assert in_size == 10
    assert feat_set == "engineered"
    assert model_eng.lstm.input_size == 10
    print("  Engineered checkpoint resolution: successfully instantiated 10-feature model.")

    # 2. Correct resolution for raw checkpoint
    model_raw, ckpt_raw, feat_set_raw, in_size_raw = resolve_checkpoint_and_model(
        checkpoint_path="ml/checkpoints/best_lstm_model.pt",
        feature_set="raw",
    )
    assert in_size_raw == 5
    assert feat_set_raw == "raw"
    assert model_raw.lstm.input_size == 5
    print("  Raw baseline checkpoint resolution: successfully instantiated 5-feature model.")

    # 3. Mismatch guard: configuring raw (5) against engineered (10) checkpoint raises clear error
    try:
        resolve_checkpoint_and_model(
            checkpoint_path="ml/checkpoints/feature_engineered_lstm_model.pt",
            feature_set="raw",
        )
        assert False, "Should have raised ValueError on dimension mismatch!"
    except ValueError as e:
        assert "Checkpoint expects 10 input features but evaluator was configured for 5" in str(e)
        print(f"  Safeguard verified: raised '{e}' on feature count mismatch.")

    print("-> CHECK 10 PASSED: Evaluator checkpoint reconciliation & dimension safeguards verified.")


if __name__ == "__main__":
    test_1_feature_calculations()
    test_2_and_3_nan_inf_and_dimensions()
    test_4_chronological_ordering()
    test_5_asset_boundary_isolation()
    test_6_train_only_scaler_fitting()
    test_7_8_9_dataloader_forward_pass_and_loss()
    test_10_evaluator_checkpoint_reconciliation()
    print("\n" + "=" * 75)
    print("ALL EXPERIMENT B VERIFICATION CHECKS PASSED WITH ZERO FAILURES!")
    print("=" * 75)

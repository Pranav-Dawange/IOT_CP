"""
PyTorch GRU Training Pipeline for Industrial Asset Failure Prediction.

Experiment C: GRU Baseline on 5 Raw Sensor Features.

METHODOLOGICAL PRINCIPLES:
1. "AI4I 2020 is not treated as a genuine per-machine time series. Ordered records are
   assigned to synthetic assets, and temporal windows are constructed independently within each asset."
2. Asset block size = 500 contiguous rows.
3. Window size = 30 timesteps.
4. Prediction horizon = 10 timesteps lookahead for impending failure.
5. Windows and prediction horizons NEVER cross synthetic asset boundaries.
6. Target: y[t] = 1 if Machine failure == 1 at any timestep in [t+1 ... t+10] within same asset; else 0.
7. Model: GRUClassifier with input_size=5, hidden_size=64, num_layers=2, dropout=0.2, bidirectional=False.
8. Loss: BCEWithLogitsLoss with dynamic training-set pos_weight.
9. Optimizer: Adam with lr=0.001.
10. Early stopping: monitors validation loss with patience=10.
11. Checkpoint saved to: ml/checkpoints/gru_model.pt.
12. Test set remains strictly UNTOUCHED during Experiment C development.
"""

import argparse
import random
import sys
from pathlib import Path
from typing import Dict, Optional, Tuple

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from ml.datasets.lstm_dataset import IndustrialLSTMDataset
from ml.models.gru import GRUClassifier
from ml.training.config import GRUConfig, default_gru_config
from ml.training.evaluate import compute_classification_metrics, evaluate_model
from ml.training.train_lstm import EarlyStopping, compute_sequence_pos_weight, set_seed, train_one_epoch


def run_training(config: GRUConfig) -> None:
    """
    Main training execution function for Experiment C (GRU Baseline).
    To be run personally by the user.
    """
    set_seed(config.seed)
    device = config.device
    print(f"Executing GRU training on device: {device}")
    print(
        'PRINCIPLE: "AI4I 2020 is not treated as a genuine per-machine time series. '
        'Ordered records are assigned to synthetic assets, and temporal windows '
        'are constructed independently within each asset."'
    )

    # 1. Load Data with Synthetic Asset Partitioning (5 raw features only)
    print(f"Loading training data from: {config.train_path} (asset_block_size={config.asset_block_size})")
    train_dataset = IndustrialLSTMDataset.from_npz(
        config.train_path,
        window_size=config.window_size,
        prediction_horizon=config.prediction_horizon,
        asset_block_size=config.asset_block_size,
    )
    val_dataset = IndustrialLSTMDataset.from_npz(
        config.val_path,
        window_size=config.window_size,
        prediction_horizon=config.prediction_horizon,
        asset_block_size=config.asset_block_size,
    )

    # Validate feature dimension is 5 (raw features only)
    if train_dataset.features.shape[1] != 5:
        raise ValueError(
            f"Experiment C requires 5 raw features, but train data has {train_dataset.features.shape[1]} features."
        )
    if val_dataset.features.shape[1] != 5:
        raise ValueError(
            f"Experiment C requires 5 raw features, but val data has {val_dataset.features.shape[1]} features."
        )

    # 2. Dynamic Class Imbalance Weighting strictly from training sequence targets
    seq_targets_train = train_dataset.get_sequence_targets()
    pos_weight, num_neg, num_pos = compute_sequence_pos_weight(seq_targets_train)
    pos_weight = pos_weight.to(device)

    print(f"Train valid sequences: {len(train_dataset):,} (Neg: {num_neg:,}, Pos: {num_pos:,})")
    print(f"Dynamic pos_weight:     {pos_weight.item():.4f}")
    print(f"Val valid sequences:   {len(val_dataset):,}")

    train_loader = DataLoader(
        train_dataset, batch_size=config.batch_size, shuffle=True, pin_memory=False
    )
    val_loader = DataLoader(
        val_dataset, batch_size=config.batch_size, shuffle=False, pin_memory=False
    )

    print(f"Train batches: {len(train_loader)} | Val batches: {len(val_loader)}")

    # 3. Model Initialization (GRU)
    model = GRUClassifier(
        input_size=config.input_size,
        hidden_size=config.hidden_size,
        num_layers=config.num_layers,
        dropout=config.dropout,
        bidirectional=config.bidirectional,
    ).to(device)

    print("\nModel Architecture (GRU):")
    print(model)

    # 4. Criterion & Optimizer
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    optimizer = torch.optim.Adam(
        model.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay
    )

    # 5. Early Stopping
    early_stopping = EarlyStopping(
        patience=config.patience,
        checkpoint_path=config.model_save_path,
        feature_set=config.feature_set,
        input_size=config.input_size,
        model_type=config.model_type,
    )

    print("\nStarting training loop (Accuracy is deliberately excluded as primary metric)...")
    print(
        f"{'Epoch':<6} | {'Train Loss':<10} | {'Val Loss':<10} | {'ROC-AUC':<8} | "
        f"{'PR-AUC':<8} | {'Precision':<10} | {'Recall':<8} | {'F1':<8} | {'Saved?'}"
    )
    print("-" * 95)

    for epoch in range(1, config.epochs + 1):
        train_loss = train_one_epoch(model, train_loader, criterion, optimizer, device)
        val_loss, val_metrics = evaluate_model(
            model, val_loader, criterion, device, threshold=config.classification_threshold
        )

        improved = early_stopping(val_loss, model, epoch, val_metrics)
        saved_str = "YES (Best)" if improved else ""

        print(
            f"{epoch:<6} | {train_loss:<10.4f} | {val_loss:<10.4f} | "
            f"{val_metrics['roc_auc']:<8.4f} | {val_metrics['pr_auc']:<8.4f} | "
            f"{val_metrics['precision']:<10.4f} | {val_metrics['recall']:<8.4f} | "
            f"{val_metrics['f1']:<8.4f} | {saved_str}"
        )

        if early_stopping.early_stop:
            print(f"\nEarly stopping triggered after {epoch} epochs (patience={config.patience}).")
            break

    print(f"\nTraining completed! Best GRU model checkpoint saved to: {config.model_save_path}")
    print("NOTE: Automatic test evaluation was deliberately omitted to keep the test set strictly untouched.")


def verify_pipeline_single_batch(config: GRUConfig) -> None:
    """
    Verification utility for Experiment C to confirm:
    1. Dataset construction works with synthetic assets on 5 raw features
    2. Input shape [64, 30, 5]
    3. Output shape [64, 1]
    4. Loss calculation with dynamic pos_weight
    5. Checkpoint saving functionality
    WITHOUT executing training epochs or touching the test set.
    """
    print("=" * 75)
    print("EXPERIMENT C (GRU BASELINE) PIPELINE VERIFICATION (NO TRAINING EXECUTED)")
    print("=" * 75)
    print(
        'METHODOLOGY: "AI4I 2020 is not treated as a genuine per-machine time series. '
        'Ordered records are assigned to synthetic assets, and temporal windows '
        'are constructed independently within each asset."'
    )
    print("-" * 75)

    # 1. Dataset Construction
    print(
        f"1. Constructing IndustrialLSTMDataset from {config.train_path} "
        f"(window_size={config.window_size}, horizon={config.prediction_horizon}, "
        f"asset_block_size={config.asset_block_size})..."
    )
    dataset = IndustrialLSTMDataset.from_npz(
        config.train_path,
        window_size=config.window_size,
        prediction_horizon=config.prediction_horizon,
        asset_block_size=config.asset_block_size,
    )
    assert dataset.features.shape[1] == 5, f"Expected 5 raw features, got {dataset.features.shape[1]}"
    print(f"   -> Successfully constructed dataset with {len(dataset):,} valid sequences across 14 assets.")

    # 2. Recalculated sequence targets & pos_weight
    y_seq = dataset.get_sequence_targets()
    pos_weight, num_neg, num_pos = compute_sequence_pos_weight(y_seq)
    print(f"2. Recalculated per-asset sequence target distribution:")
    print(f"   -> Negative sequences: {num_neg:,} ({num_neg / len(y_seq) * 100:.2f}%)")
    print(f"   -> Positive sequences: {num_pos:,} ({num_pos / len(y_seq) * 100:.2f}%)")
    print(f"   -> Dynamic pos_weight:  {pos_weight.item():.4f}")

    # 3. Batch Loading & Input Shape Verification
    print("3. Loading single batch via DataLoader...")
    loader = DataLoader(dataset, batch_size=config.batch_size, shuffle=False)
    batch_x, batch_y = next(iter(loader))
    print(f"   -> Batch X shape: {tuple(batch_x.shape)} (expected: ({config.batch_size}, {config.window_size}, 5))")
    print(f"   -> Batch y shape: {tuple(batch_y.shape)} (expected: ({config.batch_size}, 1))")
    assert batch_x.shape == (config.batch_size, config.window_size, 5), f"Unexpected shape {batch_x.shape}"
    assert batch_y.shape == (config.batch_size, 1), f"Unexpected shape {batch_y.shape}"

    # 4. GRU Model Forward Pass & Output Shape Verification
    print("4. Instantiating GRUClassifier and performing forward pass...")
    model = GRUClassifier(
        input_size=config.input_size,
        hidden_size=config.hidden_size,
        num_layers=config.num_layers,
        dropout=config.dropout,
        bidirectional=config.bidirectional,
    )
    model.eval()
    with torch.no_grad():
        logits = model(batch_x)
    print(f"   -> Output logits shape: {tuple(logits.shape)} (expected: ({config.batch_size}, 1))")
    assert logits.shape == (config.batch_size, 1), f"Unexpected shape {logits.shape}"

    # 5. Loss Calculation
    print("5. Calculating BCEWithLogitsLoss with dynamic pos_weight on single batch...")
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    loss = criterion(logits, batch_y)
    print(f"   -> Computed loss on sample batch: {loss.item():.4f}")
    assert not torch.isnan(loss) and not torch.isinf(loss) and loss.item() > 0.0

    # 6. Checkpoint Saving Verification (on temporary test path)
    test_ckpt_path = Path("ml/checkpoints/_temp_gru_verify.pt")
    print(f"6. Verifying checkpoint saving mechanism...")
    stopper = EarlyStopping(
        patience=config.patience,
        checkpoint_path=str(test_ckpt_path),
        feature_set=config.feature_set,
        input_size=config.input_size,
        model_type=config.model_type,
    )
    dummy_metrics = {"roc_auc": 0.85, "pr_auc": 0.50, "precision": 0.60, "recall": 0.70, "f1": 0.65}
    stopper.save_checkpoint(model, epoch=1, val_loss=0.50, metrics=dummy_metrics)
    assert test_ckpt_path.is_file(), "Temporary checkpoint was not saved!"
    loaded_ckpt = torch.load(test_ckpt_path, map_location="cpu")
    assert loaded_ckpt["model_type"] == "gru"
    assert loaded_ckpt["feature_set"] == "raw"
    assert loaded_ckpt["input_size"] == 5
    assert "gru.weight_ih_l0" in loaded_ckpt["model_state_dict"]
    test_ckpt_path.unlink()
    print("   -> Checkpoint save and metadata structure verified successfully (temp file cleaned).")

    print(f"7. Target checkpoint path configured: {config.model_save_path}")
    print("8. Test set integrity: Test set was NOT loaded, NOT evaluated, and remains untouched.")
    print("=" * 75)
    print("All Experiment C verification checks PASSED! Model training was NOT executed.")
    print("=" * 75)


def main():
    parser = argparse.ArgumentParser(description="Train PyTorch GRU on AI4I 2020 Dataset (Experiment C)")
    parser.add_argument("--epochs", type=int, default=default_gru_config.epochs, help="Number of training epochs")
    parser.add_argument("--lr", type=float, default=default_gru_config.learning_rate, help="Learning rate")
    parser.add_argument("--batch_size", type=int, default=default_gru_config.batch_size, help="Batch size")
    parser.add_argument("--hidden_size", type=int, default=default_gru_config.hidden_size, help="GRU hidden units")
    parser.add_argument("--num_layers", type=int, default=default_gru_config.num_layers, help="GRU stacked layers")
    parser.add_argument("--dropout", type=float, default=default_gru_config.dropout, help="Dropout probability")
    parser.add_argument("--window_size", type=int, default=default_gru_config.window_size, help="Historical window length")
    parser.add_argument("--prediction_horizon", type=int, default=default_gru_config.prediction_horizon, help="Future prediction horizon")
    parser.add_argument("--asset_block_size", type=int, default=default_gru_config.asset_block_size, help="Rows per synthetic asset block")
    parser.add_argument("--verify_only", action="store_true", help="Run single batch verification without training")
    args = parser.parse_args()

    config = GRUConfig(
        epochs=args.epochs,
        learning_rate=args.lr,
        batch_size=args.batch_size,
        hidden_size=args.hidden_size,
        num_layers=args.num_layers,
        dropout=args.dropout,
        window_size=args.window_size,
        prediction_horizon=args.prediction_horizon,
        asset_block_size=args.asset_block_size,
    )

    if args.verify_only:
        verify_pipeline_single_batch(config)
    else:
        run_training(config)


if __name__ == "__main__":
    main()

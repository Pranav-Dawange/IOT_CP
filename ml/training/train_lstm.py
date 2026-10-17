"""
PyTorch LSTM Training Pipeline for Synthetic Asset-Partitioned Early Failure Prediction.

AI4I 2020 Predictive Maintenance System - Phase 2.

METHODOLOGICAL PRINCIPLE:
"AI4I 2020 is not treated as a genuine per-machine time series. Ordered records are
assigned to synthetic assets, and temporal windows are constructed independently within each asset."

SYNTHETIC ASSET ISOLATION RULES:
1. Configurable Synthetic Assets: Contiguous blocks of rows (default asset_block_size = 500).
2. Historical Window: 30 sensor timesteps [t-29 ... t] strictly inside the SAME asset.
3. Future Horizon: 10 future timesteps [t+1 ... t+10] strictly inside the SAME asset.
4. Boundary Isolation: No sequence or horizon ever crosses an asset or split boundary.
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

from ml.datasets.lstm_dataset import IndustrialLSTMDataset, create_lstm_dataloaders
from ml.models.lstm import LSTMClassifier
from ml.training.config import LSTMConfig, default_config
from ml.training.evaluate import compute_classification_metrics, evaluate_model


def set_seed(seed: int = 42) -> None:
    """Set random seed across all libraries to ensure reproducible runs."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False


def compute_sequence_pos_weight(y_seq: torch.Tensor) -> Tuple[torch.Tensor, int, int]:
    """Calculate dynamic positive class weight from valid per-asset sequence targets."""
    y_flat = y_seq.view(-1)
    num_neg = int((y_flat == 0.0).sum())
    num_pos = int((y_flat == 1.0).sum())

    if num_pos == 0:
        raise ValueError("Sequence targets contain zero positive samples!")

    ratio = num_neg / num_pos
    return torch.tensor([ratio], dtype=torch.float32), num_neg, num_pos


class EarlyStopping:
    """Monitors validation loss and persists the best model checkpoint."""

    def __init__(
        self,
        patience: int = 10,
        min_delta: float = 1e-4,
        checkpoint_path: str = "best_model.pt",
        feature_set: str = "raw",
        input_size: int = 5,
        model_type: str = "lstm",
    ):
        self.patience = patience
        self.min_delta = min_delta
        self.checkpoint_path = Path(checkpoint_path)
        self.feature_set = feature_set
        self.input_size = input_size
        self.model_type = model_type
        self.best_loss = float("inf")
        self.counter = 0
        self.early_stop = False

    def __call__(self, val_loss: float, model: nn.Module, epoch: int, metrics: Dict[str, float]) -> bool:
        if val_loss < self.best_loss - self.min_delta:
            self.best_loss = val_loss
            self.counter = 0
            self.save_checkpoint(model, epoch, val_loss, metrics)
            return True
        else:
            self.counter += 1
            if self.counter >= self.patience:
                self.early_stop = True
            return False

    def save_checkpoint(
        self, model: nn.Module, epoch: int, val_loss: float, metrics: Dict[str, float]
    ) -> None:
        self.checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        checkpoint = {
            "epoch": epoch,
            "model_state_dict": model.state_dict(),
            "val_loss": val_loss,
            "metrics": metrics,
            "model_type": self.model_type,
            "feature_set": self.feature_set,
            "input_size": self.input_size,
        }
        torch.save(checkpoint, self.checkpoint_path)


def train_one_epoch(
    model: nn.Module,
    train_loader: DataLoader,
    criterion: nn.Module,
    optimizer: torch.optim.Optimizer,
    device: str,
) -> float:
    """Execute a single training epoch across all training batches."""
    model.train()
    running_loss = 0.0
    total_samples = 0

    for batch_x, batch_y in train_loader:
        batch_x = batch_x.to(device)
        batch_y = batch_y.to(device)

        optimizer.zero_grad()
        logits = model(batch_x)
        loss = criterion(logits, batch_y)
        loss.backward()
        optimizer.step()

        batch_size = batch_x.size(0)
        running_loss += loss.item() * batch_size
        total_samples += batch_size

    epoch_loss = running_loss / total_samples if total_samples > 0 else 0.0
    return epoch_loss


def run_training(config: LSTMConfig) -> None:
    """
    Main training execution function.
    To be run personally by the user.
    """
    set_seed(config.seed)
    device = config.device
    print(f"Executing on device: {device}")
    print(
        'PRINCIPLE: "AI4I 2020 is not treated as a genuine per-machine time series. '
        'Ordered records are assigned to synthetic assets, and temporal windows '
        'are constructed independently within each asset."'
    )

    # 1. Load Data with Synthetic Asset Partitioning
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

    y_train_seq = train_dataset.get_sequence_targets()
    pos_weight, num_neg, num_pos = compute_sequence_pos_weight(y_train_seq)
    pos_weight = pos_weight.to(device)

    print(
        f"Recalculated per-asset sequence targets: {len(y_train_seq):,} total sequences "
        f"({num_neg:,} negative / {num_pos:,} positive)."
    )
    print(f"Computed dynamic pos_weight: {pos_weight.item():.4f}")

    # 2. Build DataLoaders
    train_loader = DataLoader(
        train_dataset, batch_size=config.batch_size, shuffle=True, pin_memory=False
    )
    val_loader = DataLoader(
        val_dataset, batch_size=config.batch_size, shuffle=False, pin_memory=False
    )

    print(f"Train batches: {len(train_loader)} | Val batches: {len(val_loader)}")

    # 3. Model Initialization
    model = LSTMClassifier(
        input_size=config.input_size,
        hidden_size=config.hidden_size,
        num_layers=config.num_layers,
        dropout=config.dropout,
        bidirectional=config.bidirectional,
    ).to(device)

    print("\nModel Architecture:")
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
    )

    print("\nStarting training loop (Accuracy is deliberately excluded as primary metric)...")
    print(
        f"{'Epoch':<6} | {'Train Loss':<10} | {'Val Loss':<10} | {'ROC-AUC':<8} | "
        f"{'Precision':<10} | {'Recall':<8} | {'F1':<8} | {'Saved?'}"
    )
    print("-" * 80)

    for epoch in range(1, config.epochs + 1):
        train_loss = train_one_epoch(model, train_loader, criterion, optimizer, device)
        val_loss, val_metrics = evaluate_model(
            model, val_loader, criterion, device, threshold=config.classification_threshold
        )

        improved = early_stopping(val_loss, model, epoch, val_metrics)
        saved_str = "YES (Best)" if improved else ""

        print(
            f"{epoch:<6} | {train_loss:<10.4f} | {val_loss:<10.4f} | "
            f"{val_metrics['roc_auc']:<8.4f} | {val_metrics['precision']:<10.4f} | "
            f"{val_metrics['recall']:<8.4f} | {val_metrics['f1']:<8.4f} | {saved_str}"
        )

        if early_stopping.early_stop:
            print(f"\nEarly stopping triggered after {epoch} epochs (patience={config.patience}).")
            break

    print(f"\nTraining completed! Best model checkpoint saved to: {config.model_save_path}")

    # Automatic evaluation of best checkpoint on TEST set
    print("\n" + "=" * 70)
    print("FINAL BEST MODEL - TEST SET EVALUATION")
    print("=" * 70)
    from ml.training.evaluate import evaluate_test_checkpoint
    evaluate_test_checkpoint(
        checkpoint_path=config.model_save_path,
        test_npz=config.test_path,
        feature_set=config.feature_set,
        input_size=config.input_size,
        threshold=config.classification_threshold,
        window_size=config.window_size,
        prediction_horizon=config.prediction_horizon,
        asset_block_size=config.asset_block_size,
        batch_size=config.batch_size,
        device=device,
    )


def verify_pipeline_single_batch(config: LSTMConfig) -> None:
    """
    Verification utility to confirm:
    1. Dataset construction works with synthetic assets
    2. Single batch loads properly
    3. Model performs forward pass on one batch
    4. Loss is calculated on one batch with recalculated pos_weight
    WITHOUT executing a training epoch.
    """
    print("=" * 70)
    print("PHASE 2 SYNTHETIC ASSET PIPELINE VERIFICATION (NO TRAINING EXECUTED)")
    print("=" * 70)
    print(
        'METHODOLOGY: "AI4I 2020 is not treated as a genuine per-machine time series. '
        'Ordered records are assigned to synthetic assets, and temporal windows '
        'are constructed independently within each asset."'
    )
    print("-" * 70)

    # 1. Dataset Construction
    print(
        f"1. Constructing IndustrialLSTMDataset (window_size={config.window_size}, "
        f"horizon={config.prediction_horizon}, asset_block_size={config.asset_block_size})..."
    )
    dataset = IndustrialLSTMDataset.from_npz(
        config.train_path,
        window_size=config.window_size,
        prediction_horizon=config.prediction_horizon,
        asset_block_size=config.asset_block_size,
    )
    print(f"   -> Successfully constructed dataset with {len(dataset):,} valid sequences.")

    # 2. Recalculated sequence targets & pos_weight
    y_seq = dataset.get_sequence_targets()
    pos_weight, num_neg, num_pos = compute_sequence_pos_weight(y_seq)
    print(f"2. Recalculated per-asset sequence target distribution:")
    print(f"   -> Negative sequences: {num_neg:,} ({num_neg / len(y_seq) * 100:.2f}%)")
    print(f"   -> Positive sequences: {num_pos:,} ({num_pos / len(y_seq) * 100:.2f}%)")
    print(f"   -> Recalculated dynamic pos_weight: {pos_weight.item():.4f}")

    # 3. Batch Loading
    print("3. Loading single batch via DataLoader...")
    loader = DataLoader(dataset, batch_size=config.batch_size, shuffle=False)
    batch_x, batch_y = next(iter(loader))
    print(f"   -> Batch X shape: {tuple(batch_x.shape)} (expected: ({config.batch_size}, {config.window_size}, {config.input_size}))")
    print(f"   -> Batch y shape: {tuple(batch_y.shape)} (expected: ({config.batch_size}, 1))")

    # 4. Model Forward Pass
    print("4. Instantiating LSTMClassifier and performing forward pass...")
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
    print(f"   -> Output logits shape: {tuple(logits.shape)} (expected: ({config.batch_size}, 1))")

    # 5. Loss Calculation
    print("5. Calculating BCEWithLogitsLoss with recalculated pos_weight on single batch...")
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    loss = criterion(logits, batch_y)
    print(f"   -> Computed loss on sample batch: {loss.item():.4f}")
    print("=" * 70)
    print("All verification checks PASSED! Model training was NOT executed.")
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(description="Train PyTorch LSTM on AI4I 2020 Dataset")
    parser.add_argument("--feature_set", type=str, default="raw", choices=["raw", "engineered"], help="Feature set: 'raw' (Experiment A, 5 features) or 'engineered' (Experiment B, 10 features)")
    parser.add_argument("--epochs", type=int, default=default_config.epochs, help="Number of training epochs")
    parser.add_argument("--lr", type=float, default=default_config.learning_rate, help="Learning rate")
    parser.add_argument("--batch_size", type=int, default=default_config.batch_size, help="Batch size")
    parser.add_argument("--hidden_size", type=int, default=default_config.hidden_size, help="LSTM hidden units")
    parser.add_argument("--num_layers", type=int, default=default_config.num_layers, help="LSTM stacked layers")
    parser.add_argument("--dropout", type=float, default=default_config.dropout, help="Dropout probability")
    parser.add_argument("--window_size", type=int, default=default_config.window_size, help="Historical window length")
    parser.add_argument("--prediction_horizon", type=int, default=default_config.prediction_horizon, help="Future prediction horizon")
    parser.add_argument("--asset_block_size", type=int, default=default_config.asset_block_size, help="Rows per synthetic asset block")
    parser.add_argument("--verify_only", action="store_true", help="Run single batch verification without training")
    parser.add_argument("--eval_test", action="store_true", help="Evaluate existing best checkpoint on test set without training")
    args = parser.parse_args()

    config = LSTMConfig(
        feature_set=args.feature_set,
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
    elif args.eval_test:
        from ml.training.evaluate import evaluate_test_checkpoint
        evaluate_test_checkpoint(
            checkpoint_path=config.model_save_path,
            test_npz=config.test_path,
            feature_set=config.feature_set,
            input_size=config.input_size,
            threshold=config.classification_threshold,
            window_size=config.window_size,
            prediction_horizon=config.prediction_horizon,
            asset_block_size=config.asset_block_size,
            batch_size=config.batch_size,
        )
    else:
        run_training(config)


if __name__ == "__main__":
    main()

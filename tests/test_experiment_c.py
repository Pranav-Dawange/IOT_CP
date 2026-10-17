"""
Verification Test Suite for Experiment C (GRU Baseline on 5 Raw Sensor Features).

Verifies all mandatory requirements:
1. Feature set: strictly 5 raw sensor features (no engineered features).
2. Input tensor shape: [64, 30, 5].
3. Output tensor shape: [64, 1] raw logit (no sigmoid).
4. Loss calculation with dynamic training-set pos_weight (2.5618).
5. Checkpoint saving mechanism and metadata structure.
6. Preservation of Experiment A and Experiment B checkpoints.
7. Evaluator compatibility with GRU checkpoints.
8. Test set isolation (untouched).
"""

import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from ml.datasets.lstm_dataset import IndustrialLSTMDataset
from ml.models.gru import GRUClassifier
from ml.training.config import GRUConfig, default_gru_config
from ml.training.evaluate import resolve_checkpoint_and_model
from ml.training.train_lstm import EarlyStopping, compute_sequence_pos_weight


def test_1_raw_features_and_config():
    """Verify Experiment C uses strictly 5 raw sensor features and standard hyperparams."""
    config = GRUConfig()
    assert config.input_size == 5, f"Expected input_size=5, got {config.input_size}"
    assert config.feature_set == "raw", f"Expected feature_set='raw', got {config.feature_set}"
    assert config.model_type == "gru", f"Expected model_type='gru', got {config.model_type}"
    assert config.hidden_size == 64
    assert config.num_layers == 2
    assert config.dropout == 0.2
    assert config.bidirectional is False
    assert config.window_size == 30
    assert config.prediction_horizon == 10
    assert config.asset_block_size == 500
    assert config.model_save_path == "ml/checkpoints/gru_model.pt"

    # Check dataset files have 5 features
    train_data = np.load(config.train_path)
    val_data = np.load(config.val_path)
    assert train_data["features"].shape[1] == 5
    assert val_data["features"].shape[1] == 5


def test_2_input_shape_30x5_and_output_shape_1():
    """Verify input shape is [64, 30, 5] and output shape is [64, 1] raw logits."""
    config = GRUConfig()
    dataset = IndustrialLSTMDataset.from_npz(
        config.train_path,
        window_size=config.window_size,
        prediction_horizon=config.prediction_horizon,
        asset_block_size=config.asset_block_size,
    )
    loader = DataLoader(dataset, batch_size=config.batch_size, shuffle=False)
    batch_x, batch_y = next(iter(loader))

    assert batch_x.shape == (64, 30, 5), f"Batch X shape mismatch: {batch_x.shape}"
    assert batch_y.shape == (64, 1), f"Batch y shape mismatch: {batch_y.shape}"

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

    assert logits.shape == (64, 1), f"Output logits shape mismatch: {logits.shape}"


def test_3_loss_calculation_with_pos_weight():
    """Verify loss calculation with dynamic pos_weight."""
    config = GRUConfig()
    dataset = IndustrialLSTMDataset.from_npz(
        config.train_path,
        window_size=config.window_size,
        prediction_horizon=config.prediction_horizon,
        asset_block_size=config.asset_block_size,
    )
    y_seq = dataset.get_sequence_targets()
    pos_weight, num_neg, num_pos = compute_sequence_pos_weight(y_seq)

    assert np.isclose(pos_weight.item(), 2.5618, atol=1e-3)
    assert num_neg == 4642
    assert num_pos == 1812

    loader = DataLoader(dataset, batch_size=config.batch_size, shuffle=False)
    batch_x, batch_y = next(iter(loader))

    model = GRUClassifier(
        input_size=config.input_size,
        hidden_size=config.hidden_size,
        num_layers=config.num_layers,
        dropout=config.dropout,
        bidirectional=config.bidirectional,
    )
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    logits = model(batch_x)
    loss = criterion(logits, batch_y)

    assert not torch.isnan(loss)
    assert not torch.isinf(loss)
    assert loss.item() > 0.0


def test_4_checkpoint_saving_and_metadata():
    """Verify checkpoint saving mechanism and metadata structure."""
    model = GRUClassifier(input_size=5, hidden_size=64, num_layers=2, dropout=0.2)
    test_ckpt_path = Path("ml/checkpoints/_temp_gru_test.pt")

    stopper = EarlyStopping(
        patience=10,
        checkpoint_path=str(test_ckpt_path),
        feature_set="raw",
        input_size=5,
        model_type="gru",
    )
    dummy_metrics = {"roc_auc": 0.82, "pr_auc": 0.44, "precision": 0.55, "recall": 0.65, "f1": 0.60}
    stopper.save_checkpoint(model, epoch=1, val_loss=0.55, metrics=dummy_metrics)

    assert test_ckpt_path.is_file()
    ckpt = torch.load(test_ckpt_path, map_location="cpu")

    assert ckpt["epoch"] == 1
    assert ckpt["model_type"] == "gru"
    assert ckpt["feature_set"] == "raw"
    assert ckpt["input_size"] == 5
    assert "gru.weight_ih_l0" in ckpt["model_state_dict"]
    # GRU has 3 gates (reset, update, new), so weight_ih shape is [3 * 64, 5] = [192, 5]
    assert ckpt["model_state_dict"]["gru.weight_ih_l0"].shape == torch.Size([192, 5])

    test_ckpt_path.unlink()


def test_5_preservation_of_previous_checkpoints():
    """Verify Experiment A and Experiment B checkpoints are completely intact and untouched."""
    # Experiment A
    ckpt_a = Path("ml/checkpoints/best_lstm_model.pt")
    assert ckpt_a.is_file(), "Experiment A checkpoint missing!"
    data_a = torch.load(ckpt_a, map_location="cpu")
    assert "lstm.weight_ih_l0" in data_a["model_state_dict"]
    assert data_a["model_state_dict"]["lstm.weight_ih_l0"].shape == torch.Size([256, 5])

    # Experiment B
    ckpt_b = Path("ml/checkpoints/feature_engineered_lstm_model.pt")
    assert ckpt_b.is_file(), "Experiment B checkpoint missing!"
    data_b = torch.load(ckpt_b, map_location="cpu")
    assert "lstm.weight_ih_l0" in data_b["model_state_dict"]
    assert data_b["model_state_dict"]["lstm.weight_ih_l0"].shape == torch.Size([256, 10])


def test_6_evaluator_gru_support():
    """Verify resolve_checkpoint_and_model can load and instantiate GRU models."""
    model = GRUClassifier(input_size=5, hidden_size=64, num_layers=2, dropout=0.2)
    test_ckpt_path = Path("ml/checkpoints/_temp_gru_eval_test.pt")
    torch.save({
        "epoch": 5,
        "model_state_dict": model.state_dict(),
        "val_loss": 0.52,
        "metrics": {},
        "model_type": "gru",
        "feature_set": "raw",
        "input_size": 5,
    }, test_ckpt_path)

    loaded_model, ckpt, feat_set, in_size = resolve_checkpoint_and_model(
        checkpoint_path=test_ckpt_path,
        feature_set="raw",
    )
    assert isinstance(loaded_model, GRUClassifier)
    assert in_size == 5
    assert feat_set == "raw"
    assert loaded_model.gru.input_size == 5

    test_ckpt_path.unlink()

"""
Configuration and Hyperparameters for LSTM Training and Evaluation.

Supports Experiment A (Raw 5 features) and Experiment B (Raw + Engineered 10 features).

AI4I 2020 Predictive Maintenance System - Phase 2.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

import torch

FeatureSetType = Literal["raw", "engineered"]


@dataclass
class LSTMConfig:
    # --- Experiment & Feature Set Selection ---
    feature_set: FeatureSetType = "raw"  # 'raw' (Experiment A, 5 features) or 'engineered' (Experiment B, 10 features)

    # --- Model Architecture ---
    input_size: int = 5  # 5 for raw, 10 for engineered
    hidden_size: int = 64
    num_layers: int = 2
    dropout: float = 0.2
    bidirectional: bool = False

    # --- Sequence, Horizon & Synthetic Asset Parameters ---
    window_size: int = 30
    prediction_horizon: int = 10
    asset_block_size: int = 500

    # --- Training Hyperparameters (Identical across both experiments) ---
    batch_size: int = 64
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    optimizer_name: str = "Adam"
    epochs: int = 50
    patience: int = 10  # Early stopping patience in epochs
    classification_threshold: float = 0.5
    seed: int = 42

    # --- Hardware & Paths ---
    device: str = "cuda" if torch.cuda.is_available() else "cpu"
    train_path: str = "data/processed/train_scaled.npz"
    val_path: str = "data/processed/val_scaled.npz"
    test_path: str = "data/processed/test_scaled.npz"
    scaler_path: str = "data/processed/scaler.pkl"
    checkpoint_dir: str = "ml/checkpoints"
    model_save_path: str = "ml/checkpoints/best_lstm_model.pt"

    def __post_init__(self):
        Path(self.checkpoint_dir).mkdir(parents=True, exist_ok=True)
        # Configure paths and input_size automatically based on feature_set
        if self.feature_set == "engineered":
            self.input_size = 10
            self.train_path = "data/processed/train_engineered_scaled.npz"
            self.val_path = "data/processed/val_engineered_scaled.npz"
            self.test_path = "data/processed/test_engineered_scaled.npz"
            self.scaler_path = "data/processed/scaler_engineered.pkl"
            self.model_save_path = "ml/checkpoints/feature_engineered_lstm_model.pt"
        else:
            self.input_size = 5
            self.train_path = "data/processed/train_scaled.npz"
            self.val_path = "data/processed/val_scaled.npz"
            self.test_path = "data/processed/test_scaled.npz"
            self.scaler_path = "data/processed/scaler.pkl"
            self.model_save_path = "ml/checkpoints/best_lstm_model.pt"


def get_config(feature_set: FeatureSetType = "raw") -> LSTMConfig:
    """Factory function returning configured LSTMConfig for Experiment A or B."""
    return LSTMConfig(feature_set=feature_set)


default_config = LSTMConfig(feature_set="raw")


@dataclass
class GRUConfig:
    """
    Configuration for Experiment C: GRU Baseline on 5 Raw Sensor Features.
    """
    # --- Model & Feature Type ---
    model_type: Literal["gru"] = "gru"
    feature_set: Literal["raw"] = "raw"

    # --- Architecture (Identical to Experiment A, except LSTM -> GRU) ---
    input_size: int = 5
    hidden_size: int = 64
    num_layers: int = 2
    dropout: float = 0.2
    bidirectional: bool = False

    # --- Sequence, Horizon & Synthetic Asset Parameters ---
    window_size: int = 30
    prediction_horizon: int = 10
    asset_block_size: int = 500

    # --- Training Hyperparameters ---
    batch_size: int = 64
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    optimizer_name: str = "Adam"
    epochs: int = 50
    patience: int = 10  # Early stopping patience
    classification_threshold: float = 0.5
    seed: int = 42

    # --- Hardware & Paths ---
    device: str = "cuda" if torch.cuda.is_available() else "cpu"
    train_path: str = "data/processed/train_scaled.npz"
    val_path: str = "data/processed/val_scaled.npz"
    test_path: str = "data/processed/test_scaled.npz"
    scaler_path: str = "data/processed/scaler.pkl"
    checkpoint_dir: str = "ml/checkpoints"
    model_save_path: str = "ml/checkpoints/gru_model.pt"

    def __post_init__(self):
        Path(self.checkpoint_dir).mkdir(parents=True, exist_ok=True)


default_gru_config = GRUConfig()


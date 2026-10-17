"""
Evaluation Utilities for PyTorch LSTM Machine Failure Classifier.

Phase 2 Evaluation Infrastructure:
- Metrics: ROC-AUC, PR-AUC (Average Precision), Precision, Recall, F1, Confusion Matrix, Classification Report.
- Ground truth sample counts and prediction counts.
- Validation-set threshold analysis (thresholds 0.10 through 0.90).
- PR curve and ROC curve calculation.
- Test evaluation on candidate thresholds identified strictly on validation predictions.
"""

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from torch.utils.data import DataLoader

from ml.datasets.lstm_dataset import IndustrialLSTMDataset
from ml.models.lstm import LSTMClassifier
from ml.training.config import LSTMConfig, default_config

EVAL_THRESHOLDS = [
    0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50,
    0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90,
]


def compute_classification_metrics(
    y_true: Union[np.ndarray, torch.Tensor],
    y_logits_or_probs: Union[np.ndarray, torch.Tensor],
    threshold: float = 0.5,
    is_logits: bool = True,
) -> Dict[str, Any]:
    """
    Compute comprehensive set of classification metrics including ROC-AUC and PR-AUC.

    Args:
        y_true: Ground truth binary labels (0 or 1), shape (N,).
        y_logits_or_probs: Raw logits (if is_logits=True) or probabilities in [0, 1].
        threshold: Classification decision boundary (default: 0.5).
        is_logits: Whether y_logits_or_probs contains raw unactivated logits.

    Returns:
        Dict containing roc_auc, pr_auc, precision, recall, f1, confusion_matrix,
        classification_report, sample counts, and prediction counts.
    """
    if isinstance(y_true, torch.Tensor):
        y_true = y_true.detach().cpu().numpy()
    if isinstance(y_logits_or_probs, torch.Tensor):
        y_logits_or_probs = y_logits_or_probs.detach().cpu().numpy()

    y_true = np.asarray(y_true).ravel().astype(int)
    scores = np.asarray(y_logits_or_probs).ravel()

    # Convert raw logits to probabilities via sigmoid if is_logits is True
    if is_logits:
        probs = 1.0 / (1.0 + np.exp(-scores))
    else:
        probs = scores

    # Apply decision threshold
    preds = (probs >= threshold).astype(int)

    # Sample counts
    total_samples = len(y_true)
    num_positive_samples = int((y_true == 1).sum())
    num_negative_samples = int((y_true == 0).sum())

    # Prediction counts
    num_predicted_positive = int((preds == 1).sum())
    num_predicted_negative = int((preds == 0).sum())

    # Compute ROC-AUC and PR-AUC (Average Precision)
    try:
        if len(np.unique(y_true)) > 1:
            roc_auc = float(roc_auc_score(y_true, probs))
            pr_auc = float(average_precision_score(y_true, probs))
        else:
            roc_auc = float("nan")
            pr_auc = float("nan")
    except Exception:
        roc_auc = float("nan")
        pr_auc = float("nan")

    # Precision, Recall, F1
    prec = float(precision_score(y_true, preds, zero_division=0))
    rec = float(recall_score(y_true, preds, zero_division=0))
    f1 = float(f1_score(y_true, preds, zero_division=0))

    # Confusion matrix
    cm = confusion_matrix(y_true, preds, labels=[0, 1])
    tn, fp, fn, tp = cm.ravel()

    report_str = classification_report(
        y_true, preds, labels=[0, 1], target_names=["Normal (0)", "Failure (1)"], zero_division=0
    )
    report_dict = classification_report(
        y_true, preds, labels=[0, 1], target_names=["Normal (0)", "Failure (1)"], zero_division=0, output_dict=True
    )

    return {
        "roc_auc": roc_auc,
        "pr_auc": pr_auc,
        "precision": prec,
        "recall": rec,
        "f1": f1,
        "threshold": threshold,
        "total_samples": total_samples,
        "num_positive_samples": num_positive_samples,
        "num_negative_samples": num_negative_samples,
        "num_predicted_positive": num_predicted_positive,
        "num_predicted_negative": num_predicted_negative,
        "confusion_matrix": cm.tolist(),
        "true_negatives": int(tn),
        "false_positives": int(fp),
        "false_negatives": int(fn),
        "true_positives": int(tp),
        "classification_report_str": report_str,
        "classification_report_dict": report_dict,
    }


def analyze_thresholds(
    y_true: np.ndarray,
    probs: np.ndarray,
    thresholds: Optional[List[float]] = None,
) -> pd.DataFrame:
    """
    Evaluate candidate decision thresholds and return detailed comparison table.

    For each threshold calculates:
    - precision
    - recall
    - F1
    - number of predicted positives
    """
    if thresholds is None:
        thresholds = EVAL_THRESHOLDS

    records = []
    y_true = np.asarray(y_true).ravel().astype(int)
    probs = np.asarray(probs).ravel()
    total_n = len(y_true)

    for th in thresholds:
        th_val = round(float(th), 2)
        preds = (probs >= th_val).astype(int)
        pos_preds = int((preds == 1).sum())

        cm = confusion_matrix(y_true, preds, labels=[0, 1])
        tn, fp, fn, tp = cm.ravel()

        prec = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
        rec = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
        f1 = float(2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0

        records.append({
            "threshold": th_val,
            "precision": prec,
            "recall": rec,
            "f1": f1,
            "predicted_positives": pos_preds,
            "predicted_positives_pct": (pos_preds / total_n) * 100.0,
            "tp": int(tp),
            "fp": int(fp),
            "tn": int(tn),
            "fn": int(fn),
        })

    return pd.DataFrame(records)


def extract_candidate_thresholds(df_thresholds: pd.DataFrame) -> Dict[str, Any]:
    """
    Identify key candidate thresholds from validation threshold table:
    1. Maximum Validation F1 threshold.
    2. Threshold giving recall >= 0.70 with highest precision.
    3. Threshold giving recall >= 0.80 with highest precision.
    """
    # 1. Max F1
    best_f1_row = df_thresholds.loc[df_thresholds["f1"].idxmax()]

    # 2. Recall >= 0.70 with highest precision
    rec_70_candidates = df_thresholds[df_thresholds["recall"] >= 0.70]
    if not rec_70_candidates.empty:
        rec_70_row = rec_70_candidates.loc[rec_70_candidates["precision"].idxmax()]
    else:
        rec_70_row = df_thresholds.loc[df_thresholds["recall"].idxmax()]

    # 3. Recall >= 0.80 with highest precision
    rec_80_candidates = df_thresholds[df_thresholds["recall"] >= 0.80]
    if not rec_80_candidates.empty:
        rec_80_row = rec_80_candidates.loc[rec_80_candidates["precision"].idxmax()]
    else:
        rec_80_row = df_thresholds.loc[df_thresholds["recall"].idxmax()]

    return {
        "max_f1_threshold": float(best_f1_row["threshold"]),
        "max_f1_val": float(best_f1_row["f1"]),
        "rec_70_threshold": float(rec_70_row["threshold"]),
        "rec_70_val_precision": float(rec_70_row["precision"]),
        "rec_70_val_recall": float(rec_70_row["recall"]),
        "rec_80_threshold": float(rec_80_row["threshold"]),
        "rec_80_val_precision": float(rec_80_row["precision"]),
        "rec_80_val_recall": float(rec_80_row["recall"]),
    }


def compute_curve_data(y_true: np.ndarray, probs: np.ndarray) -> Dict[str, Any]:
    """Calculate PR curve and ROC curve data coordinates."""
    y_true = np.asarray(y_true).ravel().astype(int)
    probs = np.asarray(probs).ravel()

    precision, recall, pr_thresholds = precision_recall_curve(y_true, probs)
    fpr, tpr, roc_thresholds = roc_curve(y_true, probs)

    return {
        "pr_curve": {
            "precision": precision.tolist(),
            "recall": recall.tolist(),
            "thresholds": pr_thresholds.tolist(),
        },
        "roc_curve": {
            "fpr": fpr.tolist(),
            "tpr": tpr.tolist(),
            "thresholds": roc_thresholds.tolist(),
        },
    }


def evaluate_model(
    model: nn.Module,
    dataloader: DataLoader,
    criterion: nn.Module,
    device: str = "cpu",
    threshold: float = 0.5,
) -> Tuple[float, Dict[str, Any]]:
    """Perform an evaluation pass on a dataloader using a model."""
    model.eval()
    total_loss = 0.0
    total_samples = 0

    all_logits = []
    all_targets = []

    with torch.no_grad():
        for batch_x, batch_y in dataloader:
            batch_x = batch_x.to(device)
            batch_y = batch_y.to(device)

            logits = model(batch_x)
            loss = criterion(logits, batch_y)

            batch_size = batch_x.size(0)
            total_loss += loss.item() * batch_size
            total_samples += batch_size

            all_logits.append(logits.detach().cpu())
            all_targets.append(batch_y.detach().cpu())

    avg_loss = total_loss / total_samples if total_samples > 0 else 0.0
    all_logits = torch.cat(all_logits, dim=0)
    all_targets = torch.cat(all_targets, dim=0)

    metrics = compute_classification_metrics(
        y_true=all_targets,
        y_logits_or_probs=all_logits,
        threshold=threshold,
        is_logits=True,
    )

    return avg_loss, metrics


def print_evaluation_summary(loss: float, metrics: Dict[str, Any], title: str = "Evaluation Summary") -> None:
    """Print formatted evaluation metrics to console."""
    print("=" * 70)
    print(f" {title.upper()} (Threshold = {metrics.get('threshold', 0.5):.2f})")
    print("=" * 70)
    print(f"  Loss:                       {loss:.4f}")
    print(f"  ROC-AUC:                    {metrics['roc_auc']:.4f}")
    print(f"  PR-AUC (Avg Precision):     {metrics['pr_auc']:.4f}")
    print(f"  Precision:                  {metrics['precision']:.4f}")
    print(f"  Recall:                     {metrics['recall']:.4f}")
    print(f"  F1-Score:                   {metrics['f1']:.4f}")
    print("-" * 70)
    print("  SAMPLE COUNTS (GROUND TRUTH):")
    print(f"    Total Sequences:          {metrics['total_samples']:,}")
    print(f"    Positive Samples (1):     {metrics['num_positive_samples']:,} ({metrics['num_positive_samples']/metrics['total_samples']*100:.2f}%)")
    print(f"    Negative Samples (0):     {metrics['num_negative_samples']:,} ({metrics['num_negative_samples']/metrics['total_samples']*100:.2f}%)")
    print("-" * 70)
    print("  PREDICTION COUNTS:")
    print(f"    Positive Predictions (1): {metrics['num_predicted_positive']:,} ({metrics['num_predicted_positive']/metrics['total_samples']*100:.2f}%)")
    print(f"    Negative Predictions (0): {metrics['num_predicted_negative']:,} ({metrics['num_predicted_negative']/metrics['total_samples']*100:.2f}%)")
    print("-" * 70)
    print("  CONFUSION MATRIX:")
    print(f"    True Negatives  (TN):     {metrics['true_negatives']:,}")
    print(f"    False Positives (FP):     {metrics['false_positives']:,}")
    print(f"    False Negatives (FN):     {metrics['false_negatives']:,}")
    print(f"    True Positives  (TP):     {metrics['true_positives']:,}")
    print("-" * 70)
    print("  DETAILED CLASSIFICATION REPORT:")
    print(metrics["classification_report_str"])
    print("=" * 70)


def resolve_checkpoint_and_model(
    checkpoint_path: Union[str, Path],
    feature_set: Optional[str] = None,
    input_size: Optional[int] = None,
    hidden_size: int = 64,
    num_layers: int = 2,
    dropout: float = 0.2,
    bidirectional: bool = False,
    device: str = "cpu",
) -> Tuple[LSTMClassifier, Dict[str, Any], str, int]:
    """
    Load checkpoint, verify architecture and input dimensions, and construct matching model.

    Returns:
        (model, checkpoint, resolved_feature_set, resolved_input_size)
    """
    ckpt_path = Path(checkpoint_path)
    if not ckpt_path.is_file():
        raise FileNotFoundError(f"Checkpoint not found at: {ckpt_path.resolve()}")

    checkpoint = torch.load(ckpt_path, map_location=device)
    state_dict = checkpoint.get("model_state_dict")
    if state_dict is None:
        raise KeyError(f"Checkpoint at {ckpt_path} does not contain valid 'model_state_dict'.")

    # Detect recurrent architecture: GRU vs LSTM
    if "gru.weight_ih_l0" in state_dict:
        ckpt_model_type = "gru"
        ckpt_weight_ih = state_dict["gru.weight_ih_l0"]
    elif "lstm.weight_ih_l0" in state_dict:
        ckpt_model_type = "lstm"
        ckpt_weight_ih = state_dict["lstm.weight_ih_l0"]
    else:
        raise KeyError(
            f"Checkpoint at {ckpt_path} does not contain valid 'lstm.weight_ih_l0' or 'gru.weight_ih_l0'."
        )

    # Extract input_size directly from checkpoint weight matrix
    ckpt_input_size = ckpt_weight_ih.shape[1]

    # Check for metadata in checkpoint if it exists
    ckpt_metadata_feature_set = checkpoint.get("feature_set")
    ckpt_metadata_input_size = checkpoint.get("input_size")

    if ckpt_metadata_input_size is not None and ckpt_metadata_input_size != ckpt_input_size:
        raise ValueError(
            f"Checkpoint metadata input_size={ckpt_metadata_input_size} does not match weight tensor shape {ckpt_input_size}."
        )

    # Determine resolved feature_set and input_size
    if feature_set is not None:
        if feature_set not in ("raw", "engineered"):
            raise ValueError(f"Unknown feature_set '{feature_set}'. Must be 'raw' or 'engineered'.")
        expected_size = 10 if feature_set == "engineered" else 5
        if input_size is not None and input_size != expected_size:
            raise ValueError(
                f"Conflicting configuration: feature_set='{feature_set}' expects {expected_size} features "
                f"but input_size={input_size} was provided."
            )
        eval_input_size = expected_size
        resolved_feature_set = feature_set
    elif input_size is not None:
        eval_input_size = input_size
        resolved_feature_set = "engineered" if input_size == 10 else ("raw" if input_size == 5 else f"custom_{input_size}")
    elif ckpt_metadata_feature_set is not None:
        resolved_feature_set = ckpt_metadata_feature_set
        eval_input_size = 10 if resolved_feature_set == "engineered" else 5
    else:
        # Fall back to inferring strictly from checkpoint weight tensor
        eval_input_size = ckpt_input_size
        resolved_feature_set = "engineered" if ckpt_input_size == 10 else ("raw" if ckpt_input_size == 5 else "unknown")

    # CRITICAL VERIFICATION CHECK before loading state dict
    if ckpt_input_size != eval_input_size:
        raise ValueError(
            f"Checkpoint expects {ckpt_input_size} input features but evaluator was configured for {eval_input_size}."
        )

    # Reconstruct model with matching recurrent cell type and identical architecture
    if ckpt_model_type == "gru":
        from ml.models.gru import GRUClassifier
        model = GRUClassifier(
            input_size=eval_input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout,
            bidirectional=bidirectional,
        ).to(device)
        model_input_size = model.gru.input_size
    else:
        model = LSTMClassifier(
            input_size=eval_input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout,
            bidirectional=bidirectional,
        ).to(device)
        model_input_size = model.lstm.input_size

    # Verify model input_size matches checkpoint before load_state_dict
    if model_input_size != ckpt_input_size:
        raise ValueError(
            f"Checkpoint expects {ckpt_input_size} input features but evaluator was configured for {model_input_size}."
        )

    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    return model, checkpoint, resolved_feature_set, eval_input_size


def run_full_threshold_analysis(
    checkpoint_path: Optional[str] = None,
    val_npz: Optional[str] = None,
    test_npz: Optional[str] = None,
    feature_set: Optional[str] = None,
    input_size: Optional[int] = None,
    window_size: int = 30,
    prediction_horizon: int = 10,
    asset_block_size: int = 500,
    batch_size: int = 64,
    device: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Execute complete validation-threshold selection and final test evaluation analysis.
    """
    target_device = device or ("cuda" if torch.cuda.is_available() else "cpu")

    if checkpoint_path is None and feature_set is None:
        raise ValueError("Must specify at least one of 'checkpoint_path' or 'feature_set'.")

    if checkpoint_path is None:
        checkpoint_path = (
            "ml/checkpoints/feature_engineered_lstm_model.pt"
            if feature_set == "engineered"
            else "ml/checkpoints/best_lstm_model.pt"
        )

    ckpt_path = Path(checkpoint_path)
    if not ckpt_path.is_file():
        raise FileNotFoundError(f"Checkpoint not found at: {ckpt_path.resolve()}")

    print(f"Loading checkpoint from: {ckpt_path.resolve()}")
    model, checkpoint, resolved_feature_set, resolved_input_size = resolve_checkpoint_and_model(
        checkpoint_path=ckpt_path,
        feature_set=feature_set,
        input_size=input_size,
        device=target_device,
    )

    if val_npz is None:
        val_npz = (
            "data/processed/val_engineered_scaled.npz"
            if resolved_feature_set == "engineered"
            else "data/processed/val_scaled.npz"
        )
    if test_npz is None:
        test_npz = (
            "data/processed/test_engineered_scaled.npz"
            if resolved_feature_set == "engineered"
            else "data/processed/test_scaled.npz"
        )

    # --- PART 1: VALIDATION SET PREDICTIONS ---
    print("\n" + "=" * 75)
    print(f"PART 1: VALIDATION SET THRESHOLD ANALYSIS ({resolved_feature_set.upper()} - {resolved_input_size} FEATURES)")
    print("=" * 75)
    val_ds = IndustrialLSTMDataset.from_npz(
        val_npz, window_size=window_size, prediction_horizon=prediction_horizon, asset_block_size=asset_block_size
    )
    if val_ds.features.shape[1] != resolved_input_size:
        raise ValueError(
            f"Validation data '{val_npz}' has {val_ds.features.shape[1]} features, "
            f"but model expects {resolved_input_size} (feature_set='{resolved_feature_set}')."
        )
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    val_logits, val_targets = [], []
    with torch.no_grad():
        for bx, by in val_loader:
            bx = bx.to(target_device)
            val_logits.append(model(bx).cpu())
            val_targets.append(by.cpu())

    val_logits = torch.cat(val_logits, dim=0).numpy().ravel()
    val_targets = torch.cat(val_targets, dim=0).numpy().ravel().astype(int)
    val_probs = 1.0 / (1.0 + np.exp(-val_logits))

    val_roc_auc = float(roc_auc_score(val_targets, val_probs))
    val_pr_auc = float(average_precision_score(val_targets, val_probs))
    print(f"Validation Sequences: {len(val_targets):,} (Pos: {(val_targets==1).sum():,}, Neg: {(val_targets==0).sum():,})")
    print(f"Validation ROC-AUC:   {val_roc_auc:.4f}")
    print(f"Validation PR-AUC:    {val_pr_auc:.4f}")

    # Generate Validation Threshold Table
    val_table = analyze_thresholds(val_targets, val_probs, EVAL_THRESHOLDS)
    print("\n--- VALIDATION SET THRESHOLD GRID ---")
    print(
        f"{'Threshold':<10} | {'Precision':<10} | {'Recall':<8} | {'F1-Score':<8} | "
        f"{'Pred Positives':<15} | {'TP':<4} | {'FP':<4} | {'FN':<4} | {'TN':<5}"
    )
    print("-" * 75)
    for _, r in val_table.iterrows():
        print(
            f"{r['threshold']:<10.2f} | {r['precision']:<10.4f} | {r['recall']:<8.4f} | {r['f1']:<8.4f} | "
            f"{int(r['predicted_positives']):<15,d} | {int(r['tp']):<4d} | {int(r['fp']):<4d} | {int(r['fn']):<4d} | {int(r['tn']):<5d}"
        )

    # Identify Candidate Thresholds
    candidates = extract_candidate_thresholds(val_table)
    print("\n--- CANDIDATE THRESHOLDS IDENTIFIED ON VALIDATION SET ---")
    print(f"1. Best Validation F1 Threshold:                 {candidates['max_f1_threshold']:.2f} (Val F1={candidates['max_f1_val']:.4f})")
    print(f"2. Recall >= 0.70 with Highest Precision:       {candidates['rec_70_threshold']:.2f} (Val Rec={candidates['rec_70_val_recall']:.4f}, Prec={candidates['rec_70_val_precision']:.4f})")
    print(f"3. Recall >= 0.80 with Highest Precision:       {candidates['rec_80_threshold']:.2f} (Val Rec={candidates['rec_80_val_recall']:.4f}, Prec={candidates['rec_80_val_precision']:.4f})")

    # --- PART 2: FINAL TEST SET EVALUATION ---
    print("\n" + "=" * 75)
    print(f"PART 2: FINAL TEST SET EVALUATION ({resolved_feature_set.upper()} - {resolved_input_size} FEATURES)")
    print("=" * 75)
    test_ds = IndustrialLSTMDataset.from_npz(
        test_npz, window_size=window_size, prediction_horizon=prediction_horizon, asset_block_size=asset_block_size
    )
    if test_ds.features.shape[1] != resolved_input_size:
        raise ValueError(
            f"Test data '{test_npz}' has {test_ds.features.shape[1]} features, "
            f"but model expects {resolved_input_size} (feature_set='{resolved_feature_set}')."
        )
    test_loader = DataLoader(test_ds, batch_size=batch_size, shuffle=False)

    test_logits, test_targets = [], []
    with torch.no_grad():
        for bx, by in test_loader:
            bx = bx.to(target_device)
            test_logits.append(model(bx).cpu())
            test_targets.append(by.cpu())

    test_logits = torch.cat(test_logits, dim=0).numpy().ravel()
    test_targets = torch.cat(test_targets, dim=0).numpy().ravel().astype(int)
    test_probs = 1.0 / (1.0 + np.exp(-test_logits))

    test_roc_auc = float(roc_auc_score(test_targets, test_probs))
    test_pr_auc = float(average_precision_score(test_targets, test_probs))
    print(f"Test Sequences: {len(test_targets):,} (Pos: {(test_targets==1).sum():,}, Neg: {(test_targets==0).sum():,})")
    print(f"Test ROC-AUC:   {test_roc_auc:.4f}")
    print(f"Test PR-AUC:    {test_pr_auc:.4f}")

    selected_eval_thresholds = [
        ("Baseline (Default)", 0.50),
        ("Best Validation F1", candidates["max_f1_threshold"]),
        ("Recall >= 0.70 (Val-Selected)", candidates["rec_70_threshold"]),
        ("Recall >= 0.80 (Val-Selected)", candidates["rec_80_threshold"]),
    ]

    test_results_summary = []
    for label, th in selected_eval_thresholds:
        m = compute_classification_metrics(test_targets, test_logits, threshold=th, is_logits=True)
        test_results_summary.append({
            "Label": label,
            "Threshold": th,
            "Precision": m["precision"],
            "Recall": m["recall"],
            "F1-Score": m["f1"],
            "Pred Positives": m["num_predicted_positive"],
            "TN": m["true_negatives"],
            "FP": m["false_positives"],
            "FN": m["false_negatives"],
            "TP": m["true_positives"],
            "Confusion Matrix": m["confusion_matrix"],
            "Classification Report": m["classification_report_str"],
        })

    print("\n--- TEST SET COMPARISON TABLE ---")
    print(
        f"{'Strategy':<28} | {'Threshold':<9} | {'Precision':<10} | {'Recall':<8} | "
        f"{'F1-Score':<8} | {'Pred Pos':<9} | {'Confusion Matrix (TN, FP, FN, TP)'}"
    )
    print("-" * 110)
    for r in test_results_summary:
        cm_str = f"TN={r['TN']:,}, FP={r['FP']:,}, FN={r['FN']:,}, TP={r['TP']:,}"
        print(
            f"{r['Label']:<28} | {r['Threshold']:<9.2f} | {r['Precision']:<10.4f} | {r['Recall']:<8.4f} | "
            f"{r['F1-Score']:<8.4f} | {r['Pred Positives']:<9d} | {cm_str}"
        )

    # Compute curve data
    curve_data = {
        "val": compute_curve_data(val_targets, val_probs),
        "test": compute_curve_data(test_targets, test_probs),
    }

    return {
        "validation_table": val_table,
        "candidate_thresholds": candidates,
        "test_results_summary": test_results_summary,
        "curve_data": curve_data,
        "val_roc_auc": val_roc_auc,
        "val_pr_auc": val_pr_auc,
        "test_roc_auc": test_roc_auc,
        "test_pr_auc": test_pr_auc,
    }


def evaluate_test_checkpoint(
    checkpoint_path: Optional[Union[str, Path]] = None,
    test_npz: Optional[Union[str, Path]] = None,
    feature_set: Optional[str] = None,
    input_size: Optional[int] = None,
    hidden_size: int = 64,
    num_layers: int = 2,
    dropout: float = 0.2,
    bidirectional: bool = False,
    threshold: float = 0.5,
    window_size: int = 30,
    prediction_horizon: int = 10,
    asset_block_size: int = 500,
    batch_size: int = 64,
    device: Optional[str] = None,
) -> Tuple[float, Dict[str, Any]]:
    """
    Load saved checkpoint and evaluate strictly on the test dataset.

    Explicitly respects feature_set ('engineered' -> 10 features, 'raw' -> 5 features).
    Reconstructs model with matching architecture and validates dimension consistency.
    """
    target_device = device or ("cuda" if torch.cuda.is_available() else "cpu")

    # If neither checkpoint_path nor feature_set is specified, do not silently assume raw
    if checkpoint_path is None and feature_set is None:
        raise ValueError("Must specify at least one of 'checkpoint_path' or 'feature_set'.")

    # Determine default checkpoint path if not provided
    if checkpoint_path is None:
        checkpoint_path = (
            "ml/checkpoints/feature_engineered_lstm_model.pt"
            if feature_set == "engineered"
            else "ml/checkpoints/best_lstm_model.pt"
        )

    ckpt_path = Path(checkpoint_path)
    if not ckpt_path.is_file():
        raise FileNotFoundError(f"Checkpoint not found at: {ckpt_path.resolve()}")

    print(f"\nLoading checkpoint from: {ckpt_path.resolve()}")
    model, checkpoint, resolved_feature_set, resolved_input_size = resolve_checkpoint_and_model(
        checkpoint_path=ckpt_path,
        feature_set=feature_set,
        input_size=input_size,
        hidden_size=hidden_size,
        num_layers=num_layers,
        dropout=dropout,
        bidirectional=bidirectional,
        device=target_device,
    )

    best_epoch = checkpoint.get("epoch", "N/A")
    best_val_loss = checkpoint.get("val_loss", "N/A")
    print(
        f"Loaded model trained up to Epoch: {best_epoch} (Validation Loss: {best_val_loss}) | "
        f"feature_set='{resolved_feature_set}' (input_size={resolved_input_size})"
    )

    # Determine test data file path
    if test_npz is None:
        test_path = (
            Path("data/processed/test_engineered_scaled.npz")
            if resolved_feature_set == "engineered"
            else Path("data/processed/test_scaled.npz")
        )
    else:
        test_path = Path(test_npz)

    if not test_path.is_file():
        raise FileNotFoundError(f"Test data file not found at: {test_path.resolve()}")

    print(f"Loading test dataset from: {test_path.resolve()}")
    test_dataset = IndustrialLSTMDataset.from_npz(
        test_path,
        window_size=window_size,
        prediction_horizon=prediction_horizon,
        asset_block_size=asset_block_size,
    )

    test_feat_dim = test_dataset.features.shape[1]
    if test_feat_dim != resolved_input_size:
        raise ValueError(
            f"Test data file '{test_path}' has {test_feat_dim} features, "
            f"but model and checkpoint expect {resolved_input_size} (feature_set='{resolved_feature_set}')."
        )

    test_loader = DataLoader(test_dataset, batch_size=batch_size, shuffle=False)

    seq_targets = test_dataset.get_sequence_targets()
    num_neg = int((seq_targets == 0.0).sum())
    num_pos = int((seq_targets == 1.0).sum())
    pos_weight = torch.tensor([num_neg / num_pos if num_pos > 0 else 1.0], dtype=torch.float32).to(target_device)
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    test_loss, metrics = evaluate_model(
        model=model,
        dataloader=test_loader,
        criterion=criterion,
        device=target_device,
        threshold=threshold,
    )

    title = f"Final Best Model - Test Set Evaluation ({resolved_feature_set.upper()} - {resolved_input_size} Features)"
    print_evaluation_summary(test_loss, metrics, title=title)
    return test_loss, metrics


def main():
    parser = argparse.ArgumentParser(description="Evaluate Trained LSTM on Validation and Test Datasets")
    parser.add_argument("--checkpoint", type=str, default=None, help="Path to checkpoint")
    parser.add_argument("--feature_set", type=str, default=None, choices=["raw", "engineered"], help="Feature set: 'raw' (5 features) or 'engineered' (10 features)")
    parser.add_argument("--val_npz", type=str, default=None, help="Path to val npz")
    parser.add_argument("--test_npz", type=str, default=None, help="Path to test npz")
    parser.add_argument("--threshold", type=float, default=0.5, help="Single threshold (default: 0.5)")
    parser.add_argument("--threshold_analysis", action="store_true", help="Run full validation threshold selection and test evaluation")
    parser.add_argument("--window_size", type=int, default=default_config.window_size, help="Window size (default: 30)")
    parser.add_argument("--prediction_horizon", type=int, default=default_config.prediction_horizon, help="Prediction horizon (default: 10)")
    parser.add_argument("--asset_block_size", type=int, default=default_config.asset_block_size, help="Asset block size (default: 500)")
    parser.add_argument("--batch_size", type=int, default=default_config.batch_size, help="Batch size")
    args = parser.parse_args()

    # If neither checkpoint nor feature_set is specified, do not silently assume raw
    if args.checkpoint is None and args.feature_set is None:
        parser.error("Please specify either --feature_set ('raw' or 'engineered') or --checkpoint path.")

    if args.threshold_analysis:
        run_full_threshold_analysis(
            checkpoint_path=args.checkpoint,
            val_npz=args.val_npz,
            test_npz=args.test_npz,
            feature_set=args.feature_set,
            window_size=args.window_size,
            prediction_horizon=args.prediction_horizon,
            asset_block_size=args.asset_block_size,
            batch_size=args.batch_size,
        )
    else:
        evaluate_test_checkpoint(
            checkpoint_path=args.checkpoint,
            test_npz=args.test_npz,
            feature_set=args.feature_set,
            threshold=args.threshold,
            window_size=args.window_size,
            prediction_horizon=args.prediction_horizon,
            asset_block_size=args.asset_block_size,
            batch_size=args.batch_size,
        )


if __name__ == "__main__":
    main()

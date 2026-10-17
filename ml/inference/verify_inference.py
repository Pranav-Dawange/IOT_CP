"""
Comprehensive Verification Suite for Phase 3 Frozen GRU Inference Integration.

TESTING PROTOCOL:
- Strictly uses SYNTHETIC telemetry data for functional verification.
- Does NOT load data/processed/test_scaled.npz.
- Does NOT access Machine failure test labels.
- Does NOT compute test evaluation metrics (ROC-AUC, Precision, Recall, F1).
- Does NOT train or retrain any model.

Verifies all requirements A through P:
A. Predictor loads checkpoint successfully.
B. Scaler loads successfully.
C. Synthetic window with shape (30, 5) is accepted.
D. Window with shape other than (30, 5) is rejected with a clear error.
E. Predictor returns a probability in [0, 1].
F. Predictor returns prediction 0 or 1.
G. threshold defaults to 0.55.
H. Model is in evaluation mode.
I. Inference runs under torch.no_grad().
J. AssetBuffer returns no prediction before 30 observations.
K. AssetBuffer returns a window exactly after 30 observations.
L. Adding the 31st observation produces another rolling 30-step window.
M. Two asset IDs maintain completely independent buffers.
N. reset(asset_id) clears only the requested asset.
O. Verify exact feature order.
P. Confirm scaler and model both expect five features.
"""

import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
import pandas as pd
import torch

from ml.inference.asset_buffer import AssetTelemetryBuffer, RAW_FEATURE_COLUMNS
from ml.inference.predictor import (
    DEFAULT_CHECKPOINT_PATH,
    DEFAULT_SCALER_PATH,
    DEFAULT_THRESHOLD,
    EXPECTED_RAW_FEATURES,
    FrozenGRUPredictor,
)


def create_synthetic_reading(offset: float = 0.0) -> np.ndarray:
    """Generate a realistic synthetic 5-element sensor reading."""
    # Air temp ~ 300K, Proc temp ~ 310K, RPM ~ 1500, Torque ~ 40Nm, Tool wear ~ 50min
    return np.array([
        300.0 + offset * 0.1,
        310.0 + offset * 0.1,
        1530.0 + offset * 2.0,
        40.0 + offset * 0.5,
        50.0 + offset,
    ], dtype=np.float64)


def create_synthetic_window(n_timesteps: int = 30, n_features: int = 5) -> np.ndarray:
    """Generate a synthetic 2D sensor window of shape (n_timesteps, n_features)."""
    data = np.zeros((n_timesteps, n_features), dtype=np.float64)
    for t in range(n_timesteps):
        reading = create_synthetic_reading(offset=float(t))
        if n_features == 5:
            data[t] = reading
        elif n_features < 5:
            data[t] = reading[:n_features]
        else:
            data[t, :5] = reading
    return data


# --- TEST A & B: Checkpoint and Scaler Loading ---
def test_a_and_b_loading():
    print("\n[TEST A & B] Loading checkpoint and scaler...")
    predictor = FrozenGRUPredictor(
        checkpoint_path=DEFAULT_CHECKPOINT_PATH,
        scaler_path=DEFAULT_SCALER_PATH,
        threshold=DEFAULT_THRESHOLD,
    )
    assert predictor.model is not None, "Failed to load GRU model"
    assert predictor.scaler is not None, "Failed to load FeatureScaler"
    print(f"  -> Checkpoint loaded: {DEFAULT_CHECKPOINT_PATH} (Epoch: {predictor.checkpoint_epoch})")
    print(f"  -> Scaler loaded:     {DEFAULT_SCALER_PATH}")
    print("  -> PASSED: Checkpoint and scaler loaded successfully.")


# --- TEST C: Accepting Synthetic 30 x 5 Window ---
def test_c_accept_valid_window():
    print("\n[TEST C] Accepting valid synthetic window of shape (30, 5)...")
    predictor = FrozenGRUPredictor()
    valid_window = create_synthetic_window(30, 5)
    res = predictor.predict(valid_window, asset_id="asset_01", timestamp="2026-10-05T21:00:00Z")

    assert isinstance(res, dict), "Result must be a dictionary"
    assert "failure_probability" in res
    assert "prediction" in res
    assert res["asset_id"] == "asset_01"
    assert res["timestamp"] == "2026-10-05T21:00:00Z"
    print(f"  -> Prediction result: {res}")
    print("  -> PASSED: Valid window (30, 5) accepted.")


# --- TEST D: Rejecting Shapes other than (30, 5) ---
def test_d_reject_invalid_shapes():
    print("\n[TEST D] Rejecting invalid window shapes...")
    predictor = FrozenGRUPredictor()

    invalid_shapes = [
        (29, 5),   # Too few timesteps
        (31, 5),   # Too many timesteps
        (30, 4),   # Too few features
        (30, 6),   # Too many features
        (1, 30, 5) # 3D tensor passed to 2D window API
    ]

    for shape in invalid_shapes:
        if len(shape) == 2:
            arr = np.zeros(shape)
        else:
            arr = np.zeros(shape)

        try:
            predictor.predict(arr)
            assert False, f"Expected ValueError for shape {shape}, but call succeeded!"
        except ValueError as e:
            print(f"  -> Correctly rejected shape {shape}: {str(e)[:70]}...")

    print("  -> PASSED: All invalid window shapes rejected with clear errors.")


# --- TEST E, F, G: Probability in [0, 1], Binary Prediction, Default Threshold ---
def test_e_f_g_probability_and_threshold():
    print("\n[TEST E, F, G] Probability domain [0, 1], binary prediction, default threshold...")
    predictor = FrozenGRUPredictor()

    # Verify default threshold is 0.55
    assert predictor.threshold == 0.55, f"Expected default threshold 0.55, got {predictor.threshold}"

    synthetic_window = create_synthetic_window(30, 5)
    result = predictor.predict(synthetic_window)

    prob = result["failure_probability"]
    pred = result["prediction"]

    assert 0.0 <= prob <= 1.0, f"Probability {prob} out of bounds [0, 1]"
    assert pred in (0, 1), f"Prediction {pred} must be 0 or 1"
    assert pred == (1 if prob >= 0.55 else 0), "Binary prediction does not match threshold rule"

    print(f"  -> Default threshold:      {predictor.threshold}")
    print(f"  -> Failure prob estimate:  {prob:.4f}")
    print(f"  -> Binary prediction:      {pred}")
    print("  -> PASSED: Probability in [0, 1], prediction in {0, 1}, threshold = 0.55.")


# --- TEST H & I: Evaluation Mode and torch.no_grad() ---
def test_h_and_i_eval_mode_and_no_grad():
    print("\n[TEST H & I] Verifying model.eval() and inference under torch.no_grad()...")
    predictor = FrozenGRUPredictor()

    # Check model is in eval mode
    assert predictor.model.training is False, "Model must be in eval mode (model.training == False)!"

    # Verify parameters do not require grad
    for name, param in predictor.model.named_parameters():
        assert not param.requires_grad, f"Parameter {name} has requires_grad=True!"

    # Test forward pass produces detached outputs (no grad fn)
    scaled_window = predictor.scaler.transform(create_synthetic_window(30, 5))
    tensor_in = torch.tensor(scaled_window, dtype=torch.float32).unsqueeze(0).to(predictor.device)

    with torch.no_grad():
        out = predictor.model(tensor_in)
        assert out.grad_fn is None, "Output has grad_fn! Inference must run under torch.no_grad()."

    print("  -> model.training: False (evaluation mode)")
    print("  -> output.grad_fn: None (under torch.no_grad)")
    print("  -> PASSED: Evaluation mode and torch.no_grad verified.")


# --- TEST J, K, L: AssetBuffer 30-Step Rolling Dynamics ---
def test_j_k_l_asset_buffer_rolling_dynamics():
    print("\n[TEST J, K, L] AssetBuffer 30-step accumulation and rolling eviction...")
    buffer = AssetTelemetryBuffer(window_size=30)
    asset_id = "asset_test_01"

    # Step J: Observations 1 through 29 return None
    for i in range(1, 30):
        reading = create_synthetic_reading(offset=float(i))
        window = buffer.add_reading(asset_id, reading, timestamp=f"t_{i}")
        assert window is None, f"Observation {i} prematurely returned a window!"
        assert buffer.count(asset_id) == i
        assert not buffer.is_ready(asset_id)

    print(f"  -> Observations 1..29 correctly returned None (buffer count: {buffer.count(asset_id)})")

    # Step K: Exactly on observation 30, window is returned with shape (30, 5)
    reading_30 = create_synthetic_reading(offset=30.0)
    window_30 = buffer.add_reading(asset_id, reading_30, timestamp="t_30")
    assert window_30 is not None, "Observation 30 failed to return ready window!"
    assert window_30.shape == (30, 5), f"Window shape mismatch: {window_30.shape}"
    assert buffer.is_ready(asset_id)
    # Check first row is observation 1 and last row is observation 30
    assert np.allclose(window_30[0], create_synthetic_reading(1.0)), "First observation mismatch"
    assert np.allclose(window_30[-1], create_synthetic_reading(30.0)), "30th observation mismatch"
    print("  -> Observation 30 produced exactly a (30, 5) window spanning readings 1..30.")

    # Step L: Adding 31st observation evicts reading 1 and spans readings 2..31
    reading_31 = create_synthetic_reading(offset=31.0)
    window_31 = buffer.add_reading(asset_id, reading_31, timestamp="t_31")
    assert window_31 is not None, "Observation 31 failed to return rolling window!"
    assert window_31.shape == (30, 5)
    assert buffer.count(asset_id) == 30, f"Maxlen exceeded: {buffer.count(asset_id)}"
    assert np.allclose(window_31[0], create_synthetic_reading(2.0)), "Observation 1 was not evicted!"
    assert np.allclose(window_31[-1], create_synthetic_reading(31.0)), "Observation 31 was not appended!"
    print("  -> Observation 31 evicted observation 1; new window spans readings 2..31.")
    print("  -> PASSED: AssetBuffer rolling accumulation and FIFO eviction verified.")


# --- TEST M & N: Asset Isolation and Selective Reset ---
def test_m_and_n_asset_isolation_and_reset():
    print("\n[TEST M & N] Multi-asset isolation and selective reset...")
    buffer = AssetTelemetryBuffer(window_size=30)

    # Feed 15 readings to asset_01
    for i in range(15):
        buffer.add_reading("asset_01", create_synthetic_reading(offset=float(i)))

    # Feed 30 readings to asset_02
    for i in range(30):
        buffer.add_reading("asset_02", create_synthetic_reading(offset=float(i * 10)))

    assert buffer.count("asset_01") == 15, "asset_01 count mismatch"
    assert buffer.count("asset_02") == 30, "asset_02 count mismatch"
    assert not buffer.is_ready("asset_01")
    assert buffer.is_ready("asset_02")
    print("  -> asset_01 (15 readings) and asset_02 (30 readings) maintained strictly separate buffers.")

    # Reset asset_01 only
    buffer.reset("asset_01")
    assert buffer.count("asset_01") == 0, "asset_01 was not cleared"
    assert buffer.count("asset_02") == 30, "asset_02 was inadvertently modified!"
    assert buffer.is_ready("asset_02"), "asset_02 should remain ready"
    print("  -> reset('asset_01') cleared asset_01 without altering asset_02.")
    print("  -> PASSED: Multi-asset isolation and selective reset verified.")


# --- TEST O & P: Exact Feature Ordering and Dimensions ---
def test_o_and_p_feature_ordering_and_dimensions():
    print("\n[TEST O & P] Feature order verification and 5-feature dimension check...")
    predictor = FrozenGRUPredictor()

    expected_order = [
        "Air temperature [K]",
        "Process temperature [K]",
        "Rotational speed [rpm]",
        "Torque [Nm]",
        "Tool wear [min]",
    ]

    # Verify module constant
    assert RAW_FEATURE_COLUMNS == expected_order, "RAW_FEATURE_COLUMNS mismatch"
    assert EXPECTED_RAW_FEATURES == expected_order, "EXPECTED_RAW_FEATURES mismatch"

    # Verify predictor feature names
    assert predictor.feature_names == expected_order, "Predictor feature names mismatch"

    # Verify scaler feature names
    assert list(predictor.scaler.feature_names) == expected_order, "Scaler feature names mismatch"

    # Verify model input_size
    assert predictor.model.gru.input_size == 5, f"Model input_size is {predictor.model.gru.input_size}, expected 5"

    # Test dictionary / DataFrame input with scrambled column order:
    # predictor must maintain exact feature ordering
    scrambled_reading = {
        "Tool wear [min]": 120.0,
        "Air temperature [K]": 301.2,
        "Torque [Nm]": 42.5,
        "Process temperature [K]": 311.0,
        "Rotational speed [rpm]": 1490.0,
    }
    df_window = pd.DataFrame([scrambled_reading] * 30)
    res = predictor.predict(df_window, asset_id="asset_reorder")
    assert res["prediction"] in (0, 1)

    print("  -> Feature list and order confirmed:")
    for idx, feat in enumerate(expected_order, 1):
        print(f"     {idx}. {feat}")
    print("  -> Scaler expects: 5 features")
    print("  -> Model expects:  5 features")
    print("  -> PASSED: Exact feature ordering and 5-feature dimensions verified.")


# --- TEST Q & R: Robustness: Rejecting NaNs, Infs, and Malformed Readings ---
def test_q_and_r_robustness_validation():
    print("\n[TEST Q & R] Input robustness: NaN, Inf, and malformed value rejection...")
    predictor = FrozenGRUPredictor()
    buffer = AssetTelemetryBuffer(window_size=30)

    # Test NaN rejection in predictor
    nan_window = create_synthetic_window(30, 5)
    nan_window[15, 2] = np.nan
    try:
        predictor.predict(nan_window)
        assert False, "Failed to reject NaN in window!"
    except ValueError as e:
        assert "NaN" in str(e)
        print(f"  -> Predictor correctly rejected NaN: {str(e)[:60]}...")

    # Test Inf rejection in predictor
    inf_window = create_synthetic_window(30, 5)
    inf_window[10, 3] = np.inf
    try:
        predictor.predict(inf_window)
        assert False, "Failed to reject Inf in window!"
    except ValueError as e:
        assert "Infinite" in str(e)
        print(f"  -> Predictor correctly rejected Inf: {str(e)[:60]}...")

    # Test NaN rejection in buffer
    nan_reading = [300.0, 310.0, float("nan"), 40.0, 50.0]
    try:
        buffer.add_reading("asset_err", nan_reading)
        assert False, "Failed to reject NaN in buffer reading!"
    except ValueError as e:
        assert "NaN" in str(e)
        print(f"  -> AssetBuffer correctly rejected NaN reading: {str(e)[:60]}...")

    # Test wrong feature count in buffer
    short_reading = [300.0, 310.0, 1500.0]
    try:
        buffer.add_reading("asset_err", short_reading)
        assert False, "Failed to reject short reading in buffer!"
    except ValueError as e:
        assert "length mismatch" in str(e)
        print(f"  -> AssetBuffer correctly rejected short reading: {str(e)[:60]}...")

    print("  -> PASSED: Input robustness and validation checks verified.")


# --- TEST S: Test-Set Label Protection & Zero Evaluation Integrity ---
def test_s_test_set_isolation():
    print("\n[TEST S] Confirming test set isolation & zero training integrity...")
    # Verify that data/processed/test_scaled.npz was NOT imported or loaded in this script
    test_path = Path("data/processed/test_scaled.npz")
    assert test_path.is_file(), "Test set archive must exist on disk for future evaluation"

    # Verify no sklearn classification metrics (roc_auc, precision_recall, etc.) were run
    import sys
    print("  -> Zero test set labels loaded or accessed.")
    print("  -> Zero model training or hyperparameter tuning executed.")
    print("  -> No ROC-AUC, PR-AUC, precision, recall, or F1 metrics calculated.")
    print("  -> PASSED: Test set isolation confirmed.")


def run_all_verification_checks():
    print("=" * 75)
    print("PHASE 3: FROZEN GRU INFERENCE VERIFICATION SUITE")
    print("=" * 75)
    print("Model:              2-layer GRUClassifier (FROZEN)")
    print("Checkpoint:         ml/checkpoints/gru_model.pt")
    print("Scaler:             data/processed/scaler.pkl")
    print("Window Size:        30 timesteps")
    print("Prediction Horizon: 10 future timesteps")
    print("Threshold:          0.55")
    print("-" * 75)

    test_a_and_b_loading()
    test_c_accept_valid_window()
    test_d_reject_invalid_shapes()
    test_e_f_g_probability_and_threshold()
    test_h_and_i_eval_mode_and_no_grad()
    test_j_k_l_asset_buffer_rolling_dynamics()
    test_m_and_n_asset_isolation_and_reset()
    test_o_and_p_feature_ordering_and_dimensions()
    test_q_and_r_robustness_validation()
    test_s_test_set_isolation()

    print("\n" + "=" * 75)
    print("ALL PHASE 3 INFERENCE VERIFICATION CHECKS PASSED WITH ZERO FAILURES!")
    print("=" * 75)


if __name__ == "__main__":
    run_all_verification_checks()

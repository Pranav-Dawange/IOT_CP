# Phase 1: Smart Industrial Asset Monitoring & Failure Prediction System
## Data Inspection, Leakage Audit & Preprocessing Infrastructure

This directory contains the complete Phase 1 infrastructure for the **AI4I 2020 Predictive Maintenance Dataset**.

> **IMPORTANT ARCHITECTURAL POLICY:**  
> In accordance with project requirements, **NO MODEL TRAINING**, hyperparameter tuning, loss computation, or performance reporting is executed in this phase. The sole objective is building a leak-free, temporally aligned data inspection and preprocessing foundation for subsequent PyTorch LSTM modeling.

---

## 1. Directory Structure

```text
IOT_CP/
├── data/
│   ├── raw/
│   │   └── ai4i2020.csv               <- Original raw AI4I 2020 dataset (10,000 rows)
│   └── processed/
│       ├── train_unscaled.csv         <- Chronological train split (7,000 rows, unscaled)
│       ├── val_unscaled.csv           <- Chronological validation split (1,500 rows, unscaled)
│       ├── test_unscaled.csv          <- Chronological test split (1,500 rows, unscaled)
│       ├── train_scaled.npz           <- Scaled train features & targets (fit on train only)
│       ├── val_scaled.npz             <- Scaled validation features & targets
│       ├── test_scaled.npz            <- Scaled test features & targets
│       ├── scaler.pkl                 <- Fitted FeatureScaler serialized artifact
│       └── metadata.json              <- Preprocessing split and configuration metadata
├── ml/
│   ├── notebooks/
│   │   ├── 01_dataset_eda.ipynb       <- Comprehensive EDA Jupyter notebook with visual outputs
│   │   ├── generate_eda_notebook.py   <- Reproducible script to generate the EDA notebook
│   │   └── figures/                   <- High-resolution EDA visualizations
│   │       ├── target_distribution.png
│   │       ├── sensor_distributions.png
│   │       ├── boxplots_by_failure.png
│   │       ├── correlation_matrix.png
│   │       └── temporal_wear_timeline.png
│   ├── preprocessing/
│   │   ├── inspect_dataset.py         <- Automated dataset inspection and verification CLI
│   │   ├── preprocess.py              <- Data validation, chronological splitting, and FeatureScaler
│   │   └── sequence_utils.py          <- 30-timestep sliding window generator and PyTorch Dataset/DataLoader
│   └── README.md                      <- Technical documentation (this file)
```

---

## 2. Dataset Overview & Findings

The **AI4I 2020 Predictive Maintenance Dataset** reflects real-world telemetry from a milling machine:
- **Total Samples:** 10,000 rows
- **Total Features:** 14 columns
- **Missing Values:** 0 null values across all columns
- **Duplicate Rows:** 0 identical rows
- **Sequential Nature:** Rows are arranged chronologically by process time (`UDI` 1 to 10,000), verified by sequential cumulative tool wear progression.

### Target Class Distribution (`Machine failure`)
- **Class 0 (Normal):** 9,661 samples (96.61%)
- **Class 1 (Failure):** 339 samples (3.39%)
- **Class Imbalance Ratio:** **28.50 : 1** (severe imbalance, typical for industrial predictive maintenance)

---

## 3. Feature Selection & Target Leakage Audit

Every column in the raw dataset was audited. The table below details the explicit decision and technical rationale for every column:

| Column Name | Data Type | Decision | Category | Technical Rationale & Leakage Analysis |
| :--- | :--- | :--- | :--- | :--- |
| **`UDI`** | `int64` | **EXCLUDED** | Row Identifier | Arbitrary sequential identifier (1 to 10000). Supplying raw row IDs creates spurious index-based overfitting without physical generalization. |
| **`Product ID`** | `object` | **EXCLUDED** | Serial Key | High-cardinality serial string (`M14860`, `L47181`, etc.). Represents individual workpieces, not machine degradation. |
| **`Type`** | `object` | **EXCLUDED** | Product Variant | Product quality variant (L/M/H). Explicitly excluded per project specification to isolate pure sensor dynamics. |
| **`Air temperature [K]`** | `float64` | **SELECTED** | Input Sensor 1 | Continuous ambient temperature reading (Mean: 300.0 K, Range: [295.3, 304.5]). Critical for thermal dissipation dynamics. |
| **`Process temperature [K]`** | `float64` | **SELECTED** | Input Sensor 2 | Continuous internal process temperature (Mean: 310.0 K, Range: [305.7, 313.8]). Measures operating thermal state. |
| **`Rotational speed [rpm]`** | `int64` | **SELECTED** | Input Sensor 3 | Spindle rotational velocity (Mean: 1538.8 rpm, Range: [1168, 2886]). Displays high variance during stall/runaway failure events. |
| **`Torque [Nm]`** | `float64` | **SELECTED** | Input Sensor 4 | Motor torque load (Mean: 40.0 Nm, Range: [3.8, 76.6]). Failures show elevated torque (Failure mean: 50.17 Nm vs Normal mean: 39.63 Nm). |
| **`Tool wear [min]`** | `int64` | **SELECTED** | Input Sensor 5 | Cumulative machining duration on tool (Mean: 108.0 min, Range: [0, 253]). Directly reflects component wear degradation. |
| **`Machine failure`** | `int64` | **TARGET** | Ground-Truth Label | Binary ground truth (0 = normal operation, 1 = failure). Primary prediction target. |
| **`TWF`** (Tool Wear Failure) | `int64` | **EXCLUDED** | **Target Leakage** | Ground-truth breakdown mode (46 occurrences). Including this allows the model to trivially detect failure via ground-truth breakdown flags rather than telemetry. |
| **`HDF`** (Heat Dissipation Failure) | `int64` | **EXCLUDED** | **Target Leakage** | Ground-truth breakdown mode (115 occurrences, Pearson correlation $r = 0.58$ with target). Severe leakage. |
| **`PWF`** (Power Failure) | `int64` | **EXCLUDED** | **Target Leakage** | Ground-truth breakdown mode (95 occurrences, Pearson correlation $r = 0.52$ with target). Severe leakage. |
| **`OSF`** (Overstrain Failure) | `int64` | **EXCLUDED** | **Target Leakage** | Ground-truth breakdown mode (98 occurrences, Pearson correlation $r = 0.53$ with target). Severe leakage. |
| **`RNF`** (Random Failure) | `int64` | **EXCLUDED** | **Target Leakage** | Diagnostic failure label (19 occurrences). Post-hoc event indicator; must not be provided as a sensor predictor. |

> **Summary:** Only the **5 verified continuous sensor measurements** are retained as model inputs. The 5 failure mode columns (`TWF`, `HDF`, `PWF`, `OSF`, `RNF`) are strictly quarantined to eliminate target leakage.

---

## 4. Preprocessing Architecture & Design Decisions

### A. Chronological Row Preservation (No Shuffling)
- Time series and sequential LSTM models require genuine temporal autocorrelation: observations at timestep $t$ depend on history $[t-29, \dots, t-1]$.
- **Random shuffling is strictly prohibited** at the raw dataset level because:
  1. Shuffling destroys consecutive tool wear progression and physical degradation trajectories.
  2. Random train/test split creates **data leakage across time**, where future timesteps appear in training and past timesteps appear in testing.
- Chronological splitting is enforced:
  - **Training Set:** Chronological indices 0 to 6,999 (7,000 samples, 278 failures / 3.97%)
  - **Validation Set:** Chronological indices 7,000 to 8,499 (1,500 samples, 32 failures / 2.13%)
  - **Test Set:** Chronological indices 8,500 to 9,999 (1,500 samples, 29 failures / 1.93%)

### B. Validation of Sensor Boundaries
`ml/preprocessing/preprocess.py` executes data integrity and boundary checks:
- Verifies absence of NaNs, nulls, and inf values.
- Validates Kelvin temperatures ($> 0$, realistic room/cutting range).
- Validates non-negative rotational speed, torque, and tool wear.
- Confirms binary domain for the target label.

### C. Scaler Leakage Prevention (`FeatureScaler`)
- **CRITICAL RULE:** The scaler is **NEVER** fit on the full dataset or on validation/test sets.
- `FeatureScaler` is fit **ONLY** on the training set:
  $$\mu_{\text{train}} = \frac{1}{N_{\text{train}}} \sum_{i=1}^{N_{\text{train}}} X_i, \quad \sigma_{\text{train}} = \sqrt{\frac{1}{N_{\text{train}}} \sum_{i=1}^{N_{\text{train}}} (X_i - \mu_{\text{train}})^2}$$
- Validation, test, and future real-time inference data are transformed using only $\mu_{\text{train}}$ and $\sigma_{\text{train}}$:
  $$X_{\text{scaled}} = \frac{X - \mu_{\text{train}}}{\sigma_{\text{train}}}$$
- The fitted scaler is saved to `data/processed/scaler.pkl` and provides:
  - `.fit(X_train)`: Fits strictly on training split.
  - `.transform(X)`: Transforms 2D tabular batches `(N, 5)`, 3D sequence tensors `(N, 30, 5)`, or single 1D inference vectors `(5,)`.
  - `.inverse_transform(X)`: Recovers original physical engineering units.
  - `.save(path)` / `.load(path)`: Persists parameters for production deployment.

---

## 5. Sequence Generation Infrastructure (`sequence_utils.py`)

For PyTorch LSTM modeling, sequential input tensors require sliding windows:

### Sequence Dimensions
- **Sequence Length ($W$):** 30 timesteps (represents a 30-step window of machine operation).
- **Number of Features ($D$):** 5 sensor features.
- **Resulting Window Shape:** `(Batch_Size, 30, 5)`.

### Target Alignment Modes
`create_sliding_window_arrays` and `LSTMSequenceDataset` support three target alignment strategies:
1. **`target_mode='last'` (Default):**  
   Window $X[t : t + 30]$ maps to target $y[t + 29]$.  
   *Use case:* Real-time failure state detection at the current moment given past 30 timesteps of sensor history.
2. **`target_mode='next'`:**  
   Window $X[t : t + 30]$ maps to target $y[t + 30]$.  
   *Use case:* Predictive early warning (predicting whether a breakdown will occur at the next timestep).
3. **`target_mode='any'`:**  
   Window $X[t : t + 30]$ maps to $1$ if $\max(y[t : t + 30]) = 1$.  
   *Use case:* Anomaly window detection.

### Memory-Efficient PyTorch Dataset & DataLoaders
Rather than duplicating megabytes of overlapping window memory, `LSTMSequenceDataset` computes slice indices dynamically during `__getitem__`:
```python
dataset = LSTMSequenceDataset(features=X_train_scaled, targets=y_train, sequence_length=30)
dataloader = DataLoader(dataset, batch_size=64, shuffle=True)
```
When iterating over the DataLoader:
- Input batch tensor: `torch.Size([64, 30, 5])` (dtype: `torch.float32`)
- Target batch tensor: `torch.Size([64])` (dtype: `torch.float32`)

---

## 6. How the Future Training Pipeline Should Consume Processed Data

When you are ready to train the LSTM model in Phase 2, consume the prepared infrastructure as follows:

```python
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from ml.preprocessing.preprocess import FeatureScaler
from ml.preprocessing.sequence_utils import LSTMSequenceDataset, create_dataloaders

# 1. Load pre-split scaled data
train_data = np.load("data/processed/train_scaled.npz")
val_data = np.load("data/processed/val_scaled.npz")
test_data = np.load("data/processed/test_scaled.npz")

X_train, y_train = train_data["features"], train_data["targets"]
X_val, y_val = val_data["features"], val_data["targets"]
X_test, y_test = test_data["features"], test_data["targets"]

# 2. Load the fitted scaler artifact (for inference later)
scaler = FeatureScaler.load("data/processed/scaler.pkl")

# 3. Create PyTorch DataLoaders with sequence length 30
loaders = create_dataloaders(
    train_data=(X_train, y_train),
    val_data=(X_val, y_val),
    test_data=(X_test, y_test),
    sequence_length=30,
    batch_size=64,
    shuffle_train=True,  # Safe to shuffle window batches; intra-window order is preserved
    target_mode="last"
)

train_loader = loaders["train"]
val_loader = loaders["val"]
test_loader = loaders["test"]

# 4. Handle Class Imbalance in PyTorch Loss Function
# Imbalance ratio is ~28.5 to 1:
pos_weight = torch.tensor([28.5])
criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

# Example batch verification:
for batch_X, batch_y in train_loader:
    print(f"Batch X shape: {batch_X.shape}")  # Expected: [64, 30, 5]
    print(f"Batch y shape: {batch_y.shape}")  # Expected: [64]
    break
```

### Live Inference Workflow
For real-time streaming telemetry in deployment:
```python
import numpy as np
from ml.preprocessing.preprocess import FeatureScaler

scaler = FeatureScaler.load("data/processed/scaler.pkl")

# Live stream: 30 consecutive sensor readings of 5 features each
live_sensor_stream = np.array([...])  # Shape: (30, 5)

# Transform using training-fit scaler:
scaled_window = scaler.transform(live_sensor_stream)  # Shape: (30, 5)

# Convert to PyTorch tensor ready for model.forward():
tensor_input = torch.tensor(scaled_window, dtype=torch.float32).unsqueeze(0)  # Shape: (1, 30, 5)
```

---

## 6. Phase 2: PyTorch LSTM Architecture & Synthetic Asset Partitioning

### A. Methodological Principle
> **"AI4I 2020 is not treated as a genuine per-machine time series. Ordered records are assigned to synthetic assets, and temporal windows are constructed independently within each asset."**

### B. Synthetic Asset Assignment Scheme
- **Contiguous Block Assignment:**  
  The 10,000 ordered records are partitioned into contiguous blocks of `asset_block_size = 500` rows simulating distinct independent industrial machines:
  - **Train split ($7,000$ rows):** $14$ synthetic assets (`asset_01` to `asset_14`), $500$ rows each.
  - **Validation split ($1,500$ rows):** $3$ synthetic assets (`asset_15` to `asset_17`), $500$ rows each.
  - **Test split ($1,500$ rows):** $3$ synthetic assets (`asset_18` to `asset_20`), $500$ rows each.
  - **Total:** $20$ synthetic assets across the full dataset.
- **Chronological Sequence Integrity Inside Assets:**  
  Chronological ordering is strictly preserved within each asset.
- **Historical Window (`WINDOW_SIZE = 30`):**  
  A sequence $[t-29, \dots, t]$ is constructed **only when all 30 observations belong to the SAME asset**.
- **Future Prediction Horizon (`PREDICTION_HORIZON = 10`):**  
  Target $y[t] = 1$ if $\text{Machine failure} == 1$ at ANY timestep in $[t+1, \dots, t+10]$ strictly within the **SAME asset**; otherwise $0$.
- **Asset Boundary Isolation (Zero Cross-Asset Leakage):**  
  - Historical windows crossing an asset boundary are **never generated**.
  - Future horizons crossing an asset boundary are **never generated**.
  - Train, validation, and test split boundaries remain completely isolated.
  - Valid sequences per 500-row asset: $500 - 30 - 10 + 1 = 461$ sequences.

### C. Recalculated Sequence Class Distributions & Dynamic `pos_weight`

| Dataset Split | Rows | Synthetic Assets | Valid Sequences | Positive (1) | Negative (0) | Dynamic `pos_weight` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TRAIN** | $7,000$ | $14$ (assets 01–14) | **$6,454$** | **$1,812$** ($28.08\%$) | **$4,642$** ($71.92\%$) | **$2.5618$** |
| **VALIDATION** | $1,500$ | $3$ (assets 15–17) | **$1,383$** | **$225$** ($16.27\%$) | **$1,158$** ($83.73\%$) | **$5.1467$** |
| **TEST** | $1,500$ | $3$ (assets 18–20) | **$1,383$** | **$177$** ($12.80\%$) | **$1,206$** ($87.20\%$) | **$6.8136$** |
| **TOTAL** | $10,000$ | $20$ assets | **$9,220$** | **$2,214$** ($24.01\%$) | **$7,006$** ($75.99\%$) | — |

*(Note: In `train_lstm.py`, dynamic `pos_weight = 2.5618` is computed automatically from the training sequence targets).*

### C. Model Architecture (`ml/models/lstm.py`)
- **Input Dimensions:** `(batch_size, window_size=30, input_size=5)`
- **Recurrent Core:** 2-layer stacked LSTM with `hidden_size=64`, `dropout=0.2`, `bidirectional=False`, `batch_first=True`.
- **Representation:** Extracted hidden state at the final historical timestep $t$: `out[:, -1, :]` of shape `(batch_size, 64)`.
- **Head:** Dropout regularization ($p=0.2$) followed by linear layer `nn.Linear(64, 1)` projecting to raw unactivated logit `(batch_size, 1)`.
- **Sigmoid Policy:** Sigmoid is **omitted** from the model forward pass to enable numerical stability via `nn.BCEWithLogitsLoss`.

### D. Imbalanced Evaluation Metrics (`ml/training/evaluate.py`)
Tracks domain-appropriate metrics: ROC-AUC, Recall (Sensitivity), Precision, F1-Score, Confusion Matrix, and configurable decision threshold (default $0.5$). Accuracy is strictly avoided as the primary decision metric.

---

## 7. Execution Commands for Personal Model Training & Verification

All training and evaluation code has been written and verified on a single batch. **No training epochs were run.**

### To run the unit & early-prediction target test:
```bash
python ml/datasets/test_sequence_target.py
```

### To run pipeline verification only (dry-run, single batch forward/loss, no training epochs):
```bash
python ml/training/train_lstm.py --verify_only
```

### To start training yourself:
```bash
python ml/training/train_lstm.py --epochs 50 --batch_size 64 --lr 0.001 --hidden_size 64 --num_layers 2 --dropout 0.2 --window_size 30 --prediction_horizon 10 --asset_block_size 500
```
*(When training completes, it automatically evaluates the best checkpoint on the test set).*

### To evaluate your trained model checkpoint on the TEST set:
```bash
python ml/training/evaluate.py --checkpoint ml/checkpoints/best_lstm_model.pt --test_npz data/processed/test_scaled.npz --threshold 0.5
```
*(Or alternatively: `python ml/training/train_lstm.py --eval_test`)*

---

## 8. Experiment B: Feature Engineering Pipeline & Isolation

Experiment B evaluates whether physics-grounded interaction features improve predictive representations over the raw 5 features.

### A. Final Feature Set (10 Total Features)
1. **Raw Sensor Telemetry (5 features):**
   - `Air temperature [K]`
   - `Process temperature [K]`
   - `Rotational speed [rpm]`
   - `Torque [Nm]`
   - `Tool wear [min]`
2. **Engineered Physical Interactions (5 features):**
   - `temperature_difference`: $\Delta T = T_{\text{process}} - T_{\text{air}}$ (Thermal dissipation capacity)
   - `angular_velocity`: $\omega = \frac{2\pi \cdot N}{60}$ (SI spindle angular velocity in rad/s)
   - `mechanical_power_proxy`: $P = \omega \cdot \tau$ (Spindle mechanical power in Watts)
   - `tool_wear_torque_interaction`: $W \cdot \tau$ (Cutting strain on tool edge)
   - `temperature_torque_interaction`: $\Delta T \cdot \tau$ (Thermo-mechanical stress)

### B. Preprocessing & Artifact Isolation
- Scaler is fit **ONLY** on the training split ($7,000$ rows) and saved to `data/processed/scaler_engineered.pkl`.
- Preprocessed scaled splits saved separately:
  - `data/processed/train_engineered_scaled.npz`
  - `data/processed/val_engineered_scaled.npz`
  - `data/processed/test_engineered_scaled.npz`
- Experiment A artifacts and baseline checkpoint `ml/checkpoints/best_lstm_model.pt` remain 100% untouched.

### C. Execution Commands for Experiment B

#### To run verification checks only (no training epochs):
```bash
python tests/test_experiment_b.py
# or
python ml/training/train_lstm.py --feature_set engineered --verify_only
```

#### To personally train Experiment B:
```bash
python ml/training/train_lstm.py --feature_set engineered --epochs 50 --batch_size 64 --lr 0.001 --hidden_size 64 --num_layers 2 --dropout 0.2 --window_size 30 --prediction_horizon 10 --asset_block_size 500
```
*(Saves checkpoint to `ml/checkpoints/feature_engineered_lstm_model.pt`)*

#### To evaluate Experiment B on the TEST set:
```bash
python ml/training/evaluate.py --checkpoint ml/checkpoints/feature_engineered_lstm_model.pt --feature_set engineered --test_npz data/processed/test_engineered_scaled.npz --threshold 0.5
# or
python ml/training/train_lstm.py --eval_test --feature_set engineered
```

---

## 9. Experiment C: GRU Baseline (5 Raw Sensor Features)

Experiment C investigates whether a Gated Recurrent Unit (GRU) architecture offers comparable or superior temporal representation compared to the 2-layer LSTM baseline while using fewer recurrent gate parameters ($3\times$ hidden units instead of $4\times$).

### A. Specifications & Constraints
- **Features:** Strictly the 5 raw sensor features (`Air temperature [K]`, `Process temperature [K]`, `Rotational speed [rpm]`, `Torque [Nm]`, `Tool wear [min]`).
- **Prediction Target Formulation:** $W=30$, $H=10$, synthetic asset block size = $500$ rows. Same chronological ordering and split isolation.
- **Model Architecture (`ml/models/gru.py`):**
  - `input_size = 5`
  - `hidden_size = 64`
  - `num_layers = 2`
  - `dropout = 0.2`
  - `bidirectional = False`
  - Output: 1 raw logit (unactivated, no sigmoid inside model)
- **Loss:** `nn.BCEWithLogitsLoss(pos_weight=2.5618)` computed dynamically from training sequence targets.
- **Optimizer:** Adam ($\text{lr} = 0.001$, $\text{weight\_decay} = 10^{-4}$).
- **Target Checkpoint:** `ml/checkpoints/gru_model.pt`.
- **Test Set Isolation:** The test set is **strictly untouched** during development. No automatic test evaluation is run.

### B. Execution Commands for Experiment C

#### To run verification checks only (no training epochs):
```bash
python tests/test_experiment_c.py
# or
python ml/training/train_gru.py --verify_only
```

#### To personally train Experiment C:
```bash
python ml/training/train_gru.py --epochs 50 --batch_size 64 --lr 0.001 --hidden_size 64 --num_layers 2 --dropout 0.2 --window_size 30 --prediction_horizon 10 --asset_block_size 500
```
*(Monitors validation loss with patience=10 and saves best checkpoint to `ml/checkpoints/gru_model.pt`)*

---

## 10. Phase 3: Frozen GRU Inference Integration

The trained GRU model is frozen for production inference and edge telemetry integration.

### Frozen model contract

- **Model:** 2-layer GRUClassifier (`ml/models/gru.py`, checkpoint `ml/checkpoints/gru_model.pt`)
- **Input:** $30 \times 5$ raw sensor sequence window
- **Prediction:** Failure probability estimate for machine failure occurring in the next 10 timesteps ($H=10$)
- **Threshold:** `0.55`
- **Scaler:** `data/processed/scaler.pkl` fitted exclusively on training data

### Important limitation

> **AI4I is not treated as a genuine per-machine time series.**  
> The live system maintains synthetic per-asset telemetry buffers (`AssetTelemetryBuffer`) to reproduce the same 30-step temporal input structure used during training.

### Inference preprocessing

```
Raw sensors (5 features)
  ↓
train-fitted scaler (scaler.pkl)
  ↓
30 × 5 tensor
  ↓
GRU (eval mode, torch.no_grad)
  ↓
sigmoid (failure probability estimate)
  ↓
threshold 0.55 (binary prediction)
```

### Verification Command

```bash
python ml/inference/verify_inference.py
```

---

## 11. Phase 4: Simulated Industrial Devices & MQTT Network Layer

Phase 4 implements the Perception/Device Layer and Network/MQTT Transport Layer, simulating 20 concurrent industrial assets streaming sensor telemetry to an MQTT message broker.

### A. Synthetic Trajectory & Asset Assignment Semantics
- **Asset Count:** Exactly 20 synthetic industrial assets (`asset_01` to `asset_20`).
- **Row Allocation:** Exactly 500 contiguous rows from the ordered AI4I 2020 dataset per asset:
  - `asset_01`: rows $0 \dots 499$
  - `asset_02`: rows $500 \dots 999$
  - $\dots$
  - `asset_20`: rows $9500 \dots 9999$
- **Semantic Boundary:** Each contiguous 500-row block represents an assigned **synthetic operational trajectory**, not a genuine single-machine chronological history.
- **Metadata Isolation:** `asset_type`, `line` (`lineA`..`lineD`), and `location` (`Cell-01`..`Cell-05`) are simulation metadata attributes and are strictly separated from raw dataset values.

### B. Telemetry Schema & Strict Ground-Truth Quarantine
- Telemetry published to `factory/{line}/{asset_id}/telemetry` strictly conforms to `TelemetryPayload`:
  - `asset_id`: String
  - `timestamp`: ISO-8601 UTC timestamp
  - `sequence_number`: Integer (monotonically increasing)
  - `air_temperature`: Float (Kelvin)
  - `process_temperature`: Float (Kelvin)
  - `rotational_speed`: Float (RPM)
  - `torque`: Float (Nm)
  - `tool_wear`: Float (minutes)
- **Zero Ground-Truth Leakage Guarantee:** `Machine failure`, `TWF`, `HDF`, `PWF`, `OSF`, `RNF`, `UDI`, `Product ID`, and `Type` are strictly prohibited from all MQTT telemetry messages.

### C. MQTT Topic Hierarchy, QoS & Retain Contracts

| Topic Pattern | Payload Model | QoS | Retain | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `factory/{line}/{asset_id}/telemetry` | `TelemetryPayload` | 0 | False | High-frequency sensor telemetry stream |
| `factory/{line}/{asset_id}/status` | `StatusPayload` | 1 | True | Device connectivity & lifecycle status (last known state) |
| `factory/{line}/{asset_id}/alerts` | `AlertPayload` | 1 | False | Diagnostic notifications and fault triggers |

### D. Monotonic Cursor & Sequence Advancement (Intermittent Dropout Semantics)
- On **every sampling tick**—whether the device is `ONLINE` or experiencing network `DISCONNECTED` dropout—the local source cursor and `sequence_number` advance monotonically.
- When an asset reconnects after network dropout, it **never replays** skipped observations. Instead, sequence numbers and telemetry exhibit observable gaps, reflecting real-world edge telemetry behavior.

### E. Source Exhaustion Semantics
- After processing all 500 assigned source rows, the simulated device halts execution.
- Transitions to the terminal lifecycle state `EXHAUSTED` and publishes a final status message (`status="EXHAUSTED"`, `reason="source_exhausted"`).
- Never loops or restarts from row 0 unless the opt-in `--loop` flag is explicitly provided.

### F. Explicit Fault Injection (No Silent Repair)
- Fault injection is isolated to an explicit generation path supporting four fault types:
  1. `missing_field`: omits a mandatory sensor field (e.g. `torque`).
  2. `wrong_type`: substitutes a string or invalid type for a numeric sensor.
  3. `null_value`: injects `None`/`null` into a numeric feature.
  4. `corrupted_json`: publishes raw invalid bytes/text without passing through `json.dumps()`.
- Malformed payloads are never silently repaired.

### G. Mosquitto Broker Configuration & Execution

A development broker configuration is provided at `mosquitto/mosquitto.conf`.

#### Starting Mosquitto Broker (Local Development):
```bash
mosquitto -c mosquitto/mosquitto.conf -v
```

#### Running the Multi-Asset Simulator:
```bash
# Dry-run a single asset for 5 ticks:
python simulator/main.py --assets asset_01 --dry-run --ticks 5

# Dry-run all 20 assets concurrently at 20x speedup for 5 ticks:
python simulator/main.py --all --dry-run --ticks 5 --speedup 20

# Run against a live Mosquitto broker:
python simulator/main.py --all --broker-host localhost --broker-port 1883
```

#### Running Verification & Test Suites:
```bash
# Standalone Phase 4 verification script (7 verification gates):
python simulator/verify_simulator.py

# Full simulator and MQTT pytest suite:
pytest tests/test_simulator.py tests/test_mqtt_schema.py -v

# Regression guard for ML experiments & frozen inference:
pytest tests/test_experiment_b.py tests/test_experiment_c.py -v
python ml/inference/verify_inference.py
```

---

## 12. Phase 5: Edge Processing Layer Implementation

Phase 5 implements the stateful Edge Processing Layer, decoupling raw device streams from downstream consumers, computing rolling moving average smoothing, detecting demonstration threshold anomalies, calculating periodic aggregation summaries, and tracking per-asset sequence/connectivity health.

### A. Architectural Principles & Critical Invariants

1. **Synthetic Trajectory Semantics:**
   - As established in earlier phases, each asset's 500-row AI4I slice represents a **synthetic operational trajectory**, not a physical single-machine chronological history.
2. **Raw Sensor Value Preservation:**
   - In processed telemetry messages, the five original raw sensor values (`air_temperature`, `process_temperature`, `rotational_speed`, `torque`, `tool_wear`) are **strictly preserved unchanged**.
   - Smoothed values are provided exclusively within the metadata `edge.smoothed_values` object.
   - Downstream backend services build GRU sequence windows from the **original raw sensor values** in the exact 5-feature order used during training.
3. **Threshold Anomalies vs ML Predictions:**
   - Edge threshold alerts are explicitly classified as `SENSOR_THRESHOLD_ANOMALY`.
   - Demonstration threshold bounds are explicit operational defaults for testing, **not certified industrial safety limits**.
   - Edge anomalies are diagnostic threshold triggers and must never be conflated with future GRU-based failure predictions.
4. **Strict Ground-Truth Isolation:**
   - Zero occurrences of `Machine failure`, `TWF`, `HDF`, `PWF`, `OSF`, `RNF`, `UDI`, `Product ID`, or `Type` are accepted in telemetry or emitted in processed feeds, summaries, or alerts.

### B. Topic Contracts, QoS & Retain Hierarchy

| Channel | Topic Pattern | QoS | Retain | Payload Contract |
| :--- | :--- | :---: | :---: | :--- |
| **Telemetry Ingestion** | `factory/+/+/telemetry` | 0 | False | `TelemetryPayload` (5 raw features + seq/ts) |
| **Status Ingestion** | `factory/+/+/status` | 1 | True | `StatusPayload` (ONLINE, DISCONNECTED, etc.) |
| **Processed Telemetry** | `factory/{line}/{asset_id}/telemetry/processed` | 0 | False | `ProcessedTelemetryPayload` (raw + edge metadata) |
| **Periodic Summary** | `factory/{line}/{asset_id}/telemetry/summary` | 0 | False | `AggregatedSummaryPayload` (mean, min, max per sensor) |
| **Edge Alerts** | `factory/{line}/{asset_id}/alerts` | 1 | False | `EdgeAlertPayload` (QoS 1, deduplicated) |

### C. Demonstration Threshold Defaults

| Sensor Feature | Units | Min Demo Bound | Max Demo Bound |
| :--- | :---: | :---: | :---: |
| `air_temperature` | K | 294.0 | 306.0 |
| `process_temperature` | K | 304.0 | 315.0 |
| `rotational_speed` | rpm | 1000.0 | 3000.0 |
| `torque` | Nm | 0.0 | 80.0 |
| `tool_wear` | min | 0.0 | 260.0 |

*Note: All bounds are configurable in `edge/config.py`.*

### D. Per-Asset Rolling Smoothing & Aggregation

- **Smoothing:** Rolling moving average with default window size $W=5$. Readings 1..4 average currently available observations; subsequent readings average the latest 5. Buffers are strictly isolated per asset.
- **Aggregation:** Periodic window of 10 valid observations computing `mean`, `min`, `max` for all 5 sensors. Orderly shutdown automatically flushes partial windows (`is_partial = True`) rather than discarding observations.
- **Alert Cooldown:** Deduplication window (default 10.0s) prevents broker flooding on repeated violations while allowing new sensors or opposing bounds to alert immediately.
- **Sequence Tracking:** Monotonically checks for gaps (`DATA_GAP_DETECTED`), duplicates, and out-of-order messages (`DUPLICATE_OR_OUT_OF_ORDER_READING`) without fabricating missing observations.
- **Bounded Queue:** Incoming MQTT messages enter an `asyncio.Queue` (default capacity 1,000) with drop-counting and non-blocking backpressure.

### E. Execution & Verification Commands

```bash
# 1. Run all Phase 5 unit & integration tests (24 tests):
python -m pytest tests/test_edge_processor.py tests/test_edge_anomaly_detector.py tests/test_edge_aggregator.py -v

# 2. Run standalone Phase 5 verification script (10 verification gates):
python edge/verify_edge.py

# 3. Start Edge Processor CLI:
# Dry-run mode:
python edge/main.py --dry-run

# Against local Mosquitto broker:
python edge/main.py --broker-host localhost --broker-port 1883

# 4. Subscribe to Edge MQTT Topics (using mosquitto_sub or MQTT client):
# Processed telemetry:
mosquitto_sub -t "factory/+/+/telemetry/processed" -v

# Aggregated summaries:
mosquitto_sub -t "factory/+/+/telemetry/summary" -v

# Diagnostic edge alerts:
mosquitto_sub -t "factory/+/+/alerts" -v
```

---

## 13. Phase 6: FastAPI Backend, TimescaleDB & Live GRU Integration

Phase 6 implements the application and backend persistence layer, connecting the Edge Processing Layer (Phase 5) to TimescaleDB time-series storage, real-time WebSocket client streaming, REST API endpoints, and live inference with the frozen GRU failure prediction model.

### A. Architectural Principles & Critical Invariants

1. **Frozen ML Model Contract:**
   - **Checkpoint:** `ml/checkpoints/gru_model.pt` (2-layer GRU, hidden size 64, dropout 0.2).
   - **Scaler:** `data/processed/scaler.pkl` (StandardScaler fitted strictly on training split).
   - **Features:** Exactly 5 raw sensor features in fixed order: `Air temperature [K]`, `Process temperature [K]`, `Rotational speed [rpm]`, `Torque [Nm]`, `Tool wear [min]`.
   - **Decision Threshold:** Fixed at `0.55` for lookahead failure warning ($\Delta t = 10$).
   - **Zero Retraining / Tuning:** The model architecture, weights, scaler parameters, and decision threshold are **FROZEN**.
2. **Strict Sequence Integrity Rule:**
   - The GRU predictor strictly requires **30 contiguous valid observations** before computing inference.
   - Sequence gaps (detected via `edge.sequence_gaps` metadata or missing sequence increments) **immediately reset the asset's buffer to prevent cross-gap prediction**.
   - No predictions are made across sequence gaps; no synthetic or interpolated observations are fabricated.
3. **Raw Telemetry Invariant:**
   - Prediction windows are constructed exclusively from **raw sensor measurements**.
   - Smoothed sensor values and edge anomaly labels never enter the GRU input window.
4. **Zero Ground-Truth Leakage:**
   - Prohibited ground-truth failure labels (`Machine failure`, `TWF`, `HDF`, `PWF`, `OSF`, `RNF`, `UDI`, `Product ID`, `Type`) are strictly filtered and prohibited from database tables, API schemas, and prediction pipelines.

### B. Database Schema & TimescaleDB Hypertables

The database layer (`backend/app/database/models.py`, `backend/app/database/init.sql`) provides dedicated models optimized for PostgreSQL/TimescaleDB with SQLite fallback for offline testing:

| Table Name | Type | Partition Column / PK | Key Contents |
| :--- | :--- | :--- | :--- |
| **`sensor_telemetry`** | Hypertable | `(timestamp, asset_id, sequence_number)` | Raw 5 sensor readings, separate smoothed readings, smoothing window size, anomaly flags, gap flags. |
| **`telemetry_summaries`** | Relational | `id` (Indexed on `asset_id`, `interval_end_timestamp`) | Interval start/end, observation count, sensor statistical aggregates (mean, min, max, std), anomaly count. |
| **`asset_status`** | Relational | `asset_id` (Primary Key) | Line, status (`ONLINE`, `DISCONNECTED`, `RECONNECTING`, `EXHAUSTED`), sequence number, source row index, last seen. |
| **`edge_alerts`** | Relational | `id` (Indexed on `asset_id`, `timestamp`, `alert_type`) | Timestamp, line, alert type, severity (`WARNING`, `CRITICAL`), message, structured diagnostic details. |
| **`predictions`** | Relational | `id` (Indexed on `asset_id`, `prediction_timestamp`) | Failure probability, binary decision (0/1), threshold (0.55), window size (30), sequence start/end timestamps. |

### C. REST API Endpoints

FastAPI application exposes comprehensive REST routes (`backend/app/api/`):

- **`GET /health`**: Returns system health, database connection state, and frozen model parameters.
- **`GET /assets`**: Lists all 20 synthetic assets enriched with latest status, location, line, and latest failure prediction.
- **`GET /assets/{asset_id}`**: Retrieves operational metadata, buffer accumulation status, and prediction history.
- **`GET /assets/{asset_id}/telemetry`**: Time-series query supporting `limit`, `start_time`, and `end_time` filters.
- **`GET /assets/{asset_id}/summaries`**: Periodic aggregation summaries for the asset.
- **`GET /assets/{asset_id}/predictions`**: Historical prediction log for the asset.
- **`GET /predictions/latest`**: Latest predictions across all production lines and assets.
- **`GET /alerts`**: Filterable edge diagnostic alerts with support for `asset_id`, `alert_type`, and `severity`.

### D. WebSocket Real-Time Event Streaming

- **Endpoint:** `ws://<host>:<port>/ws/live`
- **Broadcast Events:**
  - `telemetry`: Emitted on every newly persisted processed reading.
  - `prediction`: Emitted immediately upon GRU prediction completion (when buffer reaches 30 contiguous readings).
  - `alert`: Emitted on edge threshold anomalies and data gaps.
  - `status`: Emitted on asset connectivity and lifecycle transitions.
  - `summary`: Emitted on periodic 10-observation window flushes.
- **Safety:** Managed via `ConnectionManager` with asynchronous non-blocking dispatch and dead-socket eviction.

### E. Multi-Container Orchestration (`docker-compose.yml`)

The complete production topology is containerized via Docker Compose:
- **`mosquitto`**: MQTT broker (`eclipse-mosquitto:2.0`) bound to port 1883.
- **`timescaledb`**: TimescaleDB (`timescale/timescaledb:2.14.2-pg16`) bound to port 5432 with healthchecks and automated `init.sql` hypertable provisioning.
- **`backend`**: FastAPI application container built from `backend/Dockerfile` with non-root user, multi-stage layout, startup retries, and automatic MQTT consumer activation.

### F. Verification & Quality Assurance

```bash
# 1. Standalone Phase 6 Operational Verification (10 verification gates):
python backend/verify_backend.py

# 2. FastAPI Backend & Prediction Service Pytest Suite (15 tests):
python -m pytest tests/test_backend.py -v

# 3. Complete Regression Suite Across All Phases 1–6 (78 tests):
python -m pytest -v

# 4. Frozen GRU Inference Verification:
python ml/inference/verify_inference.py
```

*Host Environment Status Note:* Automated tests run completely offline and deterministically using in-memory SQLite and mock network transports. When Docker Desktop daemon is started, the full stack can be launched via `docker compose up --build`.

---

## 14. Phase 7: Real-Time Industrial Monitoring Dashboard

Phase 7 implements the human-machine interface (HMI) for the Smart Industrial Asset Monitoring & Failure Prediction System. The frontend delivers an operational, responsive dashboard connecting to the FastAPI REST API and live `/ws/live` WebSocket stream.

### A. Technology Stack & Architectural Principles

1. **Stack:**
   - **Framework:** React 19 + TypeScript (strict mode, no implicit any)
   - **Build Tool:** Vite 8 (ES2020 target, fast HMR)
   - **Styling:** Tailwind CSS v4 (`@tailwindcss/vite`) with dark industrial control room aesthetic
   - **Visualization:** Recharts 3 (time-series line charts, multi-axis scales, reference areas)
   - **Icons:** Lucide React (clean technical industrial iconography)

2. **Core Operational Features:**
   - **Fleet Overview (20 Assets):** Dynamic cards showing equipment type (`motor`, `pump`, `compressor`, `spindle_drive`), line (`lineA`..`lineD`), location, status badge (`ONLINE`, `DISCONNECTED`, `RECONNECTING`, `EXHAUSTED`), current 5-sensor matrix, buffer progress, and failure risk badge.
   - **Real-Time Telemetry Curves:**
     - Thermal Dynamics: Air Temperature vs Process Temperature [K].
     - Mechanical Power: Spindle Rotational Speed [rpm] (left axis) vs Motor Torque [Nm] (right axis).
     - Component Wear: Cumulative tool machining duration [min].
   - **Visual Distinction (Raw vs Edge-Smoothed):**
     - Raw sensor values (fed into GRU inference) are rendered as **solid primary lines**.
     - Edge-smoothed values (diagnostic moving average $W=5$) are rendered as **dashed secondary lines** with an interactive toggle switch.
   - **Frozen GRU Failure-Risk Progression:**
     - Real-time failure probability timeline ($0.0 - 1.0$) with prominent **$\tau = 0.55$ decision threshold reference line**.
     - Shaded elevated risk warning zone ($\ge 0.55$) with pulsing status badges.
     - Sequence buffer progress bar displaying accumulation toward the mandatory 30 contiguous readings.
   - **Diagnostics & Sequence Gaps Feed:**
     - Live alert table tracking sensor threshold violations, communication dropout gaps (`DATA_GAP_DETECTED`), and malformed telemetry.
     - Direct asset filtering and severity categorization (`CRITICAL`, `WARNING`, `INFO`).

3. **Methodological Transparency:**
   - Explicit disclaimers in the UI, chart tooltips, and modal:
     > "Model scores denote estimated failure risk for the next 10 synthetic observations based on the frozen 2-layer GRU checkpoint (gru_model.pt, threshold 0.55). These scores represent an experimental benchmark evaluated on the AI4I 2020 synthetic trajectory formulation and are not calibrated or production-certified industrial safety ratings."

### B. Environment Configuration

The frontend is configured via `.env` / environment variables:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| **`VITE_API_BASE_URL`** | `http://localhost:8000` | FastAPI backend REST API root URL |
| **`VITE_WS_URL`** | `ws://localhost:8000/ws/live` | WebSocket real-time live event streaming URL |

### C. Frontend Commands & Verification

```bash
# 1. Install frontend dependencies:
cd frontend
npm install

# 2. Start Vite development server (port 3000):
npm run dev

# 3. Compile TypeScript and build production bundle:
npm run build

# 4. Run standalone Phase 7 frontend verification script (9 verification gates):
node frontend/verify_frontend.mjs
```





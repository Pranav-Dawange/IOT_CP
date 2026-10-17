# Smart Industrial Asset Monitoring & Failure Prediction System

An end-to-end industrial IoT predictive maintenance system implementing perception, edge processing, time-series storage, real-time machine learning inference, and interactive monitoring based on the **AI4I 2020 Predictive Maintenance Dataset**.

---

## Architecture Overview

```text
AI4I 2020 Dataset (10,000 rows)
   ↓ (20 synthetic assets × 500 contiguous observations)
Simulator Layer (simulator/)
   ↓ MQTT (factory/{line}/{asset_id}/telemetry)
Mosquitto Broker (localhost:1883)
   ↓
Edge Processing Layer (edge/)
   ├─ Raw Sensor Value Preservation (5 features)
   ├─ Rolling Moving Average Smoothing (W=5)
   ├─ Demonstration Threshold Anomaly Detection
   ├─ Periodic Aggregation Summaries (10-observation window)
   └─ Sequence Gap & Lifecycle Tracking (ONLINE, DISCONNECTED, EXHAUSTED)
   ↓ MQTT (factory/{line}/{asset_id}/telemetry/processed)
FastAPI Backend & TimescaleDB Storage (backend/)
   ├─ TimescaleDB Hypertables (sensor_telemetry partitioned on timestamp)
   ├─ Frozen 2-Layer GRU Live Predictor (ml/checkpoints/gru_model.pt)
   │  └─ Strict 30 contiguous observations required (sequence gap resets buffer)
   ├─ REST API Endpoints (/health, /assets, /telemetry, /predictions, /alerts)
   └─ Real-Time WebSocket Event Stream (/ws/live)
   ↓
Industrial Monitoring Dashboard (frontend/)
   ├─ React 19 + TypeScript + Vite + Tailwind CSS v4 + Recharts
   ├─ 20-Asset Fleet Overview & Real-Time Telemetry Curves
   ├─ Frozen GRU Failure-Risk Trajectory vs 0.55 Decision Threshold Line
   └─ Edge Diagnostics, Parameter Violations & Sequence Gap Alerts
```

---

## Frozen Machine Learning Contract

- **Model Checkpoint:** `ml/checkpoints/gru_model.pt` (2-layer GRU, hidden size 64, dropout 0.2).
- **Scaler:** `data/processed/scaler.pkl` (StandardScaler fitted strictly on training split).
- **Sensor Inputs (Strict Order):**
  1. `Air temperature [K]`
  2. `Process temperature [K]`
  3. `Rotational speed [rpm]`
  4. `Torque [Nm]`
  5. `Tool wear [min]`
- **Temporal Window:** Exactly 30 contiguous source observations ($X_t \in \mathbb{R}^{30 \times 5}$).
- **Prediction Horizon:** 10 future synthetic observations ($t+1 \dots t+10$).
- **Decision Threshold:** Fixed at $\tau = 0.55$.
- **Strict Quarantine:** Prohibited labels (`Machine failure`, `TWF`, `HDF`, `PWF`, `OSF`, `RNF`, `UDI`, `Product ID`, `Type`) and edge-smoothed values are quarantined from model inference.

---

## Quickstart: Running in Git Bash (Step-by-Step)

To run the complete system manually from Git Bash, open separate terminal windows for each component:

### Terminal 1: Eclipse Mosquitto Broker
```bash
# Start Mosquitto using the project configuration
mosquitto -c mosquitto/mosquitto.conf -v
```

### Terminal 2: FastAPI Backend Server
```bash
# Activate Python environment (if using virtualenv)
# Start backend on port 8000
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

### Terminal 3: Edge Processing Layer
```bash
# Start Edge Processor connecting to local Mosquitto broker
python edge/main.py --broker-host localhost --broker-port 1883
```

### Terminal 4: 20-Asset Industrial Simulator
```bash
# Start simulator emitting continuous telemetry (0.5s tick rate)
python simulator/main.py --broker-host localhost --broker-port 1883 --interval 0.5 --loop
```

### Terminal 5: Real-Time Frontend Dashboard
```bash
# Navigate to frontend directory, install dependencies, and launch Vite dev server
cd frontend
npm install
npm run dev
```

Open your browser to:
- **Dashboard UI:** [http://localhost:3000](http://localhost:3000)
- **FastAPI Interactive Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Service Health Check:** [http://localhost:8000/health](http://localhost:8000/health)

---

## Docker Compose Quickstart

Alternatively, run the entire containerized stack with Docker Compose:

```bash
docker compose up --build
```

---

## Verification & Test Commands

Run the full verification and test suites to validate system integrity:

```bash
# 1. Full regression test suite across all phases (78 tests):
python -m pytest -v

# 2. Standalone Frontend verification script (9 gates):
node frontend/verify_frontend.mjs

# 3. Standalone Backend verification script (10 gates):
python backend/verify_backend.py

# 4. Standalone Edge Processor verification script (10 gates):
python edge/verify_edge.py

# 5. Standalone Simulator verification script (7 gates):
python simulator/verify_simulator.py

# 6. Frozen GRU inference verification suite:
python ml/inference/verify_inference.py
```

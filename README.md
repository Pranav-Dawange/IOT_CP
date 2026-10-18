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
docker compose up --build -d
```

The stack exposes:
- **Frontend Dashboard & Hardware Simulator:** [http://localhost:3000](http://localhost:3000)
- **FastAPI REST API & Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **TimescaleDB Database:** `localhost:5433` (PostgreSQL 16)
- **Mosquitto MQTT Broker:** `localhost:1883`

---

## Hardware Prototype Simulator (v5.0 Academic Edition)

An interactive, realistic hardware digital twin and physical prototype simulator accessible via the **Hardware Prototype Simulator** tab:

### 1. Five Workbench Perspectives
- 🌐 **3D Digital Twin (Three.js / WebGL)**: Interactive 3D physical rig with specular lighting, orbit controls (Rotate, Pan, Zoom), camera presets (Isometric, ESP32 Focus, Motor Focus, Top-Down), 3D flexible curved DuPont wires with traveling signal pulses, spinning 8-notch encoder disc, and stator thermal emission glow.
- 🛠️ **Physical Breadboard Rig**: High-fidelity Fritzing-style hardware prototype featuring:
  - **ESP32 DevKit V1**: Xtensa Dual-Core 240MHz MCU with dual 15-pin headers, EN/BOOT buttons, and Wi-Fi/MQTT status LEDs.
  - **MB102 Power Supply**: Regulated 5.0V / 3.3V dual breadboard power module with latching switch.
  - **Transducers**: Allegro ACS712 (±5A Hall current), LM393 slotted optical tachometer with spinning 8-notch disc, Maxim DS18B20 stainless waterproof stator probe (with physical 4.7kΩ axial pullup resistor), and InvenSense GY-521 MPU-6050 6-DOF IMU.
  - **Actuators & Load**: 1-channel 5V Songle safety relay with EL817 optocoupler, and a 24V DC RS-775 industrial spindle motor with dynamic thermal glow and spinning impeller fan.
  - **Curved DuPont Jumper Wires**: Flexible color-coded wiring with terminal sleeves, traveling signal packets, and bus filters (Power, I2C, ADC, Interrupts, 1-Wire, 24V Motor Circuit).
- 📐 **Circuit Schematic (IEEE Std 315-1975)**: Vector engineering schematic showing net connections, decoupling capacitors, optoisolator barrier, flyback diode, and the **2.1 kVRMS galvanic safety boundary** separating 3.3V/5V logic from the 24V motor circuit.
- 📋 **Academic Pinout & Interconnect Matrix**: Engineering reference table detailing Component, Module Pin, ESP32 GPIO, Protocol, Logic Voltage Domain, Sampling Frequency, Transfer Function, and real-time live readings.
- 💻 **ESP32 FreeRTOS C++ Firmware Viewer**: Production-ready C++ firmware displaying dual-core task affinity (Core 0: ADC polling & EMA noise filter; Core 1: MQTT serialization), `IRAM_ATTR` interrupt handler, and one-click code copy.

### 2. Frequency Domain FFT Spectrum Analyzer (MPU-6050 Vibration)
Comprehensive frequency-domain vibration analysis instrument for mechanical bearing defect identification:
- **Kinematic Fault Harmonics**: Live calculation of characteristic defect frequencies based on motor RPM and bearing geometry (standard RS-775 608ZZ bearing: $Z=8, d=3.967\text{mm}, D_p=20.0\text{mm}$):
  - $\text{BPFI} = \frac{Z}{2} f_r \left(1 + \frac{d}{D_p}\cos\alpha\right)$ (Inner Race Spalling with $f_r$ sidebands)
  - $\text{BPFO} = \frac{Z}{2} f_r \left(1 - \frac{d}{D_p}\cos\alpha\right)$ (Outer Race Fluting & $2\times$ harmonic)
  - $\text{FTF} = \frac{1}{2} f_r \left(1 - \frac{d}{D_p}\cos\alpha\right)$ (Fundamental Train / Cage Defect)
  - $\text{BSF} = \frac{D_p}{2d} f_r \left(1 - \left(\frac{d}{D_p}\cos\alpha\right)^2\right)$ (Ball Spin Defect)
- **Interactive FFT Display**:
  - HTML5 Canvas rendering at 60 FPS with neon glow power spectral density (PSD) curve.
  - Linear ($g$ RMS) and Logarithmic ($\text{dB}$) scale toggles, frequency spans ($200\text{Hz}, 500\text{Hz}, 1000\text{Hz}$).
  - Live cursor frequency tracker HUD and labeled fault marker flags.
- **Dual Domain & Viva Equations**:
  - Time-Domain $a_z(t)$ oscillogram view alongside FFT power spectrum.
  - Interactive Viva Defense equations view substituting active motor parameters in real-time.
  - Web Audio sonic demodulation generating acoustic impact clicks matching the defect frequency.
- **Statistical Condition Metrics**: Live calculation of Crest Factor ($CF = \text{Peak}/\text{RMS}$), Kurtosis ($\beta_2$), and ISO 10816 Zone classification (A/B/C/D).

### 3. Fluke 87V Digital Multimeter (DMM) Tool
Click **Multimeter Tool** to probe 8 physical test points:
- `TP1: 5V_BUS` (+5.02 V DC)
- `TP2: 3V3_MCU` (+3.31 V DC)
- `TP3: ACS712_OUT` (Analog $V_{out} = 2.50\text{V} + 0.066 \times I$)
- `TP4: LM393_D0` (Tachometer frequency in Hz)
- `TP5: DS18B20_DQ` (Dallas 1-Wire voltage & protocol dips)
- `TP6: MPU6050_SDA` (I2C 3.3V Data Bus)
- `TP7: RELAY_IN` (3.3V Normal / 0.0V Cutoff)
- `TP8: MOTOR_24V` (+24.08 V DC Load Circuit)

### 4. Academic Scenario Presets
- 🟢 **Nominal CNC**: Baseline operation (1500 RPM, 38 Nm, 34°C, 1.2g, 15% GRU risk).
- 🟠 **Bearing Degradation**: Tool wear & vibration surge to 3.8g (ISO 10816 Zone C).
- 🛑 **Jammed Rotor Stall & Auto-Cutoff**: Current surges to 4.7A, triggering automatic Songle relay trip within **8.4ms**.
- 🔥 **Thermal Crisis**: Fan failure with stator temperature reaching 45°C.
- 📡 **Wi-Fi Dropout**: Demonstrates edge autonomy with local circular ring buffering.

### 5. Printable Lab Report Generator
Click **Lab Report** to generate an academic engineering document including:
- Document Abstract & System Architecture
- Complete **Bill of Materials (BOM)** with component part numbers and total prototype pricing ($28.40)
- Edge Mathematical Equations & Calibration Parameters
- Live Telemetry Snapshot & PyTorch GRU Risk Score
- Print / PDF export formatting.

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


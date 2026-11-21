# Smart Industrial Asset Monitoring & Failure Prediction System

An end-to-end industrial IoT predictive maintenance system implementing perception, edge processing, time-series storage, real-time machine learning inference, and interactive digital twin monitoring based on the **AI4I 2020 Predictive Maintenance Dataset**.

---

## Architecture Overview

```text
Physical Sensing Layer (Hardware Prototype & Simulator)
   ├─ DHT22: Ambient Air Temperature [K] & Relative Humidity
   ├─ DS18B20: Process Stator Temperature [K] (Dallas 1-Wire)
   ├─ LM393 Optical Slot Sensor: Spindle Rotational Speed [rpm]
   ├─ ACS712-05B Hall Sensor: Armature Current -> Torque [Nm] (k_t = 0.082 N·m/A)
   └─ MPU-6050 6-DOF IMU: Mechanical Vibration Velocity RMS -> Tool Wear [min]
   ↓ (20 synthetic industrial assets × 500 contiguous observations)
Simulator Layer (simulator/) / ESP32 FreeRTOS Microcontroller (firmware/)
   ↓ MQTT Telemetry (factory/{line}/{asset_id}/telemetry)
Eclipse Mosquitto Broker (localhost:1883)
   ↓
Edge Processing Layer (edge/)
   ├─ Raw Sensor Value Preservation (all 5 core features)
   ├─ Rolling Moving Average Smoothing (W=5)
   ├─ Physical Threshold Violation Detection
   ├─ Periodic Aggregation Summaries (10-observation window)
   └─ Sequence Gap & Lifecycle Tracking (ONLINE, DISCONNECTED, EXHAUSTED)
   ↓ MQTT Processed (factory/{line}/{asset_id}/telemetry/processed)
FastAPI Backend & Storage Layer (backend/)
   ├─ TimescaleDB Hypertables / Graceful SQLite Fallback (data/industrial_iot.db)
   ├─ Frozen 2-Layer GRU Live Predictor (ml/checkpoints/gru_model.pt)
   │  └─ Strict 30 contiguous observations required (sequence gap resets buffer)
   ├─ REST API Endpoints (/health, /assets, /telemetry, /predictions, /alerts)
   ├─ Downlink MQTT Actuation Dispatch (factory/{line}/{asset_id}/cmd)
   └─ Real-Time WebSocket Event Stream (/ws/live)
   ↓
Industrial Monitoring Platform (frontend/)
   ├─ React 19 + TypeScript + Vite + Tailwind CSS v4 + Recharts + Lucide Icons
   ├─ 6 Dedicated Studios with URL Hash Routing:
   │  ├─ #fleet: Fleet Command Center (20 assets, live risk, operator actions)
   │  ├─ #twin: 3D WebGL Digital Twin (Three.js rig with all 5 sensors & DMM)
   │  ├─ #wiring: Interactive Breadboard CAD with 9-point Electrical Rule Check (ERC)
   │  ├─ #vibration: ISO 10816 Vibration Spectrum Analyzer & Bearing Kinematics
   │  ├─ #simulator: Parametric What-If Simulator & Stress Testing
   │  └─ #orchestration: End-to-End Cyber-Physical Dataflow & Verification Matrix
   ├─ WebSerial API Hardware Studio: Browser-to-ESP32 flashing and [HW_TELEM] ingestion
   └─ Resilient Error Boundaries & Persona Mode (Operator vs Engineer)
```

---

## 5-Sensor Physical Perception Mapping

To strictly adhere to the AI4I 2020 predictive maintenance contract without data leakage or arbitrary heuristics, the physical perception prototype and simulator map directly to 5 physical sensors:

| AI4I Covariate | Unit | Physical Prototype Sensor | Interface / Protocol | Operating Principle & Physical Conversion |
| :--- | :--- | :--- | :--- | :--- |
| **Air Temperature** ($T_{\text{air}}$) | Kelvin ($\text{K}$) | **DHT22 (AM2302)** | Single-Wire GPIO 19 | Capacitive polymer humidity & NTC thermistor measuring ambient shop floor temperature. Converted as $T_{\text{air}} = T_{\text{celsius}} + 273.15$. |
| **Process Temperature** ($T_{\text{proc}}$) | Kelvin ($\text{K}$) | **DS18B20** | Dallas 1-Wire GPIO 4 | Direct stator thermal coupling with non-blocking 12-bit ADC conversion. Converted as $T_{\text{proc}} = T_{\text{celsius}} + 273.15$. |
| **Rotational Speed** ($\omega$) | $\text{rpm}$ | **LM393 Optical Tachometer** | Hardware Interrupt GPIO 18 | Infrared beam interrupted by an 8-slot optical encoder disc on the spindle shaft. $\text{RPM} = \frac{\Delta\text{pulses}}{8} \times \frac{60}{\Delta t}$. |
| **Torque** ($\tau$) | $\text{N}\cdot\text{m}$ | **ACS712-05B Hall Effect** | Analog ADC1 (GPIO 34) | Measures armature current ($I_{\text{arm}}$). Transformed via the electromechanical motor constant $k_t = 0.082\,\text{N}\cdot\text{m/A}$: $\tau = k_t \cdot (I_{\text{arm}} - I_0)$. |
| **Tool Wear** ($t_{\text{wear}}$) | Minutes ($\text{min}$) | **MPU-6050 6-DOF IMU** | $I^2C$ Bus (GPIO 21/22) | High-frequency vibration velocity RMS ($v_{\text{rms}}$) sampled at 200 Hz across spindle bearing blocks, serving as a mechanical wear accumulation proxy. |

---

## Frozen Machine Learning Contract

- **Model Architecture:** 2-layer Recurrent Neural Network with Gated Recurrent Units (GRU), hidden size 64, dropout 0.2.
- **Model Checkpoint:** `ml/checkpoints/gru_model.pt`
- **Scaler Checkpoint:** `data/processed/scaler.pkl` (StandardScaler fitted strictly on training observations).
- **Mandatory Feature Vector (Strict Order):**
  1. `Air temperature [K]`
  2. `Process temperature [K]`
  3. `Rotational speed [rpm]`
  4. `Torque [Nm]`
  5. `Tool wear [min]`
- **Temporal Window:** Exactly 30 contiguous source observations ($X_t \in \mathbb{R}^{30 \times 5}$).
- **Prediction Horizon:** 10 future synthetic observations ($t+1 \dots t+10$).
- **Decision Threshold:** Fixed at $\tau = 0.55$.
- **Strict Quarantine:** Prohibited labels (`Machine failure`, `TWF`, `HDF`, `PWF`, `OSF`, `RNF`, `UDI`, `Product ID`, `Type`) and edge-smoothed values are quarantined from model inference to prevent ground-truth data leakage.

---

## Getting Started & Execution Modes

The platform supports both **Docker Compose (full production orchestration)** and **Manual Host Execution (zero-dependency native execution with SQLite fallback)**.

---

### Option A: Docker Compose Quickstart (Recommended)

Docker Compose starts all services in containerized isolation:
1. `timescaledb` (PostgreSQL 16 with TimescaleDB time-series extensions)
2. `mosquitto` (Eclipse Mosquitto MQTT Broker)
3. `backend` (FastAPI REST API & WebSocket service)
4. `edge` (Real-time telemetry stream processor)
5. `simulator` (20-asset AI4I factory fleet emulator)
6. `frontend` (Nginx serving compiled React production bundle)

#### 1. Build and Launch
```bash
# Clone the repository and enter the directory
git checkout fix-sensors-and-erc

# Build frontend production assets
cd frontend
npm install
npm run build
cd ..

# Launch all 6 services
docker compose up --build -d
```

The stack exposes:
- **Frontend Dashboard:** [http://localhost:3000](http://localhost:3000)
- **FastAPI REST API & Interactive Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Backend Health Check:** [http://localhost:8000/health](http://localhost:8000/health)
- **TimescaleDB Database:** `localhost:5433` (User: `postgres`, Password: `password`)
- **Mosquitto MQTT Broker:** `localhost:1883`

```bash
# Check service status
docker compose ps

# View unified logs
docker compose logs -f

# Stop all containers
docker compose down
```

---

### Option B: Manual Host Execution (Zero-Dependency Local Run)

For local evaluation without Docker or external database containers, the FastAPI backend automatically activates an embedded SQLite fallback (`sqlite:///./data/industrial_iot.db`).

#### 1. Prerequisites
- **Python 3.9+** and `pip`
- **Node.js 18+** and `npm`
- **Eclipse Mosquitto Broker** (Optional for full MQTT streaming; the backend runs standalone for UI and What-If simulation).

#### 2. Environment Setup
```bash
# Set up Python virtual environment
python -m venv venv

# Activate virtual environment
# Windows (PowerShell):
.\venv\Scripts\Activate.ps1
# macOS / Linux:
source venv/bin/activate

# Install Python requirements
pip install -r requirements.txt

# Create local environment configuration
cp .env.example .env
```

#### 3. Start Components

##### Terminal 1: Eclipse Mosquitto Broker (Optional for MQTT)
```bash
mosquitto -c mosquitto/mosquitto.conf -v
```

##### Terminal 2: FastAPI Backend Server
```bash
# Automatically initializes tables in SQLite or PostgreSQL
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

##### Terminal 3: Edge Processing Layer (Optional for live MQTT)
```bash
python edge/main.py --broker-host localhost --broker-port 1883
```

##### Terminal 4: 20-Asset Industrial Simulator (Optional for live MQTT)
```bash
python simulator/main.py --all --broker-host localhost --broker-port 1883 --interval-ms 500 --loop
```

##### Terminal 5: Frontend Dashboard
```bash
cd frontend
npm install
npm run dev
```

Open your browser to:
- **Interactive UI:** [http://localhost:3000](http://localhost:3000)
- **FastAPI Interactive Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Health Diagnostics:** [http://localhost:8000/health](http://localhost:8000/health)

---

## Application Studios & Monitoring Workbenches

The frontend is organized into 6 dedicated studios with browser hash routing:

### 1. Fleet Command Center (`#fleet`)
- **20-Asset Multi-Line Fleet Grid**: Overview across Production Lines A–D with status flags (`NOMINAL`, `WARNING`, `CRITICAL`, `OFFLINE`).
- **5-Sensor Telemetry Streams**: Real-time display of Air Temp, Process Temp, RPM, Torque, and Tool Wear.
- **Frozen GRU Inference Trajectory**: 10-step predictive horizon curve plotted against the $\tau = 0.55$ decision line.
- **Closed-Loop Operator Sandbox**: Dispatch maintenance, acknowledge active alerts, reset sequence buffers, or trigger an emergency stop via downlink MQTT actuation.
- **Persona Modes**: Operator mode (glanceable KPIs) vs. Engineer mode (raw buffers, sequence numbers, and transfer metrics).

### 2. 3D Digital Twin Studio & Hardware Lab (`#twin`)
- **Interactive WebGL Twin (Three.js)**: 3D rendered motor rig with orbit controls, realistic specular highlights, stator thermal radiation, and spinning 8-notch encoder disc.
- **5 Physical Sensors Visualized**:
  - DHT22 perforated ambient sensor on breadboard rail
  - DS18B20 stainless-steel thermal probe attached to motor stator
  - LM393 optical tachometer straddling shaft encoder disc
  - ACS712 current transducer inline with DC power
  - MPU-6050 vibration IMU mounted on bearing housing
- **Fluke 87V Digital Multimeter (DMM)**: Probe 9 physical electrical test points with live voltage, frequency, and signal verification.
- **Pinout Matrix & FreeRTOS Firmware**: View the complete hardware schematic, pin assignments, logic levels, and dual-core FreeRTOS C++ firmware.

### 3. Interactive Breadboard CAD & Electrical Rule Check (`#wiring`)
- **DuPont Wire Routing Canvas**: Interactive wire drawing with 28 breadboard tie-points and 8-color jumper palette.
- **9-Point Electrical Rule Check (ERC) Engine**:
  1. `erc_short_5v_gnd`: +5V power rail short circuit protection
  2. `erc_short_3v3_gnd`: +3.3V logic supply short circuit protection
  3. `erc_overvoltage_24v`: +24V motor bus isolation from low-voltage GPIOs
  4. `erc_i2c_bus`: MPU-6050 SDA/SCL pull-up & line continuity
  5. `erc_onewire_pullup`: DS18B20 DQ 4.7kΩ pull-up resistor integrity
  6. `erc_tachometer_net`: LM393 D0 pulse output to interrupt GPIO 18
  7. `erc_acs712_current`: ACS712 OUT analog feed to ADC1 GPIO 34
  8. `erc_relay_control`: Songle safety cut-off relay control line on GPIO 26
  9. `erc_dht22_ambient`: DHT22 Data pin 10kΩ pull-up resistor and GPIO 19 interconnect
- **Diagnostic Verification Modal**: Generates an engineering verification certificate with pass/warn/fail status and remediation advice.

### 4. Vibration Spectrum Analyzer (`#vibration`)
- **Kinematic Fault Harmonics**: Live calculation of characteristic defect frequencies for RS-775 608ZZ bearings ($Z=8, d=3.967\text{mm}, D_p=20.0\text{mm}$):
  - $\text{BPFI} = \frac{Z}{2} f_r \left(1 + \frac{d}{D_p}\cos\alpha\right)$ (Inner Race Spalling)
  - $\text{BPFO} = \frac{Z}{2} f_r \left(1 - \frac{d}{D_p}\cos\alpha\right)$ (Outer Race Fluting)
  - $\text{FTF} = \frac{1}{2} f_r \left(1 - \frac{d}{D_p}\cos\alpha\right)$ (Cage Defect)
  - $\text{BSF} = \frac{D_p}{2d} f_r \left(1 - \left(\frac{d}{D_p}\cos\alpha\right)^2\right)$ (Ball Spin Defect)
- **60 FPS HTML5 Canvas FFT**: Real-time power spectral density (PSD) with $g$ RMS and $\text{dB}$ scale toggles, cursor tracking HUD, and ISO 10816 Zone classification (A/B/C/D).
- **Acoustic Demodulation**: Web Audio synthesis generating audible impact clicks matching bearing fault impact rates.

### 5. Parametric What-If Simulator (`#simulator`)
- **Interactive Slider Inference**: Adjust Air Temp, Process Temp, RPM, Torque, and Tool Wear in real-time to observe immediate GRU inference and risk classification.
- **Physical Derivations**: Computes mechanical power $P = \tau \cdot \omega = \tau \cdot \frac{2\pi \cdot \text{RPM}}{60}$ and temperature differential $\Delta T = T_{\text{proc}} - T_{\text{air}}$.
- **Stress-Test Presets**: Instant simulation of Spindle Stall, Thermal Runaway, Bearing Fluting, and Nominal CNC machining.

### 6. System Orchestration Flow (`#orchestration`)
- **Cyber-Physical Dataflow Visualization**: Full visual architecture mapping the perception layer, FreeRTOS edge tasks, MQTT brokers, TimescaleDB, frozen GRU inference, and downlink actuation.
- **Verification Matrix**: Interactive checklist detailing all subsystem tests, protocols, and pass criteria.

### 7. WebSerial API Hardware Studio
Direct browser-to-ESP32 interface using Chrome's native **WebSerial API** (`navigator.serial`):
- Connects to physical ESP32 DevKit boards via USB (CP2102, CH340, FT232R) at 115200–921600 baud.
- Bidirectional serial terminal with macros (`PING`, `GET_SYS_INFO`, `TRIP_RELAY`, `REBOOT`).
- Ingests `[HW_TELEM]` serial frames directly into the live dashboard and digital twin.
- Flashing partition inspector displaying bootloader, partition table, and firmware maps.

---

## Verification & Test Commands

Run the full verification suite to validate the system across all layers:

```bash
# 1. Automated integration and interaction test suite:
python -m pytest tests/test_interactions.py -v

# 2. Frontend production build verification:
cd frontend
npm run build
cd ..

# 3. Backend service verification:
python backend/verify_backend.py

# 4. Edge stream processor verification:
python edge/verify_edge.py

# 5. Simulator verification:
python simulator/verify_simulator.py

# 6. Frozen GRU model & inference verification:
python ml/inference/verify_inference.py
```

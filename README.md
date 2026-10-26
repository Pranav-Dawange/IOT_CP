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
Industrial Monitoring Platform (frontend/)
   ├─ React 19 + TypeScript + Vite + Tailwind CSS v4 + Recharts + Lucide Icons
   ├─ Glassmorphism Design System with backdrop blur & reactive glow shaders
   ├─ 5 Dedicated Webpages with URL Hash Routing (#fleet, #twin, #wiring, #vibration, #simulator)
   ├─ Operator / Engineer Persona Modes (simplified glanceable vs. full diagnostic telemetry)
   ├─ What-If Scenario Sandbox for interactive parametric risk simulation
   ├─ Real-Time WebSocket Alerts Feed with unread badge tracking & silent edge updates
   ├─ Resilient Error Boundaries isolating workbench views against runtime failures
   └─ Frozen GRU Failure-Risk Trajectory vs 0.55 Decision Threshold Line
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

## Getting Started & Execution Modes

You can run the system using either **Docker Compose (Recommended - all 6 services orchestrated together)** or **Manually via Git Bash / Terminal (running each component step-by-step)**.

---

### Option A: Docker Compose Quickstart (Recommended)

Docker Compose starts all 6 components (Mosquitto MQTT Broker, TimescaleDB, FastAPI Backend, Edge Stream Processor, 20-Asset Simulator, and Frontend UI) in containerized isolation with zero manual networking configuration.

#### Prerequisites
- **Docker Desktop** or **OrbStack** installed and running on your system.

#### 1. Build Frontend Static Assets (for Nginx volume mount)
```bash
cd frontend
npm install
npm run build
cd ..
```

#### 2. Launch the Stack
```bash
docker compose up --build -d
```

The stack exposes:
- **Frontend Dashboard & 3D Digital Twin:** [http://localhost:3000](http://localhost:3000)
- **FastAPI REST API & Interactive Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Service Health Check:** [http://localhost:8000/health](http://localhost:8000/health)
- **TimescaleDB Database:** `localhost:5433` (PostgreSQL 16)
- **Mosquitto MQTT Broker:** `localhost:1883`

#### Useful Docker Management Commands
```bash
# View live logs across all containers
docker compose logs -f

# View live logs for a specific service (e.g. backend predictions or simulator)
docker compose logs -f backend
docker compose logs -f simulator

# Check container health and status
docker compose ps

# Stop the entire stack
docker compose down
```

---

### Option B: Manual Host Execution (Step-by-Step)

If you prefer running components directly on your host machine without Docker:

#### 1. System Prerequisites
- **Python 3.9+** and **pip**
- **Node.js 18+** and **npm**
- **Eclipse Mosquitto MQTT Broker:**
  - **macOS (Homebrew):**
    ```bash
    brew install mosquitto
    ```
    *(Note: On Apple Silicon Macs, Homebrew places the server binary in `/opt/homebrew/sbin/mosquitto`)*
  - **Linux (Ubuntu/Debian):**
    ```bash
    sudo apt update && sudo apt install -y mosquitto mosquitto-clients
    ```
  - **Windows:** Download the official installer from [mosquitto.org](https://mosquitto.org/download/).

#### 2. Install Python Dependencies
```bash
# Create and activate a Python virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows (Git Bash): source .venv/Scripts/activate

# Install all required Python dependencies
pip install -r requirements.txt
```

#### 3. Start Each Component in a Separate Terminal Window:

##### Terminal 1: Eclipse Mosquitto Broker
```bash
# macOS (Homebrew default location):
/opt/homebrew/sbin/mosquitto -c mosquitto/mosquitto.conf -v

# Linux / Windows (or if mosquitto is in your PATH):
mosquitto -c mosquitto/mosquitto.conf -v
```

##### Terminal 2: FastAPI Backend Server
The backend supports both SQLite (zero-config, immediate setup) and PostgreSQL/TimescaleDB:
```bash
# Activate Python environment
source .venv/bin/activate

# Run with local SQLite database (Recommended for quick local testing without PostgreSQL):
DATABASE_URL="sqlite:///./data/industrial_iot.db" python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000

# Or run with PostgreSQL/TimescaleDB (if PostgreSQL is running on port 5432):
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

##### Terminal 3: Edge Processing Layer
```bash
# Activate Python environment
source .venv/bin/activate

# Start Edge Processor connecting to local Mosquitto broker
python edge/main.py --broker-host localhost --broker-port 1883
```

##### Terminal 4: 20-Asset Industrial Simulator
```bash
# Activate Python environment
source .venv/bin/activate

# Start simulator emitting continuous telemetry for all 20 assets (500ms tick rate)
python simulator/main.py --all --broker-host localhost --broker-port 1883 --interval-ms 500 --loop
```

##### Terminal 5: Real-Time Frontend Dashboard
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

## Application Studios & Monitoring Workbenches

The platform is organized into 5 dedicated, full-width studios accessible directly via the top navigation bar or browser hash routes (`#fleet`, `#twin`, `#wiring`, `#vibration`, `#simulator`):

### 1. Fleet Command Dashboard (`#fleet`)
- **Fleet Grid & Quick Filtering**: Real-time overview of all 20 industrial CNC machines with status indicators (Nominal, Warning, Critical, Offline), tool wear progression, and instant machine selection.
- **Parametric Telemetry Telemetry**: Live sensor trends (Air Temp, Process Temp, RPM, Torque, Tool Wear) with glowing area gradient shaders.
- **Frozen GRU Failure-Risk Trajectory**: Horizon forecast plotting against the calibrated $\tau = 0.55$ decision boundary.
- **Edge Alerts Drawer**: Filterable live drawer detailing machine alerts, timestamps, severity tags, and parameter violation metrics, automatically clearing unread count when reviewed.
- **Persona Modes**: Operator mode (focused on high-level status & action items) and Engineer mode (unveils deep raw metrics, sequence buffers, and transfer calculations).

### 2. 3D Digital Twin Studio & Hardware Lab (`#twin`)
- **3D Digital Twin (Three.js / WebGL)**: Interactive 3D physical rig with specular lighting, orbit controls (Rotate, Pan, Zoom), camera presets (Isometric, ESP32 Focus, Motor Focus, Top-Down), 3D flexible curved DuPont wires with traveling signal pulses, spinning 8-notch encoder disc, and stator thermal emission glow.
- **Physical Breadboard Rig**: High-fidelity Fritzing-style hardware prototype featuring ESP32 DevKit V1, MB102 Power Supply, ACS712 current transducer, LM393 optical tachometer, DS18B20 stator probe, Songle safety relay, and 24V RS-775 spindle motor.
- **Fluke 87V Digital Multimeter (DMM)**: Interactive test-point probing across 8 electrical test points with live voltage, frequency, and protocol signal dip verification.
- **Academic Pinout & Interconnect Matrix**: Engineering reference table detailing Component, Module Pin, ESP32 GPIO, Protocol, Logic Voltage Domain, Sampling Frequency, and Transfer Function.
- **ESP32 FreeRTOS C++ Firmware Viewer**: Dual-core FreeRTOS production C++ firmware with one-click clipboard copy.

### 3. Interactive Breadboard Wiring Studio (`#wiring`)
- **Drag & Drop DuPont Wiring CAD**: Hands-on virtual breadboard wiring with 28 interactive tie-points, cubic bezier routing, and 8-color palette selection.
- **Real-Time Electrical Rule Check (ERC) Diagnostics**: Automated detection of short circuits (+5V/+3.3V to GND), 24V high-voltage gate destruction, inverted $I^2C$ bus lines (SDA/SCL swapped), and floating DS18B20 1-Wire pullup resistors.
- **Viva Defense Scenario Presets**: Instant configuration presets (Nominal, Short Circuit, Inverted I2C, 24V Overvoltage) for academic demonstrations.

### 4. Vibration Spectrum Analyzer (`#vibration`)
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

### 3. Firmware Flasher Integration & Live Telemetry Stream (WebSerial API)
Direct browser-to-ESP32 hardware interface using Chrome's native **WebSerial API** (`navigator.serial`):
- **Physical USB Serial Connectivity**: Direct serial link to physical ESP32 DevKit boards supporting CP2102, CH340, FT232R, and Espressif USB-JTAG bridges at selectable baud rates (115200, 230400, 921600 baud).
- **Interactive Bidirectional Terminal**: Serial command line with automatic timestamping, ANSI color formatting, macro shortcuts (`PING`, `GET_SYS_INFO`, `TRIP_RELAY`, `REBOOT`, `DUMP_HEAP`), and auto-scroll control.
- **Live Hardware Telemetry Ingestion**: Automatically detects `[HW_TELEM]` stream frames from connected physical sensors (RPM, Current, Temperature, Vibration RMS) and feeds them directly into the frontend dashboard, driving the digital twin and PyTorch GRU failure-risk model from real hardware.
- **ESP32 Bootloader & Flash Partition Map**: 4MB QSPI flash memory map inspector displaying `bootloader.bin` (0x1000), `partitions.bin` (0x8000), `firmware_ai4i.bin` (0x10000), and `spiffs_certs.bin` (0x310000) with simulated binary flashing progress.
- **Virtual Loopback Demo Mode**: Allows testing full flasher and telemetry stream capabilities even without a physical microcontroller plugged in.

### 4. Custom Circuit Breadboard Wire Drag-and-Drop & Electrical Rule Check (ERC)
Interactive engineering CAD workbench allowing students and engineers to test breadboard wiring configurations:
- **Interactive Wire Routing**: Drag-and-drop wire drawing between 28 individual breadboard tie-points across the ESP32, MB102 power module, ACS712 current sensor, LM393 tachometer, DS18B20 temperature probe, MPU-6050 IMU, Songle relay, and RS-775 motor.
- **Color Palette & Wire Management**: 8-color DuPont jumper palette (Blue, Orange, Red, Cyan, Yellow, Green, Purple, Pink, Dark) with click-to-select, wire length calculation, and one-click deletion.
- **Real-Time Electrical Rule Check (ERC) Diagnostics**:
  - **Short Circuit Detection**: Alerts if +5V or +3.3V is connected directly to GND, simulating MB102 thermal shutdown.
  - **Overvoltage Destruction**: Alerts if the +24V motor bus is shorted to a 3.3V ESP32 GPIO, warning of silicon gate oxide breakdown.
  - **I2C Bus Inversion**: Detects swapped SDA and SCL lines resulting in $I^2C$ `NACK` errors on address `0x68`.
  - **Missing 1-Wire Pullup Resistor**: Flags missing 4.7kΩ pullup on DS18B20 data line ($DQ$), explaining bus float in viva defense terms.
  - **Floating Inputs**: Notifies when sensor outputs are left unconnected.
- **Viva Defense Presets**: One-click scenario buttons to demonstrate Nominal Wiring, Short Circuit, Inverted $I^2C$, and 24V HV Injection during examinations.

### 5. Fleet Load & Stress Test Laboratory (`#simulator`)
- **20-Asset Replay Matrix**: Synchronized grid monitoring all 20 machines streaming AI4I 2020 dataset slices across production lines (Line 1 to Line 4).
- **Interactive Fault Injection Engine**: Inject high thermal loads, rapid tool wear surges, or torque spikes directly into running virtual telemetry.
- **Stress-Test Scenarios**: Execute edge parameter violation drills to test real-time threshold tripping and GRU predictive failure-risk escalation.

### 6. Fluke 87V Digital Multimeter (DMM) Tool
Click **Multimeter Tool** to probe 8 physical test points:
- `TP1: 5V_BUS` (+5.02 V DC)
- `TP2: 3V3_MCU` (+3.31 V DC)
- `TP3: ACS712_OUT` (Analog $V_{out} = 2.50\text{V} + 0.066 \times I$)
- `TP4: LM393_D0` (Tachometer frequency in Hz)
- `TP5: DS18B20_DQ` (Dallas 1-Wire voltage & protocol dips)
- `TP6: MPU6050_SDA` (I2C 3.3V Data Bus)
- `TP7: RELAY_IN` (3.3V Normal / 0.0V Cutoff)
- `TP8: MOTOR_24V` (+24.08 V DC Load Circuit)

### 7. Academic Scenario Presets
- 🟢 **Nominal CNC**: Baseline operation (1500 RPM, 38 Nm, 34°C, 1.2g, 15% GRU risk).
- 🟠 **Bearing Degradation**: Tool wear & vibration surge to 3.8g (ISO 10816 Zone C).
- 🛑 **Jammed Rotor Stall & Auto-Cutoff**: Current surges to 4.7A, triggering automatic Songle relay trip within **8.4ms**.
- 🔥 **Thermal Crisis**: Fan failure with stator temperature reaching 45°C.
- 📡 **Wi-Fi Dropout**: Demonstrates edge autonomy with local circular ring buffering.

### 8. Printable Lab Report Generator
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


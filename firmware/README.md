# ESP32 Dual-Core FreeRTOS Edge Firmware

Production C++ FreeRTOS firmware running on the ESP-WROOM-32 DevKit V1 microcontroller for cyber-physical milling spindle monitoring, real-time EMA filtering, and automated safety cutoff.

---

## 1. Hardware Pinout Allocation Matrix

| Component | Part / Model | ESP32 GPIO | Bus / Interface | Signal Description |
|:---|:---|:---|:---|:---|
| **Current Sensor** | ACS712-30A | **GPIO 34** | ADC1_CH6 | 12-bit Analog voltage via 10k/15k divider (ratio 0.60) |
| **Spindle Tachometer** | LM393 IR Comparator | **GPIO 18** | External Interrupt | Optical slotted interrupter with 8-slot encoder disc |
| **Process Temp** | DS18B20 Waterproof | **GPIO 4** | 1-Wire Single Bus | Stator casing thermal probe (4.7kΩ pullup) |
| **Ambient Temp** | DHT22 (AM2302) | **GPIO 19** | Single-Bus Digital | Ambient room temperature and RH (10kΩ pullup) |
| **Safety Cutoff** | Songle 5V Relay | **GPIO 26** | Digital Output | Optoisolated coil driver (Active-LOW safety trip) |
| **Local OLED Display** | SSD1306 128x64 | **GPIO 21 / 22** | I2C (SDA/SCL) | 0x3C address for live metric display |
| **Vibration Transducer**| MPU-6050 6-DOF | **GPIO 21 / 22** | I2C (SDA/SCL) | 0x68 address for 3-axis vibration FFT |

---

## 2. Multi-Core FreeRTOS Concurrency Architecture

- **Core 0 — High-Frequency Sensor Task (`TaskSensorAcquisition`)**:
  - Pinned priority 2 task running at **100 Hz** (10ms tick).
  - Samples ADC1 Channel 6 with 11dB attenuation.
  - Computes Exponential Moving Average (`EMA_ALPHA = 0.30`).
  - Evaluates hardware threshold ($I > 4.50\text{ A}$) and trips the Songle relay in **$< 10\text{ ms}$**.
- **Core 1 — Telemetry & MQTT Streaming (`TaskMqttStreaming`)**:
  - Pinned priority 1 task running at **1 Hz**.
  - Reads pulse counter atomically with FreeRTOS `portENTER_CRITICAL`.
  - Non-blocking thermal sampling with `setWaitForConversion(false)`.
  - Publishes full 5-sensor contract telemetry to `factory/line_A/asset_01/telemetry`.
  - Subscribes to `factory/line_A/asset_01/cmd` for bidirectional downlink actuation (`EMERGENCY_STOP`, `RESUME`, `RESET_BUFFER`).

---

## 3. Required Arduino Libraries

Install the following libraries via the Arduino Library Manager:
- `PubSubClient` by Nick O'Leary (v2.8+)
- `ArduinoJson` by Benoit Blanchon (v6.21+)
- `DallasTemperature` by Miles Burton (v3.9+)
- `OneWire` by Paul Stoffregen (v2.3+)
- `DHT sensor library` by Adafruit (v1.4+)
- `Adafruit SSD1306` & `Adafruit GFX Library` (v2.5+)

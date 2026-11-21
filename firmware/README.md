# ESP32 Dual-Core FreeRTOS Edge Node Firmware

Target Platform: **ESP-WROOM-32 DevKit V1** (240MHz Xtensa LX6 Dual-Core)  
Framework: **Arduino-ESP32 / FreeRTOS Kernel v10.4**

---

## 1. Hardware Interconnect Matrix

| Peripheral Module | Transducer IC | Interface | ESP32 Pin | Signal Conditioning & Electrical Parameters |
|:---|:---|:---|:---|:---|
| **Armature Current** | ACS712-30A | ADC1_CH6 | **GPIO 34** | $10\text{ k}\Omega / 15\text{ k}\Omega$ resistive divider ($R_{\text{ratio}} = 0.60$); 12-bit ADC |
| **Spindle Tachometer** | LM393 Optical IR | Ext Interrupt | **GPIO 18** | Hardware `RISING` edge interrupt on 8-slot optical encoder disc |
| **Stator Temperature** | DS18B20 Probe | Dallas 1-Wire | **GPIO 4** | $4.7\text{ k}\Omega$ bus pull-up resistor; non-blocking conversion mode |
| **Ambient Temp & RH** | DHT22 (AM2302) | Single-Bus | **GPIO 19** | $10\text{ k}\Omega$ pull-up resistor; digital pulse-width timing |
| **Vibration Transducer**| MPU-6050 6-DOF | I2C (0x68) | **GPIO 21 (SDA), GPIO 22 (SCL)** | $\pm 2\text{g}$ dynamic range; 3-axis RMS acceleration vector |
| **Local Status OLED** | SSD1306 128x64 | I2C (0x3C) | **GPIO 21 (SDA), GPIO 22 (SCL)** | Shared I2C hardware bus with MPU-6050 |
| **Emergency Cutoff** | Songle 5V Relay | Digital Out | **GPIO 26** | Active-LOW optoisolated transistor driver with flyback diode |

---

## 2. Multi-Core Concurrency & Scheduling Architecture

```
                  ┌──────────────────────────────────────────────┐
                  │          ESP-WROOM-32 (Dual-Core)             │
                  └───────┬──────────────────────────────┬───────┘
                          │                              │
         CORE 0 (100 Hz RT Task)                CORE 1 (1 Hz Telemetry)
         ┌────────────────────────┐             ┌────────────────────────┐
         │ - ACS712 ADC Sampling  │             │ - Spindle RPM Calc     │
         │ - EMA Filter (alpha=0.3)│             │ - Torque Calculation   │
         │ - Fast Cutoff (<10 ms) │             │ - DS18B20 & DHT22 Read │
         │   Trigger if I > 4.5A  │             │ - MPU-6050 RMS Accel   │
         └───────────┬────────────┘             │ - WebSerial Stream     │
                     │                          │ - MQTT JSON Publish    │
             Shared State (Atomic               └───────────┬────────────┘
             Spinlock portMUX)                              │
                     │                                      │
              [Relay Cutoff]                      [Local USB & WiFi/MQTT]
```

### Core 0 — Real-Time Signal Acquisition (`TaskSensorAcquisition`)
- **Execution Rate**: 100 Hz (10 ms period using `vTaskDelayUntil`).
- **Priority**: 2 (Higher priority than network transport).
- **Function**: Reconstructs analog voltage from the resistive divider, applies an Exponential Moving Average (EMA) filter ($\alpha = 0.30$), and trips the Songle safety relay in $< 10\text{ ms}$ if current exceeds $4.50\text{ A}$.

### Core 1 — Communication & Serialization (`TaskMqttStreaming`)
- **Execution Rate**: 1.0 Hz (1000 ms period).
- **Priority**: 1.
- **Function**: Atomically resets the interrupt pulse counter within an enter/exit critical section, calculates spindle RPM and shaft torque (accounting for motor no-load current offset $I_0 = 0.35\text{ A}$), queries non-blocking thermal and vibration sensors, prints telemetry to the USB serial bus, and publishes JSON packets to the MQTT broker.

---

## 3. Communication Protocols

### Local USB WebSerial Frame Format
Emitted at 115200 baud, 8N1 over USB UART for direct frontend dashboard integration:
```text
[HW_TELEM] RPM=1680.0 CURR=1.85 TEMP=34.2 VIB=1.22 AIR_TEMP=25.0 RELAY=1
```

### Downlink MQTT Command Dispatch
Subscribed topic: `factory/line_A/asset_01/cmd`
```json
{
  "command": "EMERGENCY_STOP"
}
```
Supported commands:
- `EMERGENCY_STOP` / `TRIP_RELAY`: Opens relay to isolate the motor circuit.
- `RESUME`: Re-arms the safety relay.
- `RESET_BUFFER`: Clears accumulated operational wear counter.

---

## 4. Software Dependencies

Required Arduino IDE / PlatformIO libraries:
- `PubSubClient` by Nick O'Leary (>= 2.8)
- `ArduinoJson` by Benoit Blanchon (>= 6.21)
- `DallasTemperature` by Miles Burton (>= 3.9)
- `OneWire` by Paul Stoffregen (>= 2.3)
- `DHT sensor library` by Adafruit (>= 1.4)
- `Adafruit SSD1306` & `Adafruit GFX` (>= 2.5)

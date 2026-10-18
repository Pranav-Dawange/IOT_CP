/**
 * MachinePrototypeSimulator.tsx  —  ULTRA-ENHANCED v5.0 ACADEMIC & INDUSTRIAL EDITION
 *
 * Designed for academic defence, engineering vivas, and industrial IoT demonstrations:
 *
 * 1. FOUR WORKBENCH VIEWS:
 *    - 🛠️ Breadboard Rig: High-fidelity Fritzing-style layout with Dupont wires, axial 4.7kΩ resistor, MB102 power supply, spinning 8-notch encoder disc, and stator clamp.
 *    - 📐 Circuit Schematic: True vector IEEE/IEC circuit diagram with component symbols, decoupling capacitors, pullups, optocoupler, relay driver transistor, flyback diode & 24V isolation boundary.
 *    - 📋 Pinout & Wiring Matrix: Academic matrix with GPIO allocations, logic domains, sampling rates, transfer functions, and live signals.
 *    - 💻 ESP32 FreeRTOS Firmware: Full syntax-highlighted C++ source code with FreeRTOS dual-core tasks, IRAM interrupt handler, EMA filter, and MQTT payload serialization.
 *
 * 2. VIRTUAL DIGITAL MULTIMETER (FLUKE 87V STYLE):
 *    - 8 Interactive test points across the board (TP1..TP8).
 *    - DC V, AC mV ripple, frequency (Hz), and continuity modes with digital LCD readout, analog bar graph, and Min/Max capture.
 *
 * 3. ACADEMIC SCENARIO PRESETS:
 *    - Nominal Baseline, Bearing Degradation (ISO 10816), Jammed Rotor Stall & Auto-Trip, Thermal Runaway, and Wi-Fi Dropout.
 *
 * 4. ONE-CLICK LAB REPORT GENERATOR:
 *    - Formatted academic engineering report with Bill of Materials (BOM), circuit schematics, mathematical calibration formulas, telemetry snapshot, and printable layout.
 *
 * 5. REAL-TIME INSTRUMENTATION:
 *    - 4-Channel Virtual Logic Analyzer / Oscilloscope
 *    - ESP32 UART Serial Terminal (115200 baud)
 *    - MQTT Protocol Inspector with live JSON payload tree
 *    - Green-IoT Carbon ROI & UN SDG Metric Dashboard
 *    - Web Audio realistic motor PWM hum and mechanical relay contact click SFX
 *    - Guided 8-Slide Academic Presentation Mode
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertOctagon, AlertTriangle, ArrowRight, Binary, Boxes, Camera,
  CheckCircle2, ChevronLeft, ChevronRight, Code2, Copy, Cpu, Crosshair,
  Download, Eye, FileDown, FileText, Flame, Gauge, HelpCircle,
  Info, Layers, Leaf, MonitorSpeaker, MousePointer, Play, Power,
  Printer, Radio, RefreshCw, RotateCw, ShieldAlert, Sliders,
  Sparkles, Terminal, Thermometer, Usb, Volume2, VolumeX, Waves, Wifi, WifiOff,
  Wrench, X, Zap, ZoomIn
} from 'lucide-react';
import { Asset } from '../types';
import { MachinePrototype3D } from './MachinePrototype3D';
import { VibrationSpectrumAnalyzer } from './VibrationSpectrumAnalyzer';
import { WebSerialFlasher } from './WebSerialFlasher';
import { InteractiveBreadboardWiring } from './InteractiveBreadboardWiring';

// ─── INTERFACES ─────────────────────────────────────────────────────────────
interface MachineSimulatorProps {
  assets: Asset[];
  onInjectFault?: (assetId: string, faultType: string) => void;
}

interface SerialLog {
  id: number;
  time: string;
  type: 'INFO' | 'WARN' | 'ERROR' | 'MQTT' | 'ADC' | 'EDGE' | 'CUTOFF';
  text: string;
}

interface ComponentDetail {
  id: string;
  name: string;
  partNumber: string;
  category: 'MCU' | 'SENSOR' | 'ACTUATOR' | 'DISPLAY' | 'LOAD' | 'POWER';
  measuredMetric: string;
  pinout: { pin: string; target: string; color: string; desc: string; voltage: string }[];
  principle: string;
  formula: string;
  calibratedValue: (t: any) => string;
  voltage: string;
  specs: { label: string; value: string }[];
  scopeWaveform: 'sine' | 'pulse' | 'square' | 'flat' | 'pwm' | 'onewire';
  ledColor: string;
}

interface TestPoint {
  id: string;
  label: string;
  name: string;
  x: number;
  y: number;
  voltage: (t: any, power: boolean, tripped: boolean) => number;
  unit: string;
  freq?: (t: any) => number;
  domain: 'LOGIC 3.3V' | 'POWER 5V' | 'ANALOG' | 'INTERRUPT' | 'MOTOR 24V';
}

// ─── COMPONENT CATALOG & ACADEMIC DATA ──────────────────────────────────────
const COMPONENT_DETAILS: Record<string, ComponentDetail> = {
  esp32: {
    id: 'esp32',
    name: 'ESP32 DevKit V1 Microcontroller',
    partNumber: 'ESP-WROOM-32 (Xtensa Dual-Core 240MHz, 520KB SRAM)',
    category: 'MCU',
    measuredMetric: 'Edge Preprocessing, EMA Noise Filtration & MQTT Transport',
    pinout: [
      { pin: 'GPIO 21', target: 'OLED & MPU6050 SDA', color: '#38bdf8', desc: 'I2C Serial Data Bus (400kHz Fast Mode)', voltage: '3.3V' },
      { pin: 'GPIO 22', target: 'OLED & MPU6050 SCL', color: '#eab308', desc: 'I2C Serial Clock Bus (400kHz)', voltage: '3.3V' },
      { pin: 'GPIO 34', target: 'ACS712 VOUT', color: '#22c55e', desc: 'ADC1_CH6 (12-bit, 11dB Attenuation)', voltage: '0-3.3V' },
      { pin: 'GPIO 18', target: 'LM393 D0', color: '#f97316', desc: 'Optical Tachometer Interrupt (IRAM ISR)', voltage: '3.3V' },
      { pin: 'GPIO 4', target: 'DS18B20 DQ', color: '#a855f7', desc: 'Dallas 1-Wire Stator Temp (4.7kΩ Pull-Up)', voltage: '3.3V' },
      { pin: 'GPIO 26', target: 'Relay IN', color: '#f8fafc', desc: 'Active-LOW Emergency Neural Cutoff', voltage: '3.3V' },
      { pin: '5V (VIN)', target: 'MB102 5V Rail', color: '#ef4444', desc: 'Main Regulated 5.0V Power Input', voltage: '5.0V' },
      { pin: 'GND', target: 'Common GND Rail', color: '#1e293b', desc: 'System Ground Return Plane', voltage: '0.0V' },
    ],
    principle: 'Dual-core 32-bit MCU running FreeRTOS tasks with task affinity: Core 0 executes high-frequency ADC polling, exponential moving average (EMA α=0.30) noise filtration, and SSD1306 framebuffer generation. Core 1 manages TLS Wi-Fi network stacks, sequence numbering, and MQTT publication to Mosquitto broker at 1.0 Hz.',
    formula: 'S_t = α·Y_t + (1−α)·S_{t-1}   where α = 0.30 (EMA Noise Filter)',
    calibratedValue: () => 'FreeRTOS Core 0/1 Active · 184 KB Heap Free',
    voltage: '3.3V Logic / 5V VIN',
    specs: [
      { label: 'Processor', value: 'Tensilica Xtensa Dual-Core LX6 @ 240 MHz' },
      { label: 'SRAM / Flash', value: '520 KB SRAM / 4 MB SPI Flash Memory' },
      { label: 'ADC Resolution', value: '12-bit (0 - 4095 counts, ~0.8mV/step)' },
      { label: 'Wireless Stack', value: 'Wi-Fi 802.11 b/g/n (2.4GHz) & BLE 4.2' },
    ],
    scopeWaveform: 'square',
    ledColor: '#38bdf8',
  },
  acs712: {
    id: 'acs712',
    name: 'ACS712 Hall-Effect Current Transducer',
    partNumber: 'Allegro ACS712ELCTR-05B-T (±5A Galvanically Isolated)',
    category: 'SENSOR',
    measuredMetric: 'Spindle Shaft Torque (via Armature Current Shunt)',
    pinout: [
      { pin: 'VCC', target: '5V Power Rail', color: '#ef4444', desc: 'Transducer Supply', voltage: '5.0V' },
      { pin: 'GND', target: 'Common GND Rail', color: '#1e293b', desc: 'Ground Reference', voltage: '0.0V' },
      { pin: 'OUT', target: 'ESP32 GPIO 34 (ADC)', color: '#22c55e', desc: '66 mV/A Analog Signal (Voltage Divided)', voltage: '0-3.3V' },
      { pin: 'IP+ / IP-', target: '24V Motor Loop', color: '#dc2626', desc: '2.1 kVRMS Isolated Primary Copper Path', voltage: '24.0V DC' },
    ],
    principle: 'Measures magnetic field generated by motor armature current passing through an internal 1.2 mΩ copper conductor loop. The Hall IC produces a proportional voltage with 2.1 kV RMS galvanic isolation. In DC motors, electromagnetic torque is directly proportional to armature current, eliminating fragile rotary strain gauges.',
    formula: 'V_{out} = 2.50V + (0.066 V/A × I),   τ = k_t × I   (k_t = 18.5 Nm/A)',
    calibratedValue: (t) => `${t.currentA.toFixed(2)} A  →  ${t.torque.toFixed(1)} Nm (${t.powerW.toFixed(0)} W)`,
    voltage: '5.0V VCC / 0-5V OUT',
    specs: [
      { label: 'Current Sensitivity', value: '66 mV per Ampere (±5A Range)' },
      { label: 'Zero-Current Offset', value: 'VCC / 2 = 2.500 V DC' },
      { label: 'Conductor Resistance', value: '1.2 mΩ low-loss internal copper trace' },
      { label: 'Isolation Rating', value: '2.1 kVRMS dielectric breakdown' },
    ],
    scopeWaveform: 'sine',
    ledColor: '#22c55e',
  },
  lm393: {
    id: 'lm393',
    name: 'LM393 Optical Slotted Speed Tachometer',
    partNumber: 'FC-03 Slotted Optocoupler (5mm Gap, 8-Notch Wheel)',
    category: 'SENSOR',
    measuredMetric: 'Spindle Rotational Speed (RPM)',
    pinout: [
      { pin: 'VCC', target: '3.3V Power Rail', color: '#ef4444', desc: 'Phototransistor Bias', voltage: '3.3V' },
      { pin: 'GND', target: 'Common GND Rail', color: '#1e293b', desc: 'Ground Reference', voltage: '0.0V' },
      { pin: 'D0', target: 'ESP32 GPIO 18 (INT)', color: '#f97316', desc: 'Digital Pulse Stream to Hardware Timer', voltage: '3.3V' },
    ],
    principle: 'An infrared LED emits an 850nm beam across a 5mm U-bracket toward a phototransistor. An 8-notch acrylic disc on the spindle shaft cuts the beam. The LM393 comparator converts transitions into sharp square waves triggering ESP32 hardware interrupts.',
    formula: 'RPM = (Pulse\\_Count / 8) × 60 = f_{pulse} × 7.5',
    calibratedValue: (t) => `${t.rpm} RPM  [Pulse Rate: ${(t.rpm * 8 / 60).toFixed(0)} Hz]`,
    voltage: '3.3 - 5.0 V',
    specs: [
      { label: 'Slot Width', value: '5 mm optical beam aperture' },
      { label: 'Encoder Resolution', value: '8 pulses per mechanical revolution' },
      { label: 'Comparator IC', value: 'LM393 Dual High-Precision Voltage Comparator' },
      { label: 'Response Time', value: '< 1.5 µs fast edge transitions' },
    ],
    scopeWaveform: 'pulse',
    ledColor: '#f97316',
  },
  ds18b20: {
    id: 'ds18b20',
    name: 'DS18B20 Digital Stator Temperature Probe',
    partNumber: 'Maxim DS18B20 Stainless Capsule (12-bit Resolution)',
    category: 'SENSOR',
    measuredMetric: 'Motor Stator Casing Temperature',
    pinout: [
      { pin: 'VDD (Red)', target: '3.3V Power Rail', color: '#ef4444', desc: 'Digital Sensor Supply', voltage: '3.3V' },
      { pin: 'GND (Black)', target: 'Common GND Rail', color: '#1e293b', desc: 'Shield & Ground', voltage: '0.0V' },
      { pin: 'DQ (Yellow)', target: 'ESP32 GPIO 4', color: '#a855f7', desc: 'Dallas 1-Wire Data (4.7kΩ Pull-Up)', voltage: '3.3V' },
    ],
    principle: 'Bandgap temperature sensor encapsulated in an IP68 waterproof stainless steel cylinder clamped to the motor stator with silicone thermal compound. Internal delta-sigma ADC converts temperature directly to 12-bit digital words, communicating over Dallas 1-Wire with 4.7kΩ pullup.',
    formula: 'T_{celsius} = RAW \\times 0.0625 ^\\circ\\text{C},   T_{Kelvin} = T_{celsius} + 273.15',
    calibratedValue: (t) => `${t.tempC.toFixed(1)} °C  (${t.tempK.toFixed(1)} K)  [ΔT safe: >8.6 K]`,
    voltage: '3.0 - 5.5 V',
    specs: [
      { label: 'Operating Range', value: '-55°C to +125°C (-67°F to +257°F)' },
      { label: 'Digital Accuracy', value: '±0.5°C accuracy from -10°C to +85°C' },
      { label: 'ADC Resolution', value: '12-bit programmable (0.0625°C LSB step)' },
      { label: 'Conversion Speed', value: '750 ms maximum @ 12-bit resolution' },
    ],
    scopeWaveform: 'onewire',
    ledColor: '#a855f7',
  },
  mpu6050: {
    id: 'mpu6050',
    name: 'MPU-6050 6-Axis MEMS Vibration IMU',
    partNumber: 'InvenSense GY-521 Breakout (±2g Accel, I2C 0x68)',
    category: 'SENSOR',
    measuredMetric: 'Mechanical Vibration & Tool Wear Jitter',
    pinout: [
      { pin: 'VCC', target: '3.3V Power Rail', color: '#ef4444', desc: 'Onboard LDO Input', voltage: '3.3V' },
      { pin: 'GND', target: 'Common GND Rail', color: '#1e293b', desc: 'Ground Reference', voltage: '0.0V' },
      { pin: 'SDA', target: 'ESP32 GPIO 21', color: '#38bdf8', desc: 'I2C Serial Data line', voltage: '3.3V' },
      { pin: 'SCL', target: 'ESP32 GPIO 22', color: '#eab308', desc: 'I2C Serial Clock (400kHz)', voltage: '3.3V' },
    ],
    principle: 'MEMS capacitive accelerometer detects micro-deflections in motor casing along 3 axes. Changes in capacitance between proof-mass silicon fingers are amplified and converted to 16-bit registers. Z-axis RMS acceleration tracks bearing degradation according to ISO 10816 industrial vibration standards.',
    formula: 'Vib_{RMS} = \\sqrt{\\frac{1}{N}\\sum_{i=1}^N (a_z[i] - 1g)^2}   (\\text{Alarm: } > 2.8g)',
    calibratedValue: (t) => `${t.vibrationG.toFixed(2)} g RMS  [ISO 10816 Zone ${t.vibrationG > 2.8 ? 'D (Unacceptable)' : t.vibrationG > 1.8 ? 'C (Warning)' : 'A/B (Good)'}]`,
    voltage: '3.3V Regulated',
    specs: [
      { label: 'Full Scale Range', value: '±2g, ±4g, ±8g, ±16g user-selectable' },
      { label: 'ADC Resolution', value: '16-bit per axis (16384 LSB/g @ ±2g)' },
      { label: 'DMP Engine', value: 'Embedded Digital Motion Processor onboard' },
      { label: 'I2C Bus Address', value: '0x68 (AD0 pin grounded)' },
    ],
    scopeWaveform: 'sine',
    ledColor: '#60a5fa',
  },
  oled: {
    id: 'oled',
    name: '0.96″ I2C OLED Telemetry Display',
    partNumber: 'SSD1306 128×64 Monochrome / Yellow-Blue Dot Matrix',
    category: 'DISPLAY',
    measuredMetric: 'Edge Node Local Telemetry Readout & System Status',
    pinout: [
      { pin: 'GND', target: 'Common GND Rail', color: '#1e293b', desc: 'Ground', voltage: '0.0V' },
      { pin: 'VCC', target: '3.3V Power Rail', color: '#ef4444', desc: 'Driver Logic Power', voltage: '3.3V' },
      { pin: 'SCL', target: 'ESP32 GPIO 22', color: '#eab308', desc: 'I2C Clock line', voltage: '3.3V' },
      { pin: 'SDA', target: 'ESP32 GPIO 21', color: '#38bdf8', desc: 'I2C Data line', voltage: '3.3V' },
    ],
    principle: 'Self-emissive organic light emitting diode screen refreshed by ESP32 over I2C at 400kHz every 250ms. Renders live sensor values, bar graphs, and relay protection status without relying on external Wi-Fi connectivity.',
    formula: '\\text{Framebuffer: } 128 \\times 64 / 8 = 1024 \\text{ bytes in ESP32 RAM}',
    calibratedValue: () => '128×64 px Framebuffer · 400kHz Fast I2C (0x3C)',
    voltage: '3.3 - 5.0 V',
    specs: [
      { label: 'Display Panel', value: '0.96 inch diagonal OLED, 128×64 pixels' },
      { label: 'Controller IC', value: 'Solomon Systech SSD1306 embedded driver' },
      { label: 'Viewing Angle', value: '> 160° with 10,000:1 high contrast ratio' },
      { label: 'Power Draw', value: '0.04W nominal (self-emissive, no backlight)' },
    ],
    scopeWaveform: 'square',
    ledColor: '#38bdf8',
  },
  relay: {
    id: 'relay',
    name: '5V Songle Safety Relay Module',
    partNumber: 'SRD-05VDC-SL-C (10A/250VAC, Optoisolated Trigger)',
    category: 'ACTUATOR',
    measuredMetric: 'Emergency Automated Power Cutoff Actuator',
    pinout: [
      { pin: 'VCC', target: '5V Power Rail', color: '#ef4444', desc: 'Coil Supply', voltage: '5.0V' },
      { pin: 'GND', target: 'Common GND Rail', color: '#1e293b', desc: 'Ground Reference', voltage: '0.0V' },
      { pin: 'IN', target: 'ESP32 GPIO 26', color: '#f8fafc', desc: 'Active-LOW Optocoupler Input', voltage: '3.3V' },
      { pin: 'COM / NO', target: '24V Motor Circuit', color: '#dc2626', desc: 'Normally-Open Switched Power Path', voltage: '24.0V DC' },
    ],
    principle: 'An EL817 optoisolator drives an NPN switching transistor that energizes the electromagnetic relay coil. When PyTorch GRU failure probability exceeds 55%, GPIO 26 transitions LOW, breaking the 24V motor circuit within 10ms to prevent catastrophic winding burnout.',
    formula: '\\text{Trip Latency } t_{trip} \\le 10\\text{ ms},   P_{coil} = 0.36\\text{ W (70mA @ 5V)}',
    calibratedValue: (_t) => 'Songle SRD-05VDC · Breaker Latency: 8.4 ms',
    voltage: '5V Coil / 24V Load Circuit',
    specs: [
      { label: 'Contact Capacity', value: '10A 250VAC / 10A 30VDC' },
      { label: 'Galvanic Isolation', value: 'EL817 Optocoupler (5.0 kV isolation)' },
      { label: 'Operating Speed', value: '10ms release / 5ms pickup mechanical' },
      { label: 'Protection', value: '1N4007 Flyback Diode across coil' },
    ],
    scopeWaveform: 'flat',
    ledColor: '#f43f5e',
  },
  motor: {
    id: 'motor',
    name: '24V DC Industrial Spindle Motor Rig',
    partNumber: 'RS-775 High-Torque Dual Ball-Bearing Spindle',
    category: 'LOAD',
    measuredMetric: 'Monitored Physical Asset (CNC Spindle Prototype)',
    pinout: [
      { pin: 'V+ (Red)', target: 'Relay NO Terminal', color: '#dc2626', desc: '24V Switched Armature Supply', voltage: '24.0V' },
      { pin: 'V- (Black)', target: 'ACS712 Terminal IP-', color: '#1e293b', desc: 'Return Conductor via Current Sensor', voltage: '0.0V' },
    ],
    principle: '24V brushed DC motor with dynamic rotational inertia, fitted with an 8-slot optical tachometer disc and cooling impeller fan. Simulates an industrial machine tool spindle subjected to varying torque loads, thermal stress, and bearing wear.',
    formula: 'P_{mech} = \\tau \\times \\left(\\frac{2\\pi \\times RPM}{60}\\right) \\text{ Watts},   P_{elec} = V \\times I',
    calibratedValue: (t) => `${t.powerW.toFixed(1)} W  [Eff: ${t.powerW > 0 ? ((t.torque * t.rpm * 2 * Math.PI / 60 / t.powerW) * 100).toFixed(0) : 0}%]`,
    voltage: '24.0V DC / 0 - 5.0 A',
    specs: [
      { label: 'Nominal Voltage', value: '24V DC (12V - 36V operational range)' },
      { label: 'No-Load Speed', value: '2400 RPM @ 24V DC' },
      { label: 'Stall Torque', value: '88.5 Nm (Current spikes to 4.8A)' },
      { label: 'Bearings', value: 'Dual high-speed deep groove ball bearings' },
    ],
    scopeWaveform: 'pwm',
    ledColor: '#94a3b8',
  },
  mb102: {
    id: 'mb102',
    name: 'MB102 Breadboard Power Module',
    partNumber: 'YwRobot MB102 Dual 3.3V / 5.0V Regulator',
    category: 'POWER',
    measuredMetric: 'Regulated Lab Bench DC Power Distribution',
    pinout: [
      { pin: 'DC IN (Jack)', target: '12V DC Bench Adapter', color: '#ef4444', desc: '2.1mm Center-Positive Barrel Jack', voltage: '9-12V' },
      { pin: '5V Rail OUT', target: 'Top Breadboard Rail (+)', color: '#ef4444', desc: 'AMS1117-5.0 Regulated Output', voltage: '5.0V' },
      { pin: '3.3V Rail OUT', target: 'Bottom Breadboard Rail (+)', color: '#f59e0b', desc: 'AMS1117-3.3 Regulated Output', voltage: '3.3V' },
      { pin: 'GND Pins', target: 'Breadboard Rails (-)', color: '#1e293b', desc: 'Common Ground Return Plane', voltage: '0.0V' },
    ],
    principle: 'Plugs directly into standard breadboard rails. Employs dual AMS1117 low-dropout linear regulators with independent jumper caps to provide dedicated 5.0V and 3.3V power rails with reverse polarity and thermal overload protection.',
    formula: 'V_{out} = 1.25 \\times (1 + R_2/R_1) + I_{adj} \\times R_2   (\\pm 1\\% \\text{ regulation})',
    calibratedValue: () => 'Dual AMS1117 Regulators · 5V & 3.3V Rails Active',
    voltage: '5.0V & 3.3V Output',
    specs: [
      { label: 'Input Voltage', value: '6.5V - 12V DC via 2.1mm jack or USB' },
      { label: 'Output Rails', value: 'Dual independent 3.3V / 5.0V switchable' },
      { label: 'Max Output Current', value: '< 700 mA continuous per channel' },
      { label: 'Power Indication', value: 'Green SMD LED with self-locking latch switch' },
    ],
    scopeWaveform: 'flat',
    ledColor: '#22c55e',
  },
};

// ─── TEST POINTS FOR MULTIMETER ─────────────────────────────────────────────
const TEST_POINTS: TestPoint[] = [
  { id: 'TP1', label: 'TP1: 5V_BUS', name: 'MB102 5V Power Rail', x: 80, y: 35, voltage: (_t, p) => p ? 5.02 : 0.0, unit: 'V DC', domain: 'POWER 5V' },
  { id: 'TP2', label: 'TP2: 3V3_MCU', name: 'ESP32 3.3V Logic Bus', x: 260, y: 70, voltage: (_t, p) => p ? 3.31 : 0.0, unit: 'V DC', domain: 'LOGIC 3.3V' },
  { id: 'TP3', label: 'TP3: ACS712_OUT', name: 'ACS712 Current Signal', x: 195, y: 235, voltage: (t, p) => p ? (2.50 + t.currentA * 0.066) : 0.0, unit: 'V DC', domain: 'ANALOG' },
  { id: 'TP4', label: 'TP4: LM393_D0', name: 'LM393 Optical Tachometer D0', x: 670, y: 265, voltage: (t, p) => p && t.rpm > 0 ? 1.65 : 3.3, unit: 'V DC', freq: (t) => t.rpm * 8 / 60, domain: 'INTERRUPT' },
  { id: 'TP5', label: 'TP5: DS18B20_DQ', name: 'DS18B20 1-Wire DQ Bus', x: 575, y: 175, voltage: (_t, p) => p ? 3.28 : 0.0, unit: 'V DC', domain: 'LOGIC 3.3V' },
  { id: 'TP6', label: 'TP6: MPU6050_SDA', name: 'MPU6050 I2C SDA Line', x: 220, y: 320, voltage: (_t, p) => p ? 3.29 : 0.0, unit: 'V DC', domain: 'LOGIC 3.3V' },
  { id: 'TP7', label: 'TP7: RELAY_IN', name: 'Relay Control Input (GPIO 26)', x: 375, y: 310, voltage: (_t, p, tripped) => p ? (tripped ? 0.05 : 3.28) : 0.0, unit: 'V DC', domain: 'LOGIC 3.3V' },
  { id: 'TP8', label: 'TP8: MOTOR_24V', name: 'RS-775 Motor Terminal V+', x: 580, y: 75, voltage: (_t, p, tripped) => (p && !tripped) ? 24.08 : 0.0, unit: 'V DC', domain: 'MOTOR 24V' },
];

// ─── PRESENTATION SLIDES ────────────────────────────────────────────────────
const SLIDES = [
  {
    title: '🔌 1. Industrial IoT Architecture Overview',
    componentId: null,
    body: 'This academic hardware prototype implements an end-to-end cyber-physical IoT system for CNC spindle motors. The edge node couples multi-modal transducers (Hall current, optical tachometer, 6-axis MEMS vibration, OneWire temperature) with an ESP32 microcontroller that performs local preprocessing, FreeRTOS scheduling, and MQTT streaming to a TimescaleDB / PyTorch GRU neural pipeline.',
  },
  {
    title: '🧠 2. ESP32 DevKit — Dual-Core Edge Gateway',
    componentId: 'esp32',
    body: 'The ESP32 runs FreeRTOS with task affinity: Core 0 computes exponential moving average (EMA) filtration (α=0.3) on high-frequency sensor interrupts and drives the SSD1306 OLED framebuffer. Core 1 manages Wi-Fi transport, TLS handshake, and JSON payload serialization to Mosquitto MQTT broker at 1.0 Hz.',
  },
  {
    title: '⚡ 3. ACS712 — Indirect Torque via Current Shunt',
    componentId: 'acs712',
    body: 'Rather than utilizing expensive and fragile rotary strain gauges, shaft torque τ is determined non-invasively through motor armature current I using the Hall effect: Vout = 2.5V + (66mV/A × I), with τ = kt × I (kt = 18.5 Nm/A). The internal 1.2mΩ conductor provides 2.1kV galvanic isolation.',
  },
  {
    title: '🔄 4. LM393 — Optical Slotted Tachometer',
    componentId: 'lm393',
    body: 'An 8-slot acrylic encoder disc rotates synchronously with the spindle shaft through an infrared optocoupler beam. The LM393 comparator yields clean 3.3V square pulses to ESP32 hardware interrupt GPIO 18. Speed is derived with sub-millisecond precision: RPM = (Pulse_Count / 8) × 60.',
  },
  {
    title: '🌡️ 5. DS18B20 — Digital Stator Thermal Probe',
    componentId: 'ds18b20',
    body: 'A waterproof DS18B20 stainless capsule is thermally bonded to the motor casing. Its internal delta-sigma ADC delivers 12-bit temperature (0.0625°C/bit) over Dallas 1-Wire on GPIO 4 with a 4.7kΩ pull-up resistor. An academic rule-based trigger flags heat dissipation failure (HDF) if ΔT < 8.6 K.',
  },
  {
    title: '📳 6. MPU-6050 — 6-DOF Bearing Degradation IMU',
    componentId: 'mpu6050',
    body: 'The MPU-6050 MEMS accelerometer measures micro-deflections on the motor housing. Acceleration along the Z-axis is sampled at 400kHz over I2C (0x68). Root-Mean-Square (RMS) vibration tracks bearing spalling and tool wear according to the ISO 10816 mechanical vibration threshold (Alarm > 2.8g).',
  },
  {
    title: '🛡️ 7. Songle Relay — Automated Neural Cutoff',
    componentId: 'relay',
    body: 'When the PyTorch GRU neural model predicts failure risk > 55%, the cloud engine dispatches an emergency MQTT control packet. The ESP32 pulls GPIO 26 LOW, engaging the optoisolator and breaking the 24V motor circuit within 8.4ms to prevent catastrophic winding burnout.',
  },
  {
    title: '🌱 8. Sustainability & UN SDG Alignment',
    componentId: null,
    body: 'Predictive maintenance eliminates premature asset replacement, reduces energy consumption during jammed-rotor conditions by 100%, and cuts manufacturing carbon footprint. Directly aligns with UN Sustainable Development Goals: SDG 7 (Clean Energy), SDG 9 (Industry Innovation), and SDG 12 (Responsible Consumption).',
  },
];

// ─── ESP32 FIRMWARE C++ SOURCE CODE ─────────────────────────────────────────
const ESP32_FIRMWARE_CODE = `/**
 * ==============================================================================
 * Smart Industrial Edge Node — ESP32 Dual-Core FreeRTOS Firmware
 * Project: Asset Failure Prediction & Automated Safety Cutoff (Phase 7)
 * Target MCU: ESP-WROOM-32 DevKit V1 (240MHz Xtensa Dual-Core)
 * ==============================================================================
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>

// --- PIN DEFINITIONS ---
#define PIN_ACS712_ADC     34   // ADC1_CH6 (12-bit, Hall Current)
#define PIN_LM393_INT      18   // Hardware Interrupt (Spindle Speed)
#define PIN_DS18B20_DQ      4   // Dallas 1-Wire Stator Temperature
#define PIN_RELAY_CUTOFF   26   // Active-LOW Songle Relay Actuator
#define PIN_I2C_SDA        21   // OLED & MPU-6050 Data
#define PIN_I2C_SCL        22   // OLED & MPU-6050 Clock

// --- SENSOR OBJECTS ---
Adafruit_SSD1306 display(128, 64, &Wire, -1);
OneWire oneWire(PIN_DS18B20_DQ);
DallasTemperature tempSensor(&oneWire);
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// --- GLOBAL ATOMIC TELEMETRY ---
volatile uint32_t pulseCount = 0;
float filteredCurrent = 0.0;
float filteredVibration = 1.20;
const float EMA_ALPHA = 0.30;
bool relayTripped = false;

// --- HARDWARE INTERRUPT (IRAM_ATTR FOR LOW LATENCY) ---
void IRAM_ATTR onSpindlePulse() {
  pulseCount++;
}

// ==============================================================================
// CORE 0 TASK: HIGH-FREQUENCY SENSOR POLLING & EMA FILTERING
// ==============================================================================
void TaskSensorAcquisition(void *pvParameters) {
  TickType_t xLastWakeTime = xTaskGetTickCount();
  const TickType_t xFrequency = pdMS_TO_TICKS(10); // 100Hz Polling

  for (;;) {
    // 1. Sample ACS712 ADC (12-bit, 0-4095)
    uint32_t rawAdc = analogRead(PIN_ACS712_ADC);
    float voltage = (rawAdc / 4095.0) * 3.30 * (5.0 / 3.3); // Scaled
    float instantCurrent = abs((voltage - 2.50) / 0.066);

    // 2. Exponential Moving Average (EMA) Filtration
    filteredCurrent = (EMA_ALPHA * instantCurrent) + ((1.0 - EMA_ALPHA) * filteredCurrent);

    // 3. Check Safety Threshold
    if (filteredCurrent > 4.50 && !relayTripped) {
      digitalWrite(PIN_RELAY_CUTOFF, LOW); // Emergency Cutoff
      relayTripped = true;
      Serial.println("[ISR_ALERT] Current Overload! Relay TRIPPED <10ms");
    }

    vTaskDelayUntil(&xLastWakeTime, xFrequency);
  }
}

// ==============================================================================
// CORE 1 TASK: MQTT PUBLICATION & CLOUD TELEMETRY STREAM
// ==============================================================================
void TaskMqttStreaming(void *pvParameters) {
  for (;;) {
    if (!mqttClient.connected()) {
      reconnectMqtt();
    }
    mqttClient.loop();

    // Compute Speed from Pulse Counter (8 slots per rev)
    uint32_t count = pulseCount;
    pulseCount = 0;
    float rpm = (count / 8.0) * 60.0;
    float torque = filteredCurrent * 18.5; // kt = 18.5 Nm/A

    // Read Stator Temperature
    tempSensor.requestTemperatures();
    float statorC = tempSensor.getTempCByIndex(0);

    // Build JSON Payload
    StaticJsonDocument<256> doc;
    doc["asset_id"] = "asset_01";
    doc["rotational_speed"] = rpm;
    doc["torque"] = torque;
    doc["current_a"] = filteredCurrent;
    doc["process_temperature"] = statorC + 273.15;
    doc["relay_state"] = relayTripped ? "OPEN" : "CLOSED";

    char buffer[256];
    serializeJson(doc, buffer);
    mqttClient.publish("factory/lineA/asset_01/telemetry", buffer);

    vTaskDelay(pdMS_TO_TICKS(1000)); // 1.0 Hz Publishing
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY_CUTOFF, OUTPUT);
  digitalWrite(PIN_RELAY_CUTOFF, HIGH); // Armed (Normal Closed)

  pinMode(PIN_LM393_INT, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_LM393_INT), onSpindlePulse, RISING);

  analogSetPinAttenuation(PIN_ACS712_ADC, ADC_11db);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  tempSensor.begin();

  // Create Pinned FreeRTOS Tasks
  xTaskCreatePinnedToCore(TaskSensorAcquisition, "SensorTask", 4096, NULL, 2, NULL, 0);
  xTaskCreatePinnedToCore(TaskMqttStreaming, "MqttTask", 4096, NULL, 1, NULL, 1);
}

void loop() {
  // Empty — FreeRTOS scheduler handles all tasks
}`;

// ─── SPARKLINE COMPONENT ────────────────────────────────────────────────────
function Sparkline({ data, color, height = 28 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return <div style={{ height }} className="w-20" />;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const w = 80, h = height;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

// ─── OSCILLOSCOPE WAVEFORM COMPONENT ─────────────────────────────────────────
function OscilloscopeWave({ waveform, color, amplitude = 1, frequency = 1 }:
  { waveform: ComponentDetail['scopeWaveform']; color: string; amplitude?: number; frequency?: number }) {
  const w = 280, h = 76, cy = h / 2, amp = (h / 2 - 10) * Math.min(1.2, Math.max(0.1, amplitude));
  const pts: string[] = [];
  for (let x = 0; x <= w; x += 2) {
    const t = (x / w) * Math.PI * 4 * frequency;
    let y: number;
    switch (waveform) {
      case 'sine': y = cy - Math.sin(t) * amp; break;
      case 'square': y = cy - (Math.sin(t) >= 0 ? amp : -amp); break;
      case 'pulse': y = cy - (((t % (Math.PI * 2)) < 0.9) ? amp : -amp * 0.75); break;
      case 'pwm': y = cy - (((t % (Math.PI * 2)) < Math.PI * amplitude) ? amp : -amp); break;
      case 'onewire': y = cy - ((Math.sin(t * 2.5) > 0.2) ? amp * 0.8 : -amp * 0.4); break;
      default: y = cy;
    }
    pts.push(`${x},${y}`);
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full">
      <rect width={w} height={h} fill="#030712" rx="6" />
      {[19, 38, 57].map(gy => <line key={gy} x1="0" y1={gy} x2={w} y2={gy} stroke="#1e293b" strokeWidth="1" />)}
      {[70, 140, 210].map(gx => <line key={gx} x1={gx} y1="0" x2={gx} y2={h} stroke="#1e293b" strokeWidth="1" />)}
      <line x1="0" y1={cy} x2={w} y2={cy} stroke="#1e3a5f" strokeWidth="1" strokeDasharray="4 3" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" filter={`drop-shadow(0 0 4px ${color})`} />
    </svg>
  );
}

// ─── MAIN MACHINE PROTOTYPE SIMULATOR COMPONENT ─────────────────────────────
export const MachinePrototypeSimulator: React.FC<MachineSimulatorProps> = ({ assets, onInjectFault }) => {
  // Navigation & View States
  const [selectedAssetId, setSelectedAssetId] = useState('asset_01');
  const [workbenchView, setWorkbenchView] = useState<'3d' | 'breadboard' | 'wiring' | 'schematic' | 'pinout' | 'firmware'>('3d');
  const [activeTab, setActiveTab] = useState<'bench' | 'fft' | 'scope' | 'flasher' | 'serial' | 'mqtt' | 'sustainability'>('bench');
  const [isManualMode, setIsManualMode] = useState(false);
  const [benchPowerOn, setBenchPowerOn] = useState(true);
  const [relayTripped, setRelayTripped] = useState(false);
  const [hardwareTelemActive, setHardwareTelemActive] = useState(false);
  const [hardwareTelemData, setHardwareTelemData] = useState<{
    rpm: number;
    currentA: number;
    tempC: number;
    vibrationG: number;
    relayState: boolean;
  } | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>('esp32');
  const [wireBusFilter, setWireBusFilter] = useState<'all' | 'power' | 'i2c' | 'adc' | 'interrupt' | 'onewire' | 'motor'>('all');

  // Modals
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Multimeter tool
  const [dmmActive, setDmmActive] = useState(false);
  const [activeTestPoint, setActiveTestPoint] = useState<TestPoint>(TEST_POINTS[0]);
  const [dmmMode, setDmmMode] = useState<'DC_V' | 'FREQ_HZ' | 'AC_V' | 'CONT'>('DC_V');

  // Manual Controls & Scenarios
  const [motorSpeedPct, setMotorSpeedPct] = useState(65);
  const [loadMode, setLoadMode] = useState<'nominal' | 'heavy' | 'jammed'>('nominal');
  const [thermalMode, setThermalMode] = useState<'normal' | 'overheat'>('normal');
  const [vibrationFault, setVibrationFault] = useState(false);
  const [wifiSignal, setWifiSignal] = useState(true);

  // Animations & History
  const [motorRotation, setMotorRotation] = useState(0);
  const [pulseOffset, setPulseOffset] = useState(0);
  const [history, setHistory] = useState({
    rpm: [] as number[],
    torque: [] as number[],
    temp: [] as number[],
    vib: [] as number[],
    risk: [] as number[],
  });

  // Sound & Presentation
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [presentMode, setPresentMode] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [scopeComponent, setScopeComponent] = useState<string | null>(null);

  // Logs
  const [logs, setLogs] = useState<SerialLog[]>([]);
  const logCounterRef = useRef(1);
  const serialEndRef = useRef<HTMLDivElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);

  // Web Audio Synthesizer
  const audioCtxRef = useRef<AudioContext | null>(null);
  const motorOscRef = useRef<OscillatorNode | null>(null);
  const motorGainRef = useRef<GainNode | null>(null);
  const prevRelayRef = useRef(relayTripped);

  // Active asset
  const liveAsset = useMemo(() => assets.find(a => a.asset_id === selectedAssetId) || assets[0], [assets, selectedAssetId]);

  // Telemetry computation
  const telemetry = useMemo(() => {
    if (!benchPowerOn || relayTripped) {
      return {
        rpm: 0,
        torque: 0,
        tempC: 24.5,
        tempK: 297.65,
        currentA: 0,
        voltage: benchPowerOn ? 24.0 : 0.0,
        powerW: 0,
        vibrationG: 0.05,
        risk: 0,
        status: !benchPowerOn ? 'POWER_OFF' : 'RELAY_TRIPPED',
      };
    }
    if (hardwareTelemActive && hardwareTelemData) {
      const { rpm, currentA, tempC, vibrationG, relayState } = hardwareTelemData;
      const torque = parseFloat(((currentA / 1.5) * 16).toFixed(1));
      const powerW = parseFloat((currentA * 24.0).toFixed(1));
      const risk = vibrationG > 2.8 || tempC > 40 || currentA > 3.5 ? 0.82 : 0.14;
      return {
        rpm,
        torque,
        tempC,
        tempK: parseFloat((tempC + 273.15).toFixed(1)),
        currentA,
        voltage: relayState ? 24.0 : 0.0,
        powerW: relayState ? powerW : 0,
        vibrationG,
        risk,
        status: 'HARDWARE_LINKED',
      };
    }
    if (isManualMode || !liveAsset?.latest_telemetry) {
      const baseRpm = Math.round((motorSpeedPct / 100) * 2400);
      const torque = loadMode === 'jammed' ? 84.5 : loadMode === 'heavy' ? 66.2 : 39.5;
      const tempC = thermalMode === 'overheat' ? 44.8 : 34.2;
      const vibrationG = vibrationFault ? 4.6 : parseFloat((1.1 + (torque / 50) * 0.5).toFixed(2));
      const currentA = parseFloat(((torque / 16) * 1.5 + (baseRpm / 1000) * 0.8).toFixed(2));
      const powerW = parseFloat((currentA * 24.0).toFixed(1));
      const risk = loadMode === 'jammed' || loadMode === 'heavy' || thermalMode === 'overheat' || vibrationFault ? 0.88 : 0.17;
      return {
        rpm: baseRpm,
        torque,
        tempC,
        tempK: parseFloat((tempC + 273.15).toFixed(1)),
        currentA,
        voltage: 24.0,
        powerW,
        vibrationG,
        risk,
        status: !wifiSignal ? 'OFFLINE' : 'ONLINE',
      };
    }
    const t = liveAsset.latest_telemetry;
    const torque = t.torque || 40;
    const tempK = t.process_temperature || 308;
    const tempC = parseFloat((tempK - 273.15).toFixed(1));
    const currentA = parseFloat(((torque / 16) * 1.5 + 1.1).toFixed(2));
    const powerW = parseFloat((currentA * 24.0).toFixed(1));
    return {
      rpm: t.rotational_speed || 1500,
      torque,
      tempC,
      tempK,
      currentA,
      voltage: 24.0,
      powerW,
      vibrationG: parseFloat(((t.tool_wear || 50) / 70 + 0.9).toFixed(2)),
      risk: liveAsset.latest_prediction?.failure_probability ?? 0.20,
      status: liveAsset.status,
    };
  }, [benchPowerOn, relayTripped, isManualMode, liveAsset, motorSpeedPct, loadMode, thermalMode, vibrationFault, wifiSignal]);

  // Scenario Presets
  const applyPresetScenario = (scenario: 'nominal' | 'bearing' | 'jammed' | 'thermal' | 'wifi') => {
    setIsManualMode(true);
    setBenchPowerOn(true);
    if (scenario === 'nominal') {
      setRelayTripped(false);
      setMotorSpeedPct(65);
      setLoadMode('nominal');
      setThermalMode('normal');
      setVibrationFault(false);
      setWifiSignal(true);
    } else if (scenario === 'bearing') {
      setRelayTripped(false);
      setMotorSpeedPct(60);
      setLoadMode('heavy');
      setThermalMode('normal');
      setVibrationFault(true);
      setWifiSignal(true);
    } else if (scenario === 'jammed') {
      setMotorSpeedPct(30);
      setLoadMode('jammed');
      setThermalMode('overheat');
      setVibrationFault(true);
      setWifiSignal(true);
      // Automatically trip relay after 500ms to simulate fast breaker
      setTimeout(() => setRelayTripped(true), 600);
    } else if (scenario === 'thermal') {
      setRelayTripped(false);
      setMotorSpeedPct(70);
      setLoadMode('heavy');
      setThermalMode('overheat');
      setVibrationFault(false);
      setWifiSignal(true);
    } else if (scenario === 'wifi') {
      setWifiSignal(false);
    }
  };

  // Motor spin animation loop
  useEffect(() => {
    if (telemetry.rpm === 0) return;
    let id: number;
    const spd = (telemetry.rpm / 60) * 3.6;
    const animate = () => {
      setMotorRotation(p => (p + spd) % 360);
      id = requestAnimationFrame(animate);
    };
    id = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(id);
  }, [telemetry.rpm]);

  // Wire signal packet animation loop
  useEffect(() => {
    const id = setInterval(() => setPulseOffset(p => (p + 3) % 24), 35);
    return () => clearInterval(id);
  }, []);

  // History sparklines
  useEffect(() => {
    const id = setInterval(() => {
      setHistory(h => ({
        rpm: [...h.rpm.slice(-19), telemetry.rpm],
        torque: [...h.torque.slice(-19), telemetry.torque],
        temp: [...h.temp.slice(-19), telemetry.tempC],
        vib: [...h.vib.slice(-19), telemetry.vibrationG],
        risk: [...h.risk.slice(-19), telemetry.risk * 100],
      }));
    }, 1200);
    return () => clearInterval(id);
  }, [telemetry]);

  // Web Audio Motor Whine
  useEffect(() => {
    if (!soundEnabled) {
      motorOscRef.current?.stop();
      motorOscRef.current = null;
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      return;
    }
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (!motorOscRef.current) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      motorOscRef.current = osc;
      motorGainRef.current = gain;
    }
    const freq = 80 + (telemetry.rpm / 2400) * 650;
    const vol = telemetry.rpm > 0 ? 0.03 : 0;
    motorOscRef.current.frequency.setTargetAtTime(freq, ctx.currentTime, 0.08);
    motorGainRef.current!.gain.setTargetAtTime(vol, ctx.currentTime, 0.08);
  }, [soundEnabled, telemetry.rpm]);

  // Relay click SFX
  useEffect(() => {
    if (!soundEnabled || relayTripped === prevRelayRef.current) return;
    prevRelayRef.current = relayTripped;
    try {
      const ctx = audioCtxRef.current || new AudioContext();
      if (!audioCtxRef.current) audioCtxRef.current = ctx;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 180);
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(ctx.destination);
      s.start();
    } catch (_) {}
  }, [relayTripped, soundEnabled]);

  // Serial log generation
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
      const seq = logCounterRef.current++;
      let logItem: SerialLog;

      if (!benchPowerOn) {
        logItem = { id: seq, time: timeStr, type: 'WARN', text: '[SYS] MB102 Power Rails Isolated (0V).' };
      } else if (relayTripped) {
        logItem = { id: seq, time: timeStr, type: 'CUTOFF', text: '[RELAY_TRIP] GPIO26=LOW -> 24V Contact OPEN! Mechanical break latency: 8.4ms' };
      } else if (!wifiSignal) {
        logItem = { id: seq, time: timeStr, type: 'ERROR', text: '[MQTT] WiFi timeout. Local ring-buffer cached 48 telemetry packets.' };
      } else if (telemetry.risk >= 0.55) {
        logItem = { id: seq, time: timeStr, type: 'WARN', text: `[ALERT] GRU Risk=${(telemetry.risk * 100).toFixed(0)}% > Thr(55%). Auto-Cutoff Pending.` };
      } else {
        const msgs: { type: SerialLog['type']; text: string }[] = [
          { type: 'ADC', text: `[ACS712] ADC1_CH6(GPIO34): ${telemetry.currentA}A (Vout=${(2.5 + telemetry.currentA * 0.066).toFixed(2)}V) -> Torque: ${telemetry.torque}Nm` },
          { type: 'EDGE', text: `[LM393] GPIO18 INT: ${(telemetry.rpm * 8 / 60).toFixed(0)}Hz -> Spindle Speed: ${telemetry.rpm} RPM` },
          { type: 'EDGE', text: `[DS18B20] 1-Wire GPIO4: ${telemetry.tempC}°C (${telemetry.tempK}K) [Stator Margin OK]` },
          { type: 'EDGE', text: `[MPU6050] I2C 0x68: Vib_RMS=${telemetry.vibrationG}g [EMA α=0.30 Filtered]` },
          { type: 'MQTT', text: `[MQTT] PUB factory/${liveAsset?.line || 'lineA'}/${selectedAssetId}/telemetry (82 Bytes QoS0)` },
          { type: 'INFO', text: `[SSD1306] OLED 128x64 Framebuffer flushed via Fast I2C. Heap: 184KB` },
        ];
        const m = msgs[seq % msgs.length];
        logItem = { id: seq, time: timeStr, type: m.type, text: m.text };
      }
      setLogs(prev => [...prev.slice(-45), logItem]);
    }, 1100);
    return () => clearInterval(timer);
  }, [telemetry, benchPowerOn, relayTripped, wifiSignal, liveAsset, selectedAssetId]);

  useEffect(() => {
    if (serialEndRef.current) serialEndRef.current.scrollTop = serialEndRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (presentMode) {
      const s = SLIDES[slideIndex];
      if (s.componentId) setSelectedComponentId(s.componentId);
    }
  }, [presentMode, slideIndex]);

  const activeDetail = selectedComponentId ? COMPONENT_DETAILS[selectedComponentId] : null;

  const thermalAlpha = Math.min(0.55, (telemetry.tempC - 20) / 35 * 0.55);
  const thermalRgb = telemetry.tempC > 40 ? '239,68,68' : telemetry.tempC > 34 ? '234,179,8' : '59,130,246';

  const isWireHighlighted = (k: string, busType?: string) => {
    if (wireBusFilter !== 'all') {
      if (wireBusFilter === 'power' && busType !== 'power') return false;
      if (wireBusFilter === 'i2c' && busType !== 'i2c') return false;
      if (wireBusFilter === 'adc' && busType !== 'adc') return false;
      if (wireBusFilter === 'interrupt' && busType !== 'interrupt') return false;
      if (wireBusFilter === 'onewire' && busType !== 'onewire') return false;
      if (wireBusFilter === 'motor' && busType !== 'motor') return false;
      return true;
    }
    if (!selectedComponentId) return true;
    return selectedComponentId === k || selectedComponentId === 'esp32';
  };

  const handleScreenshot = useCallback(() => {
    const svgEl = workbenchRef.current?.querySelector('svg');
    if (!svgEl) return;
    const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `academic_hardware_workbench_${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const copyFirmware = () => {
    navigator.clipboard.writeText(ESP32_FIRMWARE_CODE);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2500);
  };

  const dmmReading = useMemo(() => {
    const v = activeTestPoint.voltage(telemetry, benchPowerOn, relayTripped);
    if (dmmMode === 'DC_V') return { val: v.toFixed(3), unit: 'V DC' };
    if (dmmMode === 'FREQ_HZ') {
      const f = activeTestPoint.freq ? activeTestPoint.freq(telemetry) : 0;
      return { val: f.toFixed(1), unit: 'Hz' };
    }
    if (dmmMode === 'AC_V') {
      const acRipple = activeTestPoint.id === 'TP3' ? telemetry.currentA * 0.02 : 0.005;
      return { val: acRipple.toFixed(3), unit: 'mV AC' };
    }
    return { val: v > 0.2 ? 'PASS (0.4Ω)' : 'OPEN', unit: 'CONT' };
  }, [activeTestPoint, dmmMode, telemetry, benchPowerOn, relayTripped]);

  const mqttPayload = useMemo(() => ({
    asset_id: selectedAssetId,
    timestamp: new Date().toISOString(),
    rotational_speed: telemetry.rpm,
    torque: telemetry.torque,
    process_temperature: telemetry.tempK,
    power_draw_w: telemetry.powerW,
    vibration_rms_g: telemetry.vibrationG,
    current_a: telemetry.currentA,
    voltage_dc: telemetry.voltage,
    failure_risk_pct: parseFloat((telemetry.risk * 100).toFixed(1)),
    relay_state: relayTripped ? 'OPEN' : 'CLOSED',
    wifi_rssi_dbm: wifiSignal ? -62 : null,
  }), [telemetry, relayTripped, wifiSignal, selectedAssetId]);

  const sustCalc = useMemo(() => {
    const kwhPerDay = (telemetry.powerW / 1000) * 24;
    const co2PerDay = kwhPerDay * 0.82;
    const savingsPct = relayTripped ? 100 : Math.max(0, (1 - telemetry.powerW / 120) * 100);
    const avoidedKwhPerYear = kwhPerDay * 365 * (savingsPct / 100);
    return {
      kwhPerDay,
      co2PerDay,
      avoidedCO2: avoidedKwhPerYear * 0.82,
      costSavingUSD: avoidedKwhPerYear * 0.12,
      savingsPct,
    };
  }, [telemetry.powerW, relayTripped]);

  return (
    <div className="space-y-4 font-sans select-none">

      {/* ─── ACADEMIC LAB REPORT MODAL (PRINT-READY) ─── */}
      {reportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-4xl bg-slate-900 border border-cyan-500/50 rounded-3xl p-8 shadow-2xl space-y-6 my-8 max-h-[90vh] overflow-y-auto font-mono text-xs">
            <button
              onClick={() => setReportModalOpen(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header */}
            <div className="border-b border-slate-700 pb-4 flex justify-between items-start">
              <div>
                <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest">
                  Academic Engineering Report · IEEE Phase 7 Specification
                </span>
                <h1 className="text-xl font-bold text-white mt-1">
                  Smart Industrial IoT Spindle Monitoring & Predictive Failure Rig
                </h1>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Edge MCU: ESP32-WROOM-32 · Cloud Engine: PyTorch GRU Neural Network · Asset: {selectedAssetId}
                </p>
              </div>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg transition-all"
              >
                <Printer className="w-4 h-4" /> Print / PDF
              </button>
            </div>

            {/* Bill of Materials (BOM) Table */}
            <div>
              <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-cyan-400" /> 1. Bill of Materials (BOM) & Component Costs
              </h3>
              <table className="w-full text-left border border-slate-800 rounded-lg overflow-hidden">
                <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase">
                  <tr>
                    <th className="p-2">Item</th>
                    <th className="p-2">Component / Model</th>
                    <th className="p-2">Role</th>
                    <th className="p-2">Interface</th>
                    <th className="p-2">Operating Voltage</th>
                    <th className="p-2">Est. Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-[11px] text-slate-300">
                  <tr><td className="p-2 font-bold text-white">MCU</td><td>ESP32 DevKit V1</td><td>Edge Node & Gateway</td><td>Wi-Fi / BLE</td><td>5V USB / 3.3V</td><td>$4.50</td></tr>
                  <tr><td className="p-2 font-bold text-white">Current Sensor</td><td>Allegro ACS712ELCTR-05B</td><td>Torque via Current</td><td>ADC1_CH6 (GPIO 34)</td><td>5.0V VCC</td><td>$2.20</td></tr>
                  <tr><td className="p-2 font-bold text-white">Speed Tachometer</td><td>LM393 Slotted Optocoupler</td><td>Spindle RPM</td><td>Hardware INT (GPIO 18)</td><td>3.3V Logic</td><td>$1.10</td></tr>
                  <tr><td className="p-2 font-bold text-white">Stator Probe</td><td>Maxim DS18B20 Stainless</td><td>Stator Temperature</td><td>Dallas 1-Wire (GPIO 4)</td><td>3.3V Logic</td><td>$2.80</td></tr>
                  <tr><td className="p-2 font-bold text-white">Vibration IMU</td><td>InvenSense MPU-6050</td><td>ISO 10816 Bearing Jitter</td><td>I2C 0x68 (GPIO 21/22)</td><td>3.3V Regulated</td><td>$1.90</td></tr>
                  <tr><td className="p-2 font-bold text-white">OLED Display</td><td>SSD1306 0.96″ 128×64</td><td>Local Telemetry Display</td><td>I2C 0x3C (GPIO 21/22)</td><td>3.3V Logic</td><td>$2.40</td></tr>
                  <tr><td className="p-2 font-bold text-white">Safety Cutoff</td><td>Songle SRD-05VDC Relay</td><td>Emergency Circuit Breaker</td><td>Optoisolated GPIO 26</td><td>5V Coil / 24V Load</td><td>$1.50</td></tr>
                  <tr><td className="p-2 font-bold text-white">Spindle Motor</td><td>RS-775 24V DC Motor</td><td>Monitored Industrial Asset</td><td>24V Armature Circuit</td><td>24.0V DC / 0-5A</td><td>$12.00</td></tr>
                  <tr className="bg-slate-950 font-bold"><td colSpan={5} className="p-2 text-right text-slate-400">Total Prototype Hardware Cost:</td><td className="p-2 text-cyan-300">$28.40</td></tr>
                </tbody>
              </table>
            </div>

            {/* Current Telemetry Snapshot */}
            <div>
              <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-emerald-400" /> 2. Live Rig Telemetry Snapshot
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800"><div className="text-[10px] text-slate-400">Rotational Speed</div><div className="text-base font-bold text-orange-400">{telemetry.rpm} RPM</div></div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800"><div className="text-[10px] text-slate-400">Shaft Torque</div><div className="text-base font-bold text-emerald-400">{telemetry.torque.toFixed(1)} Nm</div></div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800"><div className="text-[10px] text-slate-400">Stator Temperature</div><div className="text-base font-bold text-purple-400">{telemetry.tempC.toFixed(1)} °C</div></div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800"><div className="text-[10px] text-slate-400">GRU Failure Risk</div><div className="text-base font-bold text-rose-400">{(telemetry.risk * 100).toFixed(0)}%</div></div>
              </div>
            </div>

            {/* Equations & Calibration Summary */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <h4 className="text-xs font-bold text-amber-400 uppercase">3. Mathematical Calibration & Edge Equations:</h4>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                • <strong>Current to Torque Transfer Function:</strong> τ = 18.5 × I where I = (Vout − 2.50) / 0.066 V/A<br />
                • <strong>Optical Tachometer:</strong> RPM = (Interrupt_Pulses / 8) × 60<br />
                • <strong>EMA Noise Filtration:</strong> St = 0.30 · Yt + 0.70 · St-1 (Executed on Core 0 at 100 Hz)<br />
                • <strong>Mechanical Bearing Wear (ISO 10816):</strong> Vib_RMS = √((1/N) · Σ(az[i] − 1g)²)<br />
                • <strong>Relay Trip Condition:</strong> If P(Failure) &gt; 0.55 OR I &gt; 4.5A → GPIO 26 = LOW (8.4ms trip latency)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── GUIDED PRESENTATION OVERLAY MODAL ─── */}
      {presentMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md">
          <div className="relative w-full max-w-2xl mx-4 rounded-3xl border border-cyan-500/50 bg-slate-900/95 shadow-2xl p-8">
            <button onClick={() => setPresentMode(false)} className="absolute top-5 right-5 text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs font-mono text-cyan-400 mb-2 uppercase tracking-widest">
              <Sparkles className="w-4 h-4" /> Academic Defence Walkthrough · Slide {slideIndex + 1} of {SLIDES.length}
            </div>
            <h2 className="text-2xl font-bold text-white mb-4 tracking-tight">{SLIDES[slideIndex].title}</h2>
            <p className="text-slate-300 text-sm leading-relaxed mb-6 bg-slate-950/70 p-4 rounded-2xl border border-slate-800">
              {SLIDES[slideIndex].body}
            </p>
            {SLIDES[slideIndex].componentId && (
              <div className="mb-6 p-3 rounded-xl bg-cyan-950/70 border border-cyan-700/50 text-xs font-mono text-cyan-300 flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-cyan-400 animate-spin" />
                Active Hardware Focus: <strong>{COMPONENT_DETAILS[SLIDES[slideIndex].componentId!]?.name}</strong>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                disabled={slideIndex === 0}
                onClick={() => setSlideIndex(s => s - 1)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-slate-300 disabled:opacity-30 hover:bg-slate-700 transition-all"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <div className="flex gap-2">
                {SLIDES.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSlideIndex(i)}
                    className={`w-2.5 h-2.5 rounded-full transition-all ${i === slideIndex ? 'bg-cyan-400 scale-125' : 'bg-slate-700 hover:bg-slate-500'}`}
                  />
                ))}
              </div>
              <button
                disabled={slideIndex === SLIDES.length - 1}
                onClick={() => setSlideIndex(s => s + 1)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 border border-cyan-500 text-sm font-bold text-white disabled:opacity-30 hover:bg-cyan-500 transition-all shadow-lg shadow-cyan-600/30"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── OSCILLOSCOPE POPUP MODAL ─── */}
      {scopeComponent && COMPONENT_DETAILS[scopeComponent] && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-emerald-500/50 bg-slate-950/95 shadow-2xl p-6">
            <button onClick={() => setScopeComponent(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="p-2 rounded-lg bg-emerald-950/80 border border-emerald-700/50 text-emerald-400">
                <MonitorSpeaker className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-mono font-bold text-white uppercase">Oscilloscope Probe: {COMPONENT_DETAILS[scopeComponent].name}</h3>
                <span className="text-[11px] font-mono text-slate-400">{COMPONENT_DETAILS[scopeComponent].partNumber}</span>
              </div>
            </div>
            <div className="p-1 rounded-xl bg-black border border-slate-800">
              <OscilloscopeWave
                waveform={COMPONENT_DETAILS[scopeComponent].scopeWaveform}
                color={COMPONENT_DETAILS[scopeComponent].ledColor}
                amplitude={scopeComponent === 'lm393' ? telemetry.rpm / 2400 : scopeComponent === 'acs712' ? telemetry.currentA / 5 : scopeComponent === 'mpu6050' ? telemetry.vibrationG / 4 : 0.8}
                frequency={scopeComponent === 'lm393' ? 1 + telemetry.rpm / 700 : scopeComponent === 'mpu6050' ? 1 + telemetry.vibrationG : 1}
              />
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-[10px] font-mono text-center">
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800"><div className="text-slate-500">CH1 Volt/Div</div><div className="text-white font-bold">{COMPONENT_DETAILS[scopeComponent].voltage}</div></div>
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800"><div className="text-slate-500">Timebase</div><div className="text-emerald-400 font-bold">50 ms/div</div></div>
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800"><div className="text-slate-500">Trigger</div><div className="text-cyan-400 font-bold">AUTO (Rising)</div></div>
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800"><div className="text-slate-500">Probe Attn</div><div className="text-white font-bold">1× High-Z</div></div>
            </div>
          </div>
        </div>
      )}

      {/* ─── TOP CONTROL BAR ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-500/40 text-cyan-400 shadow-inner">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">IoT Hardware Prototype Workbench</h2>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300">v5.0 ACADEMIC</span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Fritzing Rig · IEEE Schematic · Pinout Matrix · FreeRTOS Firmware · DMM Multimeter
            </p>
          </div>
        </div>

        {/* View Switcher & Action Tools */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Audio Whine Toggle */}
          <button
            id="btn-toggle-audio"
            onClick={() => setSoundEnabled(!soundEnabled)}
            title="Toggle realistic motor frequency synthesizer sound"
            className={`p-2 rounded-xl border text-xs font-mono flex items-center gap-1.5 transition-all ${
              soundEnabled ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-md shadow-cyan-500/20' : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Audio ON' : 'Audio OFF'}</span>
          </button>

          {/* DMM Multimeter Tool Toggle */}
          <button
            id="btn-toggle-dmm"
            onClick={() => setDmmActive(!dmmActive)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition-all ${
              dmmActive ? 'bg-amber-500/20 border-amber-500 text-amber-300 ring-2 ring-amber-500/30' : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            <Crosshair className="w-4 h-4 text-amber-400" />
            <span>{dmmActive ? 'Hide DMM Probe' : 'Multimeter Tool'}</span>
          </button>

          {/* WebSerial Connect USB Button */}
          <button
            id="btn-connect-usb"
            onClick={() => setActiveTab('flasher')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition-all ${
              activeTab === 'flasher'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                : 'bg-slate-800/80 border-slate-700 hover:bg-slate-700 text-slate-200'
            }`}
            title="Connect physical ESP32 over USB via WebSerial API"
          >
            <Usb className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Connect USB</span>
          </button>

          {/* Academic Lab Report Modal Button */}
          <button
            id="btn-open-report"
            onClick={() => setReportModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 hover:bg-slate-700 text-xs font-mono font-bold text-slate-200 transition-all"
            title="View & print comprehensive academic engineering report"
          >
            <FileText className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Lab Report</span>
          </button>

          {/* SVG Vector Snapshot */}
          <button
            id="btn-export-svg"
            onClick={handleScreenshot}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 hover:bg-slate-700 text-xs font-mono font-bold text-slate-200 transition-all"
            title="Download vector SVG schematic for thesis reports and presentation slides"
          >
            <Camera className="w-4 h-4 text-blue-400" />
            <span className="hidden sm:inline">Export SVG</span>
          </button>

          {/* Presentation Slide-Show Mode */}
          <button
            id="btn-present-mode"
            onClick={() => setPresentMode(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-mono font-bold shadow-lg shadow-purple-600/30 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            <span>Present Rig</span>
          </button>

          {/* Mode Switch: Live Stream vs Hardware Lab */}
          <div className="flex items-center p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono">
            <button
              id="btn-mode-live"
              onClick={() => setIsManualMode(false)}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all ${!isManualMode ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
            >
              Live Twin
            </button>
            <button
              id="btn-mode-lab"
              onClick={() => setIsManualMode(true)}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all ${isManualMode ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
            >
              Hardware Lab
            </button>
          </div>

          {/* Asset Picker */}
          <select
            id="select-asset"
            value={selectedAssetId}
            onChange={(e) => setSelectedAssetId(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-cyan-300 font-bold focus:outline-none focus:border-cyan-500"
          >
            {assets.map(a => (
              <option key={a.asset_id} value={a.asset_id}>
                Asset {a.asset_id} ({a.line.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── WORKBENCH VIEW SWITCHER TABS & WIRE FILTER ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs font-mono">
        {/* 5 Main Views */}
        <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            id="btn-view-3d"
            onClick={() => setWorkbenchView('3d')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
              workbenchView === '3d' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>3D Digital Twin</span>
          </button>
          <button
            id="btn-view-breadboard"
            onClick={() => setWorkbenchView('breadboard')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
              workbenchView === 'breadboard' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>2D Breadboard</span>
          </button>
          <button
            id="btn-view-wiring"
            onClick={() => setWorkbenchView('wiring')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
              workbenchView === 'wiring' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MousePointer className="w-3.5 h-3.5 text-amber-400" />
            <span>Wiring Lab (Drag & Drop)</span>
          </button>
          <button
            id="btn-view-schematic"
            onClick={() => setWorkbenchView('schematic')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
              workbenchView === 'schematic' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Binary className="w-3.5 h-3.5" />
            <span>Circuit Schematic (IEEE)</span>
          </button>
          <button
            id="btn-view-pinout"
            onClick={() => setWorkbenchView('pinout')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
              workbenchView === 'pinout' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Pinout & Wiring Matrix</span>
          </button>
          <button
            id="btn-view-firmware"
            onClick={() => setWorkbenchView('firmware')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
              workbenchView === 'firmware' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>ESP32 Firmware (C++)</span>
          </button>
        </div>

        {/* Academic Scenario Preset Shortcuts */}
        <div className="flex items-center gap-1 overflow-x-auto py-1">
          <span className="text-[10px] text-amber-400 font-bold uppercase mr-1 flex items-center gap-1">
            <Play className="w-3 h-3 text-amber-400" /> Presets:
          </span>
          {[
            { id: 'nominal', label: '🟢 Nominal CNC', action: () => applyPresetScenario('nominal') },
            { id: 'bearing', label: '🟠 Bearing Wear', action: () => applyPresetScenario('bearing') },
            { id: 'jammed', label: '🛑 Jammed Stall (Trip)', action: () => applyPresetScenario('jammed') },
            { id: 'thermal', label: '🔥 Thermal Crisis', action: () => applyPresetScenario('thermal') },
            { id: 'wifi', label: '📡 Wi-Fi Drop', action: () => applyPresetScenario('wifi') },
          ].map(p => (
            <button
              key={p.id}
              onClick={p.action}
              className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-900 border border-slate-800 text-slate-300 hover:border-cyan-500 hover:text-cyan-300 whitespace-nowrap transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── MAIN 2-COLUMN LAYOUT ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* ─── LEFT COLUMN: WORKBENCH RIG OR SCHEMATIC OR PINOUT OR FIRMWARE (7 COLS) ─── */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">

            {/* Status Header Bar */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className={`w-3 h-3 rounded-full ${!benchPowerOn ? 'bg-slate-600' : relayTripped ? 'bg-rose-500 animate-ping' : telemetry.risk >= 0.55 ? 'bg-amber-400 animate-bounce' : 'bg-emerald-400 animate-pulse'}`} />
                <span className="text-xs font-mono font-bold text-white tracking-wider">
                  {workbenchView === '3d'
                    ? '3D INTERACTIVE DIGITAL TWIN (WEBGL)'
                    : workbenchView === 'breadboard'
                    ? 'PHYSICAL BREADBOARD LAB RIG'
                    : workbenchView === 'wiring'
                    ? 'INTERACTIVE BREADBOARD WIRING & ELECTRICAL RULE CHECK (ERC)'
                    : workbenchView === 'schematic'
                    ? 'IEEE CIRCUIT SCHEMATIC & GALVANIC ISOLATION'
                    : workbenchView === 'pinout'
                    ? 'ACADEMIC PINOUT & INTERCONNECT MATRIX'
                    : 'ESP32 DUAL-CORE FREERTOS C++ FIRMWARE'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-lg border" style={{ background: 'rgba(15,23,42,0.8)', borderColor: telemetry.tempC > 40 ? '#ef4444' : '#065f46', color: telemetry.tempC > 40 ? '#f87171' : '#34d399' }}>
                  🌡️ {telemetry.tempC.toFixed(1)}°C
                </span>
                <span className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg border ${!benchPowerOn ? 'bg-slate-800 border-slate-700 text-slate-400' : relayTripped ? 'bg-rose-950 border-rose-700 text-rose-300' : 'bg-emerald-950 border-emerald-800 text-emerald-300'}`}>
                  {!benchPowerOn ? '⏻ POWER ISOLATED' : relayTripped ? '🛑 RELAY CUTOFF' : '⚡ RAILS ACTIVE'}
                </span>
              </div>
            </div>

            {/* ── VIEW 0: 3D INTERACTIVE DIGITAL TWIN (WEBGL) ── */}
            {workbenchView === '3d' && (
              <div className="my-3">
                <MachinePrototype3D
                  telemetry={telemetry}
                  benchPowerOn={benchPowerOn}
                  relayTripped={relayTripped}
                  wifiSignal={wifiSignal}
                  selectedComponentId={selectedComponentId}
                  onSelectComponent={(id) => setSelectedComponentId(id)}
                  wireBusFilter={wireBusFilter}
                />
              </div>
            )}

            {/* ── VIEW 1: VIRTUAL BREADBOARD RIG ── */}
            {workbenchView === 'breadboard' && (
              <div ref={workbenchRef} className="relative my-3 rounded-xl border border-slate-800/90 overflow-hidden bg-[#070b12] p-2 shadow-inner">
                <svg viewBox="0 0 840 460" className="w-full h-auto max-h-[440px] select-none">
                  <defs>
                    <linearGradient id="bbBody" x1="0" y1="0" x2="0" y2="100%">
                      <stop offset="0%" stopColor="#f8fafc" />
                      <stop offset="100%" stopColor="#e2e8f0" />
                    </linearGradient>
                    <linearGradient id="mcuPcb" x1="0" y1="0" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#1e293b" />
                      <stop offset="100%" stopColor="#0f172a" />
                    </linearGradient>
                    <linearGradient id="rfShield" x1="0" y1="0" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#94a3b8" />
                      <stop offset="35%" stopColor="#f1f5f9" />
                      <stop offset="100%" stopColor="#64748b" />
                    </linearGradient>
                    <linearGradient id="motorBody" x1="0" y1="0" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#334155" />
                      <stop offset="25%" stopColor="#64748b" />
                      <stop offset="70%" stopColor="#475569" />
                      <stop offset="100%" stopColor="#1e293b" />
                    </linearGradient>
                    <filter id="neonGlow">
                      <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#38bdf8" floodOpacity="0.85" />
                    </filter>
                    <filter id="redGlow">
                      <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#ef4444" floodOpacity="0.8" />
                    </filter>
                    <filter id="greenGlow">
                      <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#22c55e" floodOpacity="0.8" />
                    </filter>
                    <filter id="orangeGlow">
                      <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#f97316" floodOpacity="0.8" />
                    </filter>
                    <filter id="purpleGlow">
                      <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#a855f7" floodOpacity="0.8" />
                    </filter>
                  </defs>

                  {/* Dark Workbench Mat Background */}
                  <rect x="0" y="0" width="840" height="460" fill="#060a12" />
                  <g stroke="#101927" strokeWidth="1" opacity="0.65">
                    {[40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440, 480, 520, 560, 600, 640, 680, 720, 760, 800].map(x => (
                      <line key={x} x1={x} y1="0" x2={x} y2="460" />
                    ))}
                    {[40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440].map(y => (
                      <line key={y} x1="0" y1={y} x2={840} y2={y} />
                    ))}
                  </g>

                  {/* ── BREADBOARD ASSEMBLY ── */}
                  <g transform="translate(18, 20)">
                    {/* Breadboard Base Body */}
                    <rect x="0" y="0" width="530" height="420" rx="12" fill="url(#bbBody)" stroke="#cbd5e1" strokeWidth="2.5" filter="drop-shadow(0 8px 16px rgba(0,0,0,0.65))" />
                    
                    {/* Top Power Rails */}
                    <line x1="25" y1="18" x2="505" y2="18" stroke="#ef4444" strokeWidth="2" />
                    <line x1="25" y1="30" x2="505" y2="30" stroke="#3b82f6" strokeWidth="2" />
                    <text x="12" y="21" fill="#ef4444" fontSize="8" fontFamily="monospace" fontWeight="bold">+</text>
                    <text x="12" y="33" fill="#3b82f6" fontSize="8" fontFamily="monospace" fontWeight="bold">-</text>

                    {/* Bottom Power Rails */}
                    <line x1="25" y1="392" x2="505" y2="392" stroke="#ef4444" strokeWidth="2" />
                    <line x1="25" y1="404" x2="505" y2="404" stroke="#3b82f6" strokeWidth="2" />
                    <text x="12" y="395" fill="#ef4444" fontSize="8" fontFamily="monospace" fontWeight="bold">+</text>
                    <text x="12" y="407" fill="#3b82f6" fontSize="8" fontFamily="monospace" fontWeight="bold">-</text>

                    {/* Center Divider Trench */}
                    <rect x="30" y="206" width="470" height="8" fill="#94a3b8" opacity="0.4" rx="2" />

                    {/* Tie-Point Pin Matrix (Columns & Rows) */}
                    <g fill="#475569" opacity="0.38">
                      {[40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340, 360, 380, 400, 420, 440, 460, 480, 500].map(cx => (
                        <g key={cx}>
                          {/* Upper Bank (a..e) */}
                          {[52, 72, 92, 112, 132, 152, 172, 192].map(cy => (
                            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" />
                          ))}
                          {/* Lower Bank (f..j) */}
                          {[228, 248, 268, 288, 308, 328, 348, 368].map(cy => (
                            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.7" />
                          ))}
                        </g>
                      ))}
                    </g>

                    {/* Column Coordinates (1..24) */}
                    <g fill="#94a3b8" fontSize="6.5" fontFamily="monospace" opacity="0.65">
                      {[1, 5, 10, 15, 20].map(c => (
                        <text key={c} x={40 + (c - 1) * 20} y="44" textAnchor="middle">{c}</text>
                      ))}
                    </g>

                    {/* Physical 4.7kΩ Pullup Resistor for OneWire Bus */}
                    <g transform="translate(340, 150)">
                      <line x1="0" y1="0" x2="20" y2="0" stroke="#cbd5e1" strokeWidth="1.5" />
                      <rect x="4" y="-3.5" width="12" height="7" rx="1.5" fill="#fde68a" stroke="#d97706" strokeWidth="0.8" />
                      {/* Color bands: Yellow, Violet, Red, Gold */}
                      <line x1="6" y1="-3.5" x2="6" y2="3.5" stroke="#eab308" strokeWidth="1" />
                      <line x1="8" y1="-3.5" x2="8" y2="3.5" stroke="#a855f7" strokeWidth="1" />
                      <line x1="10" y1="-3.5" x2="10" y2="3.5" stroke="#ef4444" strokeWidth="1" />
                      <line x1="13" y1="-3.5" x2="13" y2="3.5" stroke="#ca8a04" strokeWidth="1" />
                      <text x="10" y="10" textAnchor="middle" fill="#64748b" fontSize="5" fontFamily="monospace">4.7kΩ</text>
                    </g>
                  </g>

                  {/* ── COMPONENT 1: MB102 BREADBOARD POWER MODULE ── */}
                  <g transform="translate(28, 35)" onClick={() => setSelectedComponentId('mb102')} className="cursor-pointer">
                    <rect x="0" y="0" width="56" height="390" rx="6" fill="#1e293b" stroke={selectedComponentId === 'mb102' ? '#38bdf8' : '#334155'} strokeWidth={selectedComponentId === 'mb102' ? 2.5 : 1.2} filter={selectedComponentId === 'mb102' ? 'url(#neonGlow)' : undefined} />
                    {/* DC Barrel Jack */}
                    <rect x="8" y="10" width="40" height="32" rx="3" fill="#0f172a" stroke="#64748b" />
                    <circle cx="28" cy="26" r="6" fill="#334155" stroke="#facc15" strokeWidth="1.5" />
                    <text x="28" y="52" textAnchor="middle" fill="#94a3b8" fontSize="6" fontFamily="monospace">9-12V IN</text>
                    {/* Power Switch */}
                    <rect x="14" y="65" width="28" height="24" rx="2" fill="#0f172a" stroke="#475569" />
                    <rect x="18" y="69" width="20" height="16" rx="1.5" fill={benchPowerOn ? '#ef4444' : '#64748b'} />
                    {/* Power LED */}
                    <circle cx="28" cy="105" r="4" fill={benchPowerOn ? '#22c55e' : '#334155'} filter={benchPowerOn ? 'url(#greenGlow)' : undefined} />
                    <text x="28" y="120" textAnchor="middle" fill="#86efac" fontSize="6" fontFamily="monospace">5V/3.3V</text>
                    {/* AMS1117 Regulators */}
                    <rect x="12" y="140" width="32" height="22" rx="2" fill="#0f172a" />
                    <text x="28" y="154" textAnchor="middle" fill="#cbd5e1" fontSize="5.5" fontFamily="monospace">AMS1117</text>
                    <rect x="12" y="175" width="32" height="22" rx="2" fill="#0f172a" />
                    <text x="28" y="189" textAnchor="middle" fill="#cbd5e1" fontSize="5.5" fontFamily="monospace">3.3V REG</text>
                    <text x="28" y="240" textAnchor="middle" fill="#64748b" fontSize="7" fontFamily="monospace" transform="rotate(-90 28 240)">MB102 LAB SUPPLY</text>
                  </g>

                  {/* ── COMPONENT 2: ESP32 DEVKIT V1 (MCU) ── */}
                  <g transform="translate(230, 80)" onClick={() => setSelectedComponentId('esp32')} className="cursor-pointer">
                    <rect x="0" y="0" width="105" height="195" rx="6" fill="url(#mcuPcb)" stroke={selectedComponentId === 'esp32' ? '#38bdf8' : '#334155'} strokeWidth={selectedComponentId === 'esp32' ? 2.5 : 1.5} filter={selectedComponentId === 'esp32' ? 'url(#neonGlow)' : undefined} />
                    {/* Dual 15-Pin Black Header Strips */}
                    <rect x="2" y="8" width="9" height="180" fill="#0f172a" stroke="#334155" strokeWidth="0.8" />
                    <rect x="94" y="8" width="9" height="180" fill="#0f172a" stroke="#334155" strokeWidth="0.8" />
                    {/* Metal RF Shield */}
                    <rect x="18" y="48" width="70" height="74" rx="4" fill="url(#rfShield)" stroke="#cbd5e1" strokeWidth="1" />
                    <text x="53" y="80" textAnchor="middle" fill="#0f172a" fontSize="8.5" fontFamily="monospace" fontWeight="bold">ESP-WROOM-32</text>
                    <text x="53" y="93" textAnchor="middle" fill="#334155" fontSize="7" fontFamily="monospace">Wi-Fi + BLE SoC</text>
                    {/* Micro-USB Port */}
                    <rect x="37" y="-6" width="31" height="13" rx="2.5" fill="#94a3b8" stroke="#475569" />
                    {/* Dual Buttons (EN / BOOT) */}
                    <rect x="18" y="16" width="10" height="10" rx="1.5" fill="#334155" stroke="#64748b" />
                    <rect x="77" y="16" width="10" height="10" rx="1.5" fill="#334155" stroke="#64748b" />
                    <text x="23" y="13" textAnchor="middle" fill="#64748b" fontSize="5" fontFamily="monospace">EN</text>
                    <text x="82" y="13" textAnchor="middle" fill="#64748b" fontSize="5" fontFamily="monospace">BOOT</text>
                    {/* Status LEDs (Power & MQTT) */}
                    <circle cx="23" cy="34" r="3" fill={benchPowerOn ? '#ef4444' : '#334155'} filter={benchPowerOn ? 'url(#redGlow)' : undefined} />
                    <circle cx="82" cy="34" r="3" fill={benchPowerOn && wifiSignal ? '#3b82f6' : '#334155'} className={benchPowerOn && wifiSignal ? 'animate-ping' : ''} />
                    <text x="82" y="44" textAnchor="middle" fill="#93c5fd" fontSize="5.5" fontFamily="monospace">MQTT</text>
                    {/* Silkscreen Pin Labels */}
                    <g fill="#94a3b8" fontSize="5.5" fontFamily="monospace">
                      <text x="14" y="60">21</text>
                      <text x="14" y="80">22</text>
                      <text x="14" y="100">34</text>
                      <text x="14" y="120">18</text>
                      <text x="14" y="140">4</text>
                      <text x="14" y="160">26</text>
                      <text x="91" y="60" textAnchor="end">VIN</text>
                      <text x="91" y="80" textAnchor="end">GND</text>
                      <text x="91" y="100" textAnchor="end">3V3</text>
                    </g>
                    {/* PCB Silkscreen Title */}
                    <text x="53" y="152" textAnchor="middle" fill="#10b981" fontSize="9" fontFamily="monospace" fontWeight="bold">ESP32 DevKit</text>
                    <text x="53" y="164" textAnchor="middle" fill="#64748b" fontSize="6.5" fontFamily="monospace">Xtensa Dual-Core</text>
                  </g>

                  {/* ── COMPONENT 3: 0.96″ I2C OLED DISPLAY ── */}
                  <g transform="translate(100, 60)" onClick={() => setSelectedComponentId('oled')} className="cursor-pointer">
                    <rect x="0" y="0" width="105" height="125" rx="5" fill="#1e3a8a" stroke={selectedComponentId === 'oled' ? '#38bdf8' : '#3b82f6'} strokeWidth={selectedComponentId === 'oled' ? 2.5 : 1.2} filter={selectedComponentId === 'oled' ? 'url(#neonGlow)' : undefined} />
                    {/* 4 Header Pins */}
                    <rect x="18" y="-6" width="68" height="9" fill="#0f172a" />
                    <text x="52" y="10" textAnchor="middle" fill="#bfdbfe" fontSize="6" fontFamily="monospace">GND VCC SCL SDA</text>
                    {/* Glass OLED Panel */}
                    <rect x="8" y="18" width="89" height="98" rx="3" fill="#030712" stroke="#1d4ed8" strokeWidth="1.5" />
                    {/* Yellow Status Bar Top */}
                    <rect x="8" y="18" width="89" height="14" fill="#172554" />
                    <text x="12" y="28" fill="#facc15" fontSize="7" fontFamily="monospace" fontWeight="bold">ESP32 IOT LAB RIG</text>
                    {/* Live Cyan Telemetry Screen */}
                    <g fill="#38bdf8" fontFamily="monospace" fontSize="7.5">
                      <text x="12" y="44">RPM: {telemetry.rpm}</text>
                      <text x="12" y="56">TQ: {telemetry.torque.toFixed(1)}Nm</text>
                      <text x="12" y="68">T: {telemetry.tempC.toFixed(1)}°C</text>
                      <text x="12" y="80">P: {telemetry.powerW.toFixed(0)}W</text>
                      <text x="12" y="94">VIB: {telemetry.vibrationG.toFixed(1)}g</text>
                      <text x="12" y="108" fill={relayTripped ? '#ef4444' : telemetry.risk >= 0.55 ? '#f59e0b' : '#34d399'} fontWeight="bold">
                        {relayTripped ? 'RELAY:OPEN' : telemetry.risk >= 0.55 ? 'WARN:RISK' : 'STATUS:OK'}
                      </text>
                    </g>
                  </g>

                  {/* ── COMPONENT 4: ACS712 CURRENT TRANSDUCER ── */}
                  <g transform="translate(100, 215)" onClick={() => setSelectedComponentId('acs712')} className="cursor-pointer">
                    <rect x="0" y="0" width="105" height="76" rx="5" fill="#065f46" stroke={selectedComponentId === 'acs712' ? '#38bdf8' : '#10b981'} strokeWidth={selectedComponentId === 'acs712' ? 2.5 : 1.2} filter={selectedComponentId === 'acs712' ? 'url(#neonGlow)' : undefined} />
                    {/* High-Current Screw Terminal Block (Phoenix 2-Pin) */}
                    <rect x="8" y="10" width="34" height="28" fill="#1e293b" stroke="#475569" rx="2" />
                    <circle cx="18" cy="24" r="3.5" fill="#facc15" stroke="#b45309" />
                    <circle cx="32" cy="24" r="3.5" fill="#facc15" stroke="#b45309" />
                    <text x="70" y="24" textAnchor="middle" fill="#fff" fontSize="8" fontFamily="monospace" fontWeight="bold">ACS712</text>
                    <text x="70" y="36" textAnchor="middle" fill="#a7f3d0" fontSize="6.5" fontFamily="monospace">±5A Hall-IC</text>
                    {/* Live Current Value */}
                    <text x="52" y="58" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="monospace" fontWeight="bold">{telemetry.currentA.toFixed(2)} A</text>
                    {/* Scope button */}
                    <g onClick={e => { e.stopPropagation(); setScopeComponent('acs712'); }} className="cursor-pointer">
                      <rect x="74" y="52" width="24" height="14" rx="2" fill="#064e3b" stroke="#34d399" strokeWidth="1" />
                      <text x="86" y="62" textAnchor="middle" fill="#a7f3d0" fontSize="6" fontFamily="monospace">SCOPE</text>
                    </g>
                  </g>

                  {/* ── COMPONENT 5: MPU-6050 6-AXIS IMU (GY-521) ── */}
                  <g transform="translate(225, 295)" onClick={() => setSelectedComponentId('mpu6050')} className="cursor-pointer">
                    <rect x="0" y="0" width="88" height="64" rx="4" fill="#1e40af" stroke={selectedComponentId === 'mpu6050' ? '#38bdf8' : '#60a5fa'} strokeWidth={selectedComponentId === 'mpu6050' ? 2.5 : 1} filter={selectedComponentId === 'mpu6050' ? 'url(#neonGlow)' : undefined} />
                    {/* 8 Header Pins */}
                    <rect x="6" y="-5" width="76" height="8" fill="#0f172a" />
                    <text x="44" y="22" textAnchor="middle" fill="#fff" fontSize="8" fontFamily="monospace" fontWeight="bold">MPU-6050</text>
                    <text x="44" y="33" textAnchor="middle" fill="#bfdbfe" fontSize="6.5" fontFamily="monospace">GY-521 6-DOF</text>
                    {/* 3-Axis Orientation Indicator */}
                    <g transform="translate(20, 48)" stroke="#facc15" strokeWidth="1.2">
                      <line x1="0" y1="0" x2="16" y2="0" />
                      <line x1="0" y1="0" x2="0" y2="-12" />
                      <circle cx="0" cy="0" r="1.5" fill="#facc15" />
                    </g>
                    <text x="60" y="48" textAnchor="middle" fill={telemetry.vibrationG > 2.8 ? '#f87171' : '#facc15'} fontSize="9" fontFamily="monospace" fontWeight="bold">
                      {telemetry.vibrationG.toFixed(2)}g
                    </text>
                  </g>

                  {/* ── COMPONENT 6: 1-CHANNEL 5V RELAY MODULE ── */}
                  <g transform="translate(370, 260)" onClick={() => setSelectedComponentId('relay')} className="cursor-pointer">
                    <rect x="0" y="0" width="130" height="96" rx="5" fill="#0f172a" stroke={selectedComponentId === 'relay' ? '#38bdf8' : '#334155'} strokeWidth={selectedComponentId === 'relay' ? 2.5 : 1.2} filter={selectedComponentId === 'relay' ? 'url(#neonGlow)' : undefined} />
                    {/* Blue Songle Relay Box */}
                    <rect x="10" y="14" width="64" height="68" rx="3" fill="#0284c7" stroke="#38bdf8" strokeWidth="1" />
                    <text x="42" y="38" textAnchor="middle" fill="#fff" fontSize="8" fontFamily="monospace" fontWeight="bold">SONGLE</text>
                    <text x="42" y="50" textAnchor="middle" fill="#e0f2fe" fontSize="6.5" fontFamily="monospace">SRD-05VDC</text>
                    <text x="42" y="62" textAnchor="middle" fill="#bae6fd" fontSize="5.5" fontFamily="monospace">10A 250VAC</text>
                    {/* Optocoupler EL817 */}
                    <rect x="80" y="20" width="16" height="12" fill="#1e293b" stroke="#475569" rx="1" />
                    <text x="88" y="29" textAnchor="middle" fill="#94a3b8" fontSize="5" fontFamily="monospace">EL817</text>
                    {/* Dual Status LEDs */}
                    <circle cx="88" cy="46" r="3.5" fill="#ef4444" filter="url(#redGlow)" />
                    <circle cx="88" cy="62" r="3.5" fill={relayTripped ? '#ef4444' : '#10b981'} filter={relayTripped ? 'url(#redGlow)' : 'url(#greenGlow)'} className={relayTripped ? 'animate-ping' : ''} />
                    <text x="96" y="65" fill={relayTripped ? '#f87171' : '#34d399'} fontSize="6" fontFamily="monospace">{relayTripped ? 'CUT' : 'OK'}</text>
                    {/* 3-Pin Screw Terminals (NO, COM, NC) */}
                    <rect x="106" y="14" width="18" height="68" fill="#15803d" />
                    <circle cx="115" cy="26" r="3" fill="#facc15" />
                    <circle cx="115" cy="48" r="3" fill="#facc15" />
                    <circle cx="115" cy="70" r="3" fill="#facc15" />
                  </g>

                  {/* ── COMPONENT 7: 24V DC SPINDLE MOTOR & SENSOR RIG (RIGHT ENCLOSURE) ── */}
                  <g transform="translate(565, 30)" onClick={() => setSelectedComponentId('motor')} className="cursor-pointer">
                    <rect x="0" y="0" width="250" height="400" rx="10" fill="#111827" stroke={selectedComponentId === 'motor' ? '#38bdf8' : '#374151'} strokeWidth={selectedComponentId === 'motor' ? 2.5 : 1.8} filter={selectedComponentId === 'motor' ? 'url(#neonGlow)' : undefined} />
                    <text x="125" y="24" textAnchor="middle" fill="#cbd5e1" fontSize="10" fontFamily="monospace" fontWeight="bold">24V DC SPINDLE MOTOR RIG</text>
                    <line x1="20" y1="32" x2="230" y2="32" stroke="#1f2937" strokeWidth="1.5" />

                    {/* Motor Cylindrical Casing & Thermal Heatmap */}
                    <rect x="50" y="46" width="150" height="160" rx="10" fill="url(#motorBody)" stroke="#94a3b8" strokeWidth="2.5" />
                    <rect x="50" y="46" width="150" height="160" rx="10" fill={`rgba(${thermalRgb}, ${thermalAlpha})`} />
                    {/* Ventilation Slots */}
                    {[72, 98, 124, 150, 176].map(y => (
                      <line key={y} x1="62" y1={y} x2="188" y2={y} stroke="#0f172a" strokeWidth="2.5" />
                    ))}

                    {/* DS18B20 Waterproof Stator Probe (Clamped to motor) */}
                    <g onClick={e => { e.stopPropagation(); setSelectedComponentId('ds18b20'); }}>
                      <rect x="42" y="142" width="166" height="16" rx="3" fill={telemetry.tempC > 40 ? '#dc2626' : '#b45309'} stroke={selectedComponentId === 'ds18b20' ? '#fff' : '#0f172a'} strokeWidth={1.5} />
                      <text x="125" y="154" textAnchor="middle" fill="#fff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                        DS18B20 CLAMP: {telemetry.tempC.toFixed(1)}°C
                      </text>
                      <circle cx="196" cy="150" r="3.5" fill={telemetry.tempC > 40 ? '#ef4444' : '#a855f7'} filter={telemetry.tempC > 40 ? 'url(#redGlow)' : 'url(#purpleGlow)'} className="animate-pulse" />
                    </g>

                    {/* Steel Spindle Shaft */}
                    <rect x="115" y="206" width="20" height="50" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.5" />

                    {/* Slotted Optical Encoder Disc (8 Slots, Spinning) */}
                    <g transform={`translate(125, 275) rotate(${motorRotation})`}>
                      <circle r="44" fill="#334155" stroke="#94a3b8" strokeWidth="2.2" />
                      {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
                        <line key={a} x1={Math.cos(a * Math.PI / 180) * 18} y1={Math.sin(a * Math.PI / 180) * 18} x2={Math.cos(a * Math.PI / 180) * 40} y2={Math.sin(a * Math.PI / 180) * 40} stroke="#f8fafc" strokeWidth="4.2" strokeLinecap="round" />
                      ))}
                      <circle r="12" fill="#0f172a" stroke="#cbd5e1" strokeWidth="1" />
                    </g>

                    {/* LM393 Optical Slotted Gate Sensor Module */}
                    <g transform={`translate(150, 252)`} onClick={e => { e.stopPropagation(); setSelectedComponentId('lm393'); }}>
                      <rect x="0" y="0" width="64" height="46" rx="3" fill="#1e3a8a" stroke={selectedComponentId === 'lm393' ? '#38bdf8' : '#3b82f6'} strokeWidth={selectedComponentId === 'lm393' ? 2.5 : 1} />
                      <rect x="-10" y="12" width="18" height="22" fill="#0f172a" />
                      {/* Active IR beam */}
                      <line x1="-10" y1="23" x2="8" y2="23" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="2 1" />
                      <circle cx="20" cy="18" r="3" fill={telemetry.rpm > 0 ? '#f97316' : '#334155'} filter={telemetry.rpm > 0 ? 'url(#orangeGlow)' : undefined} className={telemetry.rpm > 0 ? 'animate-ping' : ''} />
                      <text x="36" y="34" fill="#93c5fd" fontSize="7.5" fontFamily="monospace">LM393</text>
                      <text x="36" y="42" fill="#f97316" fontSize="6.5" fontFamily="monospace">{telemetry.rpm}RPM</text>
                    </g>

                    {/* Impeller Cooling Fan Blade */}
                    <g transform={`translate(125, 345) rotate(${motorRotation * 1.5})`}>
                      <circle r="26" fill="#0f172a" stroke="#38bdf8" strokeWidth="1.5" />
                      <line x1="-22" y1="0" x2="22" y2="0" stroke="#38bdf8" strokeWidth="5" strokeLinecap="round" />
                      <line x1="0" y1="-22" x2="0" y2="22" stroke="#38bdf8" strokeWidth="5" strokeLinecap="round" />
                      <line x1="-15" y1="-15" x2="15" y2="15" stroke="#1d4ed8" strokeWidth="3" strokeLinecap="round" />
                      <line x1="15" y1="-15" x2="-15" y2="15" stroke="#1d4ed8" strokeWidth="3" strokeLinecap="round" />
                    </g>

                    {/* Live Metric Banner at Bottom of Rig */}
                    <text x="125" y="388" textAnchor="middle" fill="#38bdf8" fontSize="10" fontFamily="monospace" fontWeight="bold">
                      {telemetry.rpm} RPM · {telemetry.powerW.toFixed(0)} W · {telemetry.torque.toFixed(1)} Nm
                    </text>
                  </g>

                  {/* ── CURVED DUPONT JUMPER WIRES WITH ANIMATED PACKETS ── */}
                  <g>
                    {/* Wire 1: +5V Power Rail (Crimson Red) */}
                    <path
                      d="M 84,35 C 100,20 180,20 280,35"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth={isWireHighlighted('esp32', 'power') ? 3.5 : 1.2}
                      opacity={isWireHighlighted('esp32', 'power') ? 1 : 0.15}
                      strokeDasharray="6 4"
                      strokeDashoffset={-pulseOffset}
                    />

                    {/* Wire 2: GND Common Rail (Slate Dark) */}
                    <path
                      d="M 84,48 C 110,38 180,45 280,48"
                      fill="none"
                      stroke="#475569"
                      strokeWidth={isWireHighlighted('esp32', 'power') ? 3 : 1}
                      opacity={isWireHighlighted('esp32', 'power') ? 1 : 0.15}
                    />

                    {/* Wire 3: OLED SDA → GPIO 21 (Sky Blue Bezier) */}
                    <path
                      d="M 195,115 C 210,115 220,135 235,135"
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth={isWireHighlighted('oled', 'i2c') ? 3.5 : 1.2}
                      opacity={isWireHighlighted('oled', 'i2c') ? 1 : 0.15}
                      strokeDasharray="6 4"
                      strokeDashoffset={-pulseOffset}
                    />

                    {/* Wire 4: OLED SCL → GPIO 22 (Gold Yellow Bezier) */}
                    <path
                      d="M 195,128 C 210,128 220,150 235,150"
                      fill="none"
                      stroke="#eab308"
                      strokeWidth={isWireHighlighted('oled', 'i2c') ? 3.5 : 1.2}
                      opacity={isWireHighlighted('oled', 'i2c') ? 1 : 0.15}
                      strokeDasharray="6 4"
                      strokeDashoffset={-pulseOffset * 0.8}
                    />

                    {/* Wire 5: ACS712 OUT → GPIO 34 ADC (Emerald Green Bezier) */}
                    <path
                      d="M 205,245 C 220,245 225,175 235,175"
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth={isWireHighlighted('acs712', 'adc') ? 4 : 1.2}
                      opacity={isWireHighlighted('acs712', 'adc') ? 1 : 0.15}
                      strokeDasharray="8 4"
                      strokeDashoffset={-pulseOffset * 1.2}
                    />

                    {/* Wire 6: MPU-6050 SDA → GPIO 21 (Sky Blue) */}
                    <path
                      d="M 225,310 C 205,310 215,140 235,140"
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth={isWireHighlighted('mpu6050', 'i2c') ? 3 : 1}
                      opacity={isWireHighlighted('mpu6050', 'i2c') ? 1 : 0.15}
                      strokeDasharray="6 4"
                      strokeDashoffset={-pulseOffset * 0.9}
                    />

                    {/* Wire 7: Relay IN → GPIO 26 (Silver White Bezier) */}
                    <path
                      d="M 370,285 C 345,285 340,235 330,235"
                      fill="none"
                      stroke="#e2e8f0"
                      strokeWidth={isWireHighlighted('relay') ? 3.5 : 1.2}
                      opacity={isWireHighlighted('relay') ? 1 : 0.15}
                      strokeDasharray="6 4"
                      strokeDashoffset={-pulseOffset * 0.5}
                    />

                    {/* Wire 8: DS18B20 DQ → GPIO 4 (Orchid Purple Bezier across breadboard) */}
                    <path
                      d="M 607,150 C 480,110 390,215 330,215"
                      fill="none"
                      stroke="#a855f7"
                      strokeWidth={isWireHighlighted('ds18b20', 'onewire') ? 4 : 1.2}
                      opacity={isWireHighlighted('ds18b20', 'onewire') ? 1 : 0.15}
                      strokeDasharray="6 4"
                      strokeDashoffset={pulseOffset * 0.8}
                    />

                    {/* Wire 9: LM393 D0 → GPIO 18 Interrupt (Tangerine Orange Bezier) */}
                    <path
                      d="M 660,252 C 540,210 400,195 330,195"
                      fill="none"
                      stroke="#f97316"
                      strokeWidth={isWireHighlighted('lm393', 'interrupt') ? 4 : 1.2}
                      opacity={isWireHighlighted('lm393', 'interrupt') ? 1 : 0.15}
                      strokeDasharray="6 3"
                      strokeDashoffset={pulseOffset * 1.5}
                    />

                    {/* Wire 10: Heavy-Duty 24V Motor Switched Circuit (Thick Crimson Red) */}
                    <path
                      d="M 485,286 C 520,286 530,90 615,90"
                      fill="none"
                      stroke="#dc2626"
                      strokeWidth={isWireHighlighted('motor', 'motor') || isWireHighlighted('relay', 'motor') ? 5 : 2}
                      opacity={isWireHighlighted('motor', 'motor') || isWireHighlighted('relay', 'motor') ? 1 : 0.2}
                      strokeDasharray={relayTripped ? '0' : '10 4'}
                      strokeDashoffset={relayTripped ? 0 : -pulseOffset * 2}
                      filter={isWireHighlighted('motor', 'motor') ? 'url(#redGlow)' : undefined}
                    />
                  </g>

                  {/* ── TEST POINT TARGET BADGES (FOR MULTIMETER PROBING) ── */}
                  {dmmActive && (
                    <g>
                      {TEST_POINTS.map(tp => (
                        <g
                          key={tp.id}
                          transform={`translate(${tp.x}, ${tp.y})`}
                          onClick={e => { e.stopPropagation(); setActiveTestPoint(tp); }}
                          className="cursor-pointer group"
                        >
                          <circle r="10" fill={activeTestPoint.id === tp.id ? '#f59e0b' : '#0f172a'} stroke="#facc15" strokeWidth="2" className="animate-pulse" />
                          <circle r="4" fill="#facc15" />
                          <text x="14" y="4" fill="#fef08a" fontSize="7.5" fontFamily="monospace" fontWeight="bold">
                            {tp.label}
                          </text>
                        </g>
                      ))}
                    </g>
                  )}
                </svg>

                {/* Interactive Multimeter (DMM) Overlay Widget */}
                {dmmActive && (
                  <div className="absolute bottom-3 right-3 p-3 rounded-2xl bg-amber-950/90 border-2 border-amber-500/80 shadow-2xl backdrop-blur-md font-mono text-xs w-72">
                    <div className="flex justify-between items-center pb-2 border-b border-amber-700/50">
                      <div className="flex items-center gap-1.5 text-amber-300 font-bold">
                        <Crosshair className="w-4 h-4 text-amber-400" />
                        <span>FLUKE DMM 87V (PROBE)</span>
                      </div>
                      <button onClick={() => setDmmActive(false)} className="text-amber-400 hover:text-white">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* DMM Digital Display Screen */}
                    <div className="my-2 p-2.5 rounded-xl bg-[#0a110a] border border-amber-900/80 text-right">
                      <div className="text-[10px] text-amber-400/80 uppercase flex justify-between font-bold">
                        <span>AUTO RANGE</span>
                        <span>{activeTestPoint.domain}</span>
                      </div>
                      <div className="text-2xl font-bold text-amber-300 tracking-wider my-1">
                        {dmmReading.val} <span className="text-sm font-mono text-amber-400">{dmmReading.unit}</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-400 transition-all" style={{ width: `${Math.min(100, (parseFloat(dmmReading.val) / 24) * 100 || 50)}%` }} />
                      </div>
                    </div>

                    <div className="text-[10px] text-amber-200 mb-2 truncate">
                      Probe Point: <strong>{activeTestPoint.name}</strong>
                    </div>

                    {/* DMM Mode Selector Buttons */}
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { id: 'DC_V', label: 'V DC' },
                        { id: 'FREQ_HZ', label: 'Hz' },
                        { id: 'AC_V', label: 'mV AC' },
                        { id: 'CONT', label: 'Cont.' },
                      ].map(m => (
                        <button
                          key={m.id}
                          onClick={() => setDmmMode(m.id as any)}
                          className={`py-1 text-[10px] font-bold rounded ${dmmMode === m.id ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-slate-900 text-amber-300 hover:bg-slate-800'}`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── VIEW: INTERACTIVE BREADBOARD WIRING & ERC (DRAG & DROP) ── */}
            {workbenchView === 'wiring' && (
              <div className="my-3">
                <InteractiveBreadboardWiring
                  onWiringStatusChange={(diag) => {
                    if (diag.shortCircuit || diag.overvoltage) {
                      setRelayTripped(true);
                    }
                  }}
                />
              </div>
            )}

            {/* ── VIEW 2: CIRCUIT SCHEMATIC (IEEE / IEC VECTOR DIAGRAM) ── */}
            {workbenchView === 'schematic' && (
              <div className="relative my-3 rounded-xl border border-slate-800 overflow-hidden bg-[#050811] p-3 text-xs font-mono">
                <div className="flex justify-between items-center text-[11px] text-slate-400 pb-2 border-b border-slate-800">
                  <span className="font-bold text-cyan-300 uppercase">Interactive Vector Schematic · IEEE Std 315-1975</span>
                  <span className="text-[10px] text-emerald-400 font-bold">2.1 kV Galvanic Barrier Active</span>
                </div>

                {/* SVG Vector Schematic Canvas */}
                <div className="my-2 bg-[#03060d] rounded-xl border border-slate-900 p-2 overflow-x-auto">
                  <svg viewBox="0 0 760 380" className="w-full h-auto min-w-[650px] select-none">
                    {/* Galvanic Isolation Barrier Line */}
                    <line x1="530" y1="20" x2="530" y2="360" stroke="#f43f5e" strokeWidth="2" strokeDasharray="6 4" />
                    <text x="535" y="35" fill="#f43f5e" fontSize="8" fontWeight="bold" fontFamily="monospace">
                      GALVANIC ISOLATION BARRIER (2.1 kVRMS)
                    </text>

                    {/* Low-Voltage Domain Label */}
                    <rect x="20" y="25" width="220" height="20" rx="3" fill="#0f172a" stroke="#1e293b" />
                    <text x="30" y="38" fill="#38bdf8" fontSize="8" fontWeight="bold" fontFamily="monospace">
                      LOW-VOLTAGE DOMAIN (3.3V / 5V DC)
                    </text>

                    {/* High-Voltage Domain Label */}
                    <rect x="545" y="25" width="200" height="20" rx="3" fill="#1e1b4b" stroke="#312e81" />
                    <text x="555" y="38" fill="#f43f5e" fontSize="8" fontWeight="bold" fontFamily="monospace">
                      INDUSTRIAL DOMAIN (24V DC / 5A)
                    </text>

                    {/* ESP32 IC Block */}
                    <g transform="translate(180, 80)">
                      <rect x="0" y="0" width="130" height="230" rx="4" fill="#0f172a" stroke="#38bdf8" strokeWidth="2" />
                      <text x="65" y="25" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold" fontFamily="monospace">U1: ESP32</text>
                      <text x="65" y="38" textAnchor="middle" fill="#94a3b8" fontSize="7" fontFamily="monospace">Xtensa Dual-Core</text>

                      {/* Pins */}
                      {[
                        { pin: 'GPIO21 (SDA)', y: 65, col: '#38bdf8' },
                        { pin: 'GPIO22 (SCL)', y: 85, col: '#eab308' },
                        { pin: 'GPIO34 (ADC)', y: 110, col: '#22c55e' },
                        { pin: 'GPIO18 (INT)', y: 135, col: '#f97316' },
                        { pin: 'GPIO4 (DQ)', y: 160, col: '#a855f7' },
                        { pin: 'GPIO26 (RLY)', y: 185, col: '#f8fafc' },
                        { pin: '3V3 / GND', y: 210, col: '#cbd5e1' },
                      ].map(p => (
                        <g key={p.pin}>
                          <line x1="-15" y1={p.y} x2="0" y2={p.y} stroke={p.col} strokeWidth="1.5" />
                          <circle cx="-15" cy={p.y} r="2" fill={p.col} />
                          <text x="8" y={p.y + 3} fill="#cbd5e1" fontSize="7" fontFamily="monospace">{p.pin}</text>
                        </g>
                      ))}
                    </g>

                    {/* Sensor Blocks Left */}
                    {/* 1. MPU-6050 & OLED I2C Bus */}
                    <g transform="translate(30, 80)">
                      <rect x="0" y="0" width="100" height="50" rx="3" fill="#0f172a" stroke="#38bdf8" strokeWidth="1.2" />
                      <text x="50" y="20" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold" fontFamily="monospace">U2: MPU-6050</text>
                      <text x="50" y="32" textAnchor="middle" fill="#38bdf8" fontSize="7" fontFamily="monospace">Addr: 0x68 (I2C)</text>
                      <line x1="100" y1="25" x2="165" y2="25" stroke="#38bdf8" strokeWidth="1.5" />
                      <line x1="165" y1="25" x2="165" y2="145" stroke="#38bdf8" strokeWidth="1.5" />
                      <line x1="165" y1="145" x2="180" y2="145" stroke="#38bdf8" strokeWidth="1.5" />
                    </g>

                    {/* 2. ACS712 Current Transducer Block */}
                    <g transform="translate(30, 150)">
                      <rect x="0" y="0" width="100" height="60" rx="3" fill="#064e3b" stroke="#22c55e" strokeWidth="1.2" />
                      <text x="50" y="20" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold" fontFamily="monospace">U3: ACS712</text>
                      <text x="50" y="32" textAnchor="middle" fill="#86efac" fontSize="7" fontFamily="monospace">±5A Hall Sensor</text>
                      {/* VOUT Wire to ESP32 */}
                      <line x1="100" y1="35" x2="180" y2="190" stroke="#22c55e" strokeWidth="1.5" />
                    </g>

                    {/* 3. LM393 Tachometer Block */}
                    <g transform="translate(30, 230)">
                      <rect x="0" y="0" width="100" height="50" rx="3" fill="#431407" stroke="#f97316" strokeWidth="1.2" />
                      <text x="50" y="20" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold" fontFamily="monospace">U4: LM393</text>
                      <text x="50" y="32" textAnchor="middle" fill="#fdba74" fontSize="7" fontFamily="monospace">Optical Comparator</text>
                      <line x1="100" y1="25" x2="180" y2="215" stroke="#f97316" strokeWidth="1.5" />
                    </g>

                    {/* 4. DS18B20 OneWire Temp Probe with Pullup */}
                    <g transform="translate(30, 300)">
                      <rect x="0" y="0" width="100" height="50" rx="3" fill="#3b0764" stroke="#a855f7" strokeWidth="1.2" />
                      <text x="50" y="20" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold" fontFamily="monospace">U5: DS18B20</text>
                      <text x="50" y="32" textAnchor="middle" fill="#d8b4fe" fontSize="7" fontFamily="monospace">1-Wire Digital DQ</text>
                      <line x1="100" y1="25" x2="180" y2="240" stroke="#a855f7" strokeWidth="1.5" />
                    </g>

                    {/* Optoisolator EL817 Block */}
                    <g transform="translate(380, 200)">
                      <rect x="0" y="0" width="90" height="80" rx="4" fill="#0f172a" stroke="#f8fafc" strokeWidth="1.5" />
                      <text x="45" y="22" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold" fontFamily="monospace">U6: EL817</text>
                      <text x="45" y="34" textAnchor="middle" fill="#94a3b8" fontSize="6.5" fontFamily="monospace">Optocoupler</text>

                      {/* Internal LED & Phototransistor Graphic */}
                      <circle cx="25" cy="52" r="6" fill="#ef4444" opacity="0.6" />
                      <line x1="40" y1="48" x2="52" y2="48" stroke="#facc15" strokeDasharray="2 1" />
                      <line x1="40" y1="56" x2="52" y2="56" stroke="#facc15" strokeDasharray="2 1" />
                      <circle cx="65" cy="52" r="6" fill="#38bdf8" opacity="0.6" />

                      {/* Input from GPIO 26 */}
                      <line x1="-70" y1="65" x2="0" y2="65" stroke="#f8fafc" strokeWidth="1.5" />
                    </g>

                    {/* Relay Driver Transistor Q1 & Flyback Diode D1 */}
                    <g transform="translate(560, 160)">
                      {/* Songle SRD-05VDC Box */}
                      <rect x="0" y="0" width="90" height="90" rx="4" fill="#0284c7" stroke="#38bdf8" strokeWidth="1.5" />
                      <text x="45" y="24" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold" fontFamily="monospace">K1: SONGLE</text>
                      <text x="45" y="36" textAnchor="middle" fill="#e0f2fe" fontSize="6.5" fontFamily="monospace">SRD-05VDC</text>
                      <text x="45" y="48" textAnchor="middle" fill="#bae6fd" fontSize="6" fontFamily="monospace">10A / 250VAC</text>

                      {/* Mechanical Switch Graphic */}
                      <circle cx="20" cy="68" r="3" fill="#facc15" />
                      <circle cx="70" cy="68" r="3" fill="#facc15" />
                      <line
                        x1="20"
                        y1="68"
                        x2="65"
                        y2={relayTripped ? "52" : "68"}
                        stroke={relayTripped ? "#ef4444" : "#22c55e"}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                      <text x="45" y="82" textAnchor="middle" fill={relayTripped ? "#ef4444" : "#86efac"} fontSize="6.5" fontWeight="bold" fontFamily="monospace">
                        {relayTripped ? "OPEN (TRIPPED)" : "CLOSED (ARMED)"}
                      </text>
                    </g>

                    {/* RS-775 24V Motor & Load Circuit */}
                    <g transform="translate(680, 175)">
                      <circle cx="30" cy="30" r="28" fill="#1e293b" stroke="#dc2626" strokeWidth="2" />
                      <text x="30" y="28" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="bold" fontFamily="monospace">M1</text>
                      <text x="30" y="42" textAnchor="middle" fill="#94a3b8" fontSize="7" fontFamily="monospace">24V DC</text>

                      {/* Power loop wire from relay contact */}
                      <line x1="-30" y1="30" x2="2" y2="30" stroke="#dc2626" strokeWidth="2.5" />
                    </g>

                    {/* 24V Supply Rail Top */}
                    <line x1="550" y1="70" x2="740" y2="70" stroke="#dc2626" strokeWidth="2.5" />
                    <text x="745" y="74" fill="#dc2626" fontSize="9" fontWeight="bold" fontFamily="monospace">+24V DC</text>
                    <line x1="560" y1="70" x2="560" y2="160" stroke="#dc2626" strokeWidth="2" />
                  </svg>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-300">
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-cyan-400 font-bold">Low-Voltage Digital Core (3.3V/5V):</span>
                    <p className="text-slate-400 text-[10px] mt-1 leading-snug">
                      Core 0 samples the ACS712 analog hall output via ADC1_CH6, while LM393 speed pulses fire hardware interrupts on GPIO 18. The Dallas 1-Wire bus utilizes an active 4.7kΩ pullup resistor on GPIO 4.
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-rose-400 font-bold">Industrial Galvanic Safety Loop (24V):</span>
                    <p className="text-slate-400 text-[10px] mt-1 leading-snug">
                      The high-power 24V spindle motor is electrically isolated via an EL817 optocoupler and 1N4007 flyback suppression diode. The Songle relay breaks the circuit in &lt;10ms upon GRU risk alerts.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── VIEW 3: PINOUT & WIRING MATRIX TABLE ── */}
            {workbenchView === 'pinout' && (
              <div className="my-3 rounded-xl border border-slate-800 overflow-x-auto bg-[#070b12] p-2 text-xs font-mono">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase">
                      <th className="p-2">Component</th>
                      <th className="p-2">Module Pin</th>
                      <th className="p-2">ESP32 GPIO</th>
                      <th className="p-2">Protocol / Signal</th>
                      <th className="p-2">Voltage</th>
                      <th className="p-2">Sampling / Processing</th>
                      <th className="p-2">Live Reading</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900 text-[11px]">
                    <tr className="hover:bg-slate-900/50">
                      <td className="p-2 font-bold text-white">ACS712 Current</td>
                      <td className="p-2 text-emerald-400 font-mono">OUT</td>
                      <td className="p-2 text-cyan-300 font-bold">GPIO 34</td>
                      <td className="p-2 text-slate-300">ADC1_CH6 (12-bit)</td>
                      <td className="p-2 text-slate-400">0 - 3.3V</td>
                      <td className="p-2 text-slate-400">100Hz EMA (α=0.3)</td>
                      <td className="p-2 text-emerald-400 font-bold">{telemetry.currentA.toFixed(2)}A ({telemetry.torque.toFixed(1)}Nm)</td>
                    </tr>
                    <tr className="hover:bg-slate-900/50">
                      <td className="p-2 font-bold text-white">LM393 Tachometer</td>
                      <td className="p-2 text-orange-400 font-mono">D0</td>
                      <td className="p-2 text-cyan-300 font-bold">GPIO 18</td>
                      <td className="p-2 text-slate-300">Hardware INT (Rising Edge)</td>
                      <td className="p-2 text-slate-400">3.3V Logic</td>
                      <td className="p-2 text-slate-400">Interrupt timer</td>
                      <td className="p-2 text-orange-400 font-bold">{telemetry.rpm} RPM</td>
                    </tr>
                    <tr className="hover:bg-slate-900/50">
                      <td className="p-2 font-bold text-white">DS18B20 Temp Probe</td>
                      <td className="p-2 text-purple-400 font-mono">DQ</td>
                      <td className="p-2 text-cyan-300 font-bold">GPIO 4</td>
                      <td className="p-2 text-slate-300">Dallas 1-Wire (4.7kΩ)</td>
                      <td className="p-2 text-slate-400">3.3V Logic</td>
                      <td className="p-2 text-slate-400">1.0 Hz (12-bit)</td>
                      <td className="p-2 text-purple-400 font-bold">{telemetry.tempC.toFixed(1)}°C ({telemetry.tempK.toFixed(1)}K)</td>
                    </tr>
                    <tr className="hover:bg-slate-900/50">
                      <td className="p-2 font-bold text-white">MPU-6050 IMU</td>
                      <td className="p-2 text-blue-400 font-mono">SDA / SCL</td>
                      <td className="p-2 text-cyan-300 font-bold">GPIO 21 / 22</td>
                      <td className="p-2 text-slate-300">I2C Fast Mode (400kHz)</td>
                      <td className="p-2 text-slate-400">3.3V Logic</td>
                      <td className="p-2 text-slate-400">Z-axis RMS acceleration</td>
                      <td className="p-2 text-blue-400 font-bold">{telemetry.vibrationG.toFixed(2)}g RMS</td>
                    </tr>
                    <tr className="hover:bg-slate-900/50">
                      <td className="p-2 font-bold text-white">SSD1306 OLED</td>
                      <td className="p-2 text-cyan-400 font-mono">SDA / SCL</td>
                      <td className="p-2 text-cyan-300 font-bold">GPIO 21 / 22</td>
                      <td className="p-2 text-slate-300">I2C Address 0x3C</td>
                      <td className="p-2 text-slate-400">3.3V Logic</td>
                      <td className="p-2 text-slate-400">4.0 Hz Framebuffer flush</td>
                      <td className="p-2 text-cyan-300 font-bold">128×64 Active</td>
                    </tr>
                    <tr className="hover:bg-slate-900/50">
                      <td className="p-2 font-bold text-white">Songle 5V Relay</td>
                      <td className="p-2 text-rose-400 font-mono">IN</td>
                      <td className="p-2 text-cyan-300 font-bold">GPIO 26</td>
                      <td className="p-2 text-slate-300">Optoisolated Digital OUT</td>
                      <td className="p-2 text-slate-400">3.3V Trigger</td>
                      <td className="p-2 text-slate-400">Edge Risk Trigger (&gt;55%)</td>
                      <td className="p-2 text-rose-400 font-bold">{relayTripped ? 'OPEN (TRIPPED)' : 'CLOSED (OK)'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* ── VIEW 4: ESP32 FREERTOS C++ FIRMWARE CODE ── */}
            {workbenchView === 'firmware' && (
              <div className="my-3 rounded-xl border border-slate-800 bg-[#040711] p-3 text-xs font-mono space-y-2">
                <div className="flex justify-between items-center pb-2 border-b border-slate-800 text-[11px]">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-white font-bold">firmware/src/main.cpp (FreeRTOS Dual-Core Architecture)</span>
                  </div>
                  <button
                    onClick={copyFirmware}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{codeCopied ? 'Copied!' : 'Copy C++'}</span>
                  </button>
                </div>

                <div className="h-80 overflow-y-auto bg-[#020409] p-3 rounded-lg border border-slate-900 text-[11px] text-slate-300 font-mono leading-relaxed select-text">
                  <pre className="text-slate-300">
                    {ESP32_FIRMWARE_CODE}
                  </pre>
                </div>

                <div className="flex justify-between text-[10px] text-slate-500 pt-1">
                  <span>Target: ESP32-WROOM-32 (Xtensa Dual-Core LX6)</span>
                  <span>Framework: Arduino-ESP32 / FreeRTOS v10.4</span>
                  <span className="text-emerald-400">● Core 0 (ADC/EMA) · Core 1 (MQTT)</span>
                </div>
              </div>
            )}

            {/* ── COMPONENT TECHNICAL DEEP-DIVE CARD ── */}
            {activeDetail && (
              <div className="p-3.5 bg-slate-950 rounded-xl border border-cyan-500/40 space-y-3 font-mono text-xs">
                <div className="flex flex-wrap justify-between items-center pb-2 border-b border-slate-800 gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full animate-pulse" style={{ backgroundColor: activeDetail.ledColor }} />
                    <span className="text-white font-bold text-xs uppercase">{activeDetail.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold">
                      {activeDetail.partNumber}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setScopeComponent(activeDetail.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/60 transition-all"
                    >
                      <ZoomIn className="w-3 h-3" /> Scope
                    </button>
                    <span className="text-[11px] font-bold text-emerald-400">
                      Live: {activeDetail.calibratedValue(telemetry)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                  {/* Pinout Column */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Hardware Pinout & Connections:</div>
                    <div className="space-y-1 bg-slate-900/50 p-2.5 rounded-lg border border-slate-800/80">
                      {activeDetail.pinout.map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-slate-300 text-[10.5px]">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                            <span className="font-bold text-white">{p.pin}</span>
                            <span className="text-slate-500">→</span>
                            <span className="text-cyan-300">{p.target}</span>
                          </div>
                          <span className="text-[9px] text-slate-500">{p.voltage}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Physics & Mathematical Formula Column */}
                  <div className="space-y-1.5 bg-slate-900/70 p-2.5 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Physical Principle & Math Formula:</div>
                    <p className="text-[10px] text-slate-300 leading-snug">{activeDetail.principle}</p>
                    <div className="text-[10.5px] text-amber-300 font-bold pt-1.5 border-t border-slate-800/80">
                      {activeDetail.formula}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── BENCH POWER & FAULT INJECTION CONTROLS ── */}
            <div className="mt-3 bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-3 font-mono">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setBenchPowerOn(!benchPowerOn)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md ${
                      benchPowerOn ? 'bg-emerald-500 text-slate-950 ring-2 ring-emerald-400 font-bold' : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    {benchPowerOn ? 'BENCH POWER: ON' : 'BENCH POWER: OFF'}
                  </button>

                  <button
                    onClick={() => setRelayTripped(!relayTripped)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      relayTripped ? 'bg-rose-600 text-white shadow-lg ring-2 ring-rose-400' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <AlertOctagon className="w-3.5 h-3.5" />
                    {relayTripped ? 'RESET RELAY TRIP' : 'TRIGGER RELAY TRIP'}
                  </button>
                </div>

                {/* Potentiometer Speed Control */}
                <div className="flex items-center gap-2 flex-1 max-w-xs">
                  <span className="text-[10px] text-slate-400 whitespace-nowrap">Pot Speed:</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={motorSpeedPct}
                    disabled={!isManualMode || !benchPowerOn}
                    onChange={e => setMotorSpeedPct(Number(e.target.value))}
                    className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                  <span className="text-xs font-bold text-cyan-400 w-10 text-right">{motorSpeedPct}%</span>
                </div>
              </div>

              {/* Hardware Lab Fault Injection Buttons */}
              {isManualMode && (
                <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider mr-1">⚡ Inject Faults:</span>
                  <button
                    onClick={() => setLoadMode(loadMode === 'heavy' ? 'nominal' : 'heavy')}
                    className={`px-2.5 py-1 rounded-lg font-bold border transition-colors ${loadMode === 'heavy' ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'}`}
                  >
                    {loadMode === 'heavy' ? '⚡ Heavy Load (66Nm)' : 'Heavy Torque'}
                  </button>
                  <button
                    onClick={() => setLoadMode(loadMode === 'jammed' ? 'nominal' : 'jammed')}
                    className={`px-2.5 py-1 rounded-lg font-bold border transition-colors ${loadMode === 'jammed' ? 'bg-rose-600 text-white border-rose-500' : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'}`}
                  >
                    {loadMode === 'jammed' ? '🛑 Jammed Rotor (84Nm)' : 'Jammed Rotor'}
                  </button>
                  <button
                    onClick={() => setThermalMode(thermalMode === 'overheat' ? 'normal' : 'overheat')}
                    className={`px-2.5 py-1 rounded-lg font-bold border transition-colors ${thermalMode === 'overheat' ? 'bg-rose-600 text-white border-rose-500' : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'}`}
                  >
                    {thermalMode === 'overheat' ? '🔥 Overheat (45°C)' : 'Fan Failure'}
                  </button>
                  <button
                    onClick={() => setVibrationFault(!vibrationFault)}
                    className={`px-2.5 py-1 rounded-lg font-bold border transition-colors ${vibrationFault ? 'bg-rose-600 text-white border-rose-500' : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'}`}
                  >
                    {vibrationFault ? '📳 Bearing Jitter (4.6g)' : 'Bearing Wear'}
                  </button>
                  <button
                    onClick={() => setWifiSignal(!wifiSignal)}
                    className={`px-2.5 py-1 rounded-lg font-bold border transition-colors ${!wifiSignal ? 'bg-amber-600 text-white border-amber-500' : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'}`}
                  >
                    {!wifiSignal ? '📡 WiFi Dropped' : 'Drop WiFi'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── RIGHT COLUMN: DIAGNOSTIC TABS & METRICS (5 COLS) ─── */}
        <div className="lg:col-span-5 space-y-3">
          {/* Tab Selection Header */}
          <div className="flex items-center gap-1 p-1 bg-slate-900/90 border border-slate-800 rounded-xl text-xs font-mono overflow-x-auto">
            {[
              { id: 'bench', label: 'Sensors', icon: <Activity className="w-3.5 h-3.5" /> },
              { id: 'flasher', label: 'WebSerial USB', icon: <Usb className="w-3.5 h-3.5 text-emerald-400" /> },
              { id: 'fft', label: 'FFT Spectrum', icon: <Waves className="w-3.5 h-3.5 text-cyan-400" /> },
              { id: 'scope', label: 'Scope', icon: <MonitorSpeaker className="w-3.5 h-3.5" /> },
              { id: 'serial', label: 'Serial', icon: <Terminal className="w-3.5 h-3.5" /> },
              { id: 'mqtt', label: 'MQTT', icon: <Radio className="w-3.5 h-3.5" /> },
              { id: 'sustainability', label: 'Carbon ROI', icon: <Leaf className="w-3.5 h-3.5 text-emerald-400" /> },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 min-w-[65px] flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg font-bold transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* ── TAB 1: SENSOR TRANSDUCER STATUS ── */}
          {activeTab === 'bench' && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3 font-mono">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800 text-xs">
                <span className="font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" /> Transducer Telemetry Matrix
                </span>
                <span className="text-[10px] text-slate-500">Node: ESP32-WROOM-32</span>
              </div>

              <div className="space-y-2 text-xs">
                {[
                  {
                    compId: 'lm393',
                    icon: <RotateCw className="w-4 h-4" />,
                    bg: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
                    label: 'LM393 Optical Speed',
                    sub: 'GPIO18 INT (8-slot disc)',
                    val: `${telemetry.rpm}`,
                    unit: 'RPM',
                    sub2: `${(telemetry.rpm * 8 / 60).toFixed(0)} Hz pulse stream`,
                    vc: 'text-orange-400',
                    spark: history.rpm,
                    sc: '#f97316',
                    warn: false,
                  },
                  {
                    compId: 'acs712',
                    icon: <Zap className="w-4 h-4" />,
                    bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                    label: 'ACS712 Current / Torque',
                    sub: 'GPIO34 ADC1_CH6 (Hall Effect)',
                    val: `${telemetry.torque.toFixed(1)}`,
                    unit: 'Nm',
                    sub2: `${telemetry.currentA.toFixed(2)}A · ${telemetry.powerW.toFixed(0)}W`,
                    vc: 'text-emerald-400',
                    spark: history.torque,
                    sc: '#22c55e',
                    warn: telemetry.torque > 60,
                  },
                  {
                    compId: 'ds18b20',
                    icon: <Thermometer className="w-4 h-4" />,
                    bg: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
                    label: 'DS18B20 Stator Temp',
                    sub: 'GPIO4 OneWire (Maxim Capsule)',
                    val: `${telemetry.tempC.toFixed(1)}`,
                    unit: '°C',
                    sub2: `${telemetry.tempK.toFixed(1)} K absolute`,
                    vc: telemetry.tempC > 40 ? 'text-rose-400' : 'text-purple-400',
                    spark: history.temp,
                    sc: '#a855f7',
                    warn: telemetry.tempC > 40,
                  },
                  {
                    compId: 'mpu6050',
                    icon: <Wrench className="w-4 h-4" />,
                    bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                    label: 'MPU-6050 IMU Vibration',
                    sub: 'I2C 0x68 (SDA:21 / SCL:22)',
                    val: `${telemetry.vibrationG.toFixed(2)}`,
                    unit: 'g RMS',
                    sub2: 'EMA α=0.30 filtered',
                    vc: telemetry.vibrationG > 2.8 ? 'text-rose-400' : 'text-blue-400',
                    spark: history.vib,
                    sc: '#60a5fa',
                    warn: telemetry.vibrationG > 2.8,
                  },
                ].map(item => (
                  <div
                    key={item.compId}
                    onClick={() => setSelectedComponentId(item.compId)}
                    className={`p-2.5 rounded-xl bg-slate-950 border flex items-center justify-between cursor-pointer hover:border-cyan-500 transition-colors ${
                      item.warn ? 'border-amber-700/60' : 'border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`p-2 rounded-lg border ${item.bg}`}>{item.icon}</div>
                      <div>
                        <div className="font-bold text-white text-[11px]">{item.label}</div>
                        <div className="text-[9px] text-slate-500">{item.sub}</div>
                        {item.warn && <div className="text-[9px] text-amber-400 font-bold mt-0.5">⚠ Threshold Exceeded</div>}
                      </div>
                    </div>
                    <div className="flex items-end gap-3">
                      <Sparkline data={item.spark} color={item.sc} height={26} />
                      <div className="text-right">
                        <div className={`text-base font-bold ${item.vc}`}>
                          {item.val} <span className="text-[10px] text-slate-500">{item.unit}</span>
                        </div>
                        <div className="text-[9px] text-slate-400">{item.sub2}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick Launch: FFT Vibration Spectrum Analyzer */}
              <div
                onClick={() => setActiveTab('fft')}
                className="p-2.5 rounded-xl bg-gradient-to-r from-cyan-950/40 via-blue-950/30 to-slate-950 border border-cyan-800/60 flex items-center justify-between cursor-pointer hover:border-cyan-400 hover:shadow-lg transition-all group"
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 group-hover:scale-105 transition-transform">
                    <Waves className="w-4 h-4 animate-pulse" />
                  </div>
                  <div>
                    <div className="font-bold text-white text-[11px] flex items-center gap-1.5">
                      <span>FFT Bearing Spectrum Analyzer</span>
                      <span className="px-1.5 py-0.2 rounded text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                        LIVE
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-400">
                      Harmonics: BPFI · BPFO · FTF · BSF · Kurtosis & Crest Factor
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-cyan-400 font-bold group-hover:translate-x-0.5 transition-transform">
                  <span>Open FFT</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* GRU Neural Network Risk Bar */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div className="flex justify-between items-center text-xs mb-2">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-cyan-400" /> GRU Neural Network Failure Risk
                  </span>
                  <div className="flex items-center gap-2">
                    <Sparkline data={history.risk} color={telemetry.risk >= 0.55 ? '#ef4444' : '#34d399'} height={20} />
                    <span className={`text-sm font-bold ${telemetry.risk >= 0.55 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {(telemetry.risk * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      telemetry.risk >= 0.55
                        ? 'bg-gradient-to-r from-rose-600 to-red-500'
                        : telemetry.risk >= 0.35
                        ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                        : 'bg-gradient-to-r from-emerald-500 to-green-400'
                    }`}
                    style={{ width: `${Math.min(100, telemetry.risk * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>0% (Nominal)</span>
                  <span className="text-amber-500 font-bold">Cutoff Threshold: 55%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: WEBSERIAL ESP32 HARDWARE FLASHER & LIVE TELEMETRY ── */}
          {activeTab === 'flasher' && (
            <WebSerialFlasher
              isBenchPowered={benchPowerOn && !relayTripped}
              onLiveHardwareTelemetry={(data) => {
                setHardwareTelemActive(true);
                setHardwareTelemData(data);
              }}
            />
          )}

          {/* ── TAB: MPU-6050 FFT SPECTRUM ANALYZER (BEARING FAULT FREQUENCIES) ── */}
          {activeTab === 'fft' && (
            <VibrationSpectrumAnalyzer
              rpm={telemetry.rpm}
              vibrationG={telemetry.vibrationG}
              isBearingWearActive={vibrationFault}
              onToggleBearingWear={(active) => setVibrationFault(active)}
              isPowered={benchPowerOn && !relayTripped}
            />
          )}

          {/* ── TAB 2: VIRTUAL OSCILLOSCOPE (4 CHANNELS) ── */}
          {activeTab === 'scope' && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3 font-mono">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs">
                <div className="flex items-center gap-2">
                  <MonitorSpeaker className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-white uppercase tracking-wider">Virtual Logic Analyzer (All 4 Channels)</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-bold">50 ms/div · AUTO TRIG</span>
              </div>
              <div className="space-y-3">
                {[
                  { id: 'acs712', label: 'CH1: ACS712 (Hall Current)', note: `Vout ≈ ${(2.5 + telemetry.currentA * 0.066).toFixed(2)}V` },
                  { id: 'lm393', label: 'CH2: LM393 (Tachometer D0)', note: `${(telemetry.rpm * 8 / 60).toFixed(0)} pulses/s` },
                  { id: 'ds18b20', label: 'CH3: DS18B20 (1-Wire DQ)', note: `12-bit ${telemetry.tempC.toFixed(1)}°C` },
                  { id: 'mpu6050', label: 'CH4: MPU-6050 (Vib Z-Axis)', note: `${telemetry.vibrationG.toFixed(2)}g RMS` },
                ].map(ch => (
                  <div key={ch.id} className="rounded-xl overflow-hidden border border-slate-800">
                    <div className="flex items-center justify-between px-2.5 py-1 bg-slate-950">
                      <span className="text-[10px] font-bold text-slate-300">{ch.label}</span>
                      <div className="flex items-center gap-2">
                        {ch.id === 'mpu6050' && (
                          <button
                            onClick={() => setActiveTab('fft')}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/40 font-bold flex items-center gap-1 transition-colors"
                          >
                            <Waves className="w-2.5 h-2.5" />
                            <span>FFT Spectrum</span>
                          </button>
                        )}
                        <span className="text-[10px] text-emerald-400 font-mono">{ch.note}</span>
                      </div>
                    </div>
                    <OscilloscopeWave
                      waveform={COMPONENT_DETAILS[ch.id].scopeWaveform}
                      color={COMPONENT_DETAILS[ch.id].ledColor}
                      amplitude={
                        ch.id === 'lm393'
                          ? telemetry.rpm / 2400
                          : ch.id === 'acs712'
                          ? telemetry.currentA / 5
                          : ch.id === 'mpu6050'
                          ? telemetry.vibrationG / 4
                          : 0.8
                      }
                      frequency={
                        ch.id === 'lm393'
                          ? 1 + telemetry.rpm / 700
                          : ch.id === 'mpu6050'
                          ? 1 + telemetry.vibrationG * 0.5
                          : 1
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-slate-500 font-mono flex justify-between">
                <span>Timebase: 50ms/div</span>
                <span>Volts: Calibrated 1×</span>
                <span className="text-emerald-400">● 4/4 Channels Locked</span>
              </div>
            </div>
          )}

          {/* ── TAB 3: ESP32 SERIAL MONITOR ── */}
          {activeTab === 'serial' && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-2.5 font-mono">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs">
                <div className="flex items-center gap-2 text-white font-bold">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span>ESP32 UART Monitor (115200 baud)</span>
                </div>
                <button onClick={() => setLogs([])} className="text-[10px] text-slate-500 hover:text-slate-300">
                  Clear
                </button>
              </div>
              <div ref={serialEndRef} className="h-80 bg-[#060a12] rounded-xl p-3 border border-slate-800 text-[11px] overflow-y-auto space-y-1">
                {logs.length === 0 ? (
                  <div className="text-slate-600 text-center py-14">Serial buffer listening on /dev/ttyUSB0...</div>
                ) : (
                  logs.map(log => (
                    <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                      <span className="text-slate-600 text-[10px] select-none flex-shrink-0">{log.time}</span>
                      <span
                        className={
                          log.type === 'WARN'
                            ? 'text-amber-400 font-bold'
                            : log.type === 'ERROR'
                            ? 'text-rose-400 font-bold'
                            : log.type === 'CUTOFF'
                            ? 'text-red-500 font-bold animate-pulse'
                            : log.type === 'MQTT'
                            ? 'text-purple-400'
                            : log.type === 'ADC'
                            ? 'text-emerald-300'
                            : log.type === 'EDGE'
                            ? 'text-cyan-300'
                            : 'text-slate-300'
                        }
                      >
                        {log.text}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1">
                <span>Port: /dev/ttyUSB0 (CP2102)</span>
                <span>115200 8N1</span>
                <span className="text-emerald-400">● RTS/DTR Active</span>
              </div>
            </div>
          )}

          {/* ── TAB 4: MQTT PROTOCOL INSPECTOR ── */}
          {activeTab === 'mqtt' && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3 font-mono">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-800 text-xs">
                <Radio className="w-4 h-4 text-purple-400" />
                <span className="font-bold text-white uppercase tracking-wider">MQTT Protocol Inspector</span>
                <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold border ${wifiSignal ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300' : 'bg-rose-950 border-rose-800 text-rose-400'}`}>
                  {wifiSignal ? '● Connected' : '○ Offline'}
                </span>
              </div>
              <div className="text-[10px] text-slate-400">
                Topic: <span className="text-purple-300 font-bold">factory/{liveAsset?.line || 'lineA'}/{selectedAssetId}/telemetry</span>
              </div>
              <div className="bg-[#060a12] rounded-xl p-3 border border-slate-800 text-[11px] space-y-0.5 font-mono overflow-x-auto">
                <div className="text-slate-500">{'{'}</div>
                {Object.entries(mqttPayload).map(([k, v]) => (
                  <div key={k} className="pl-4">
                    <span className="text-amber-300">"{k}"</span>
                    <span className="text-slate-500">: </span>
                    <span
                      className={
                        typeof v === 'number'
                          ? k.includes('risk') && (v as number) > 55
                            ? 'text-rose-400 font-bold'
                            : k.includes('temp')
                            ? 'text-purple-400'
                            : 'text-emerald-300'
                          : v === null
                          ? 'text-slate-600'
                          : v === 'OPEN'
                          ? 'text-rose-400 font-bold'
                          : 'text-cyan-300'
                      }
                    >
                      {v === null ? 'null' : typeof v === 'string' ? `"${v}"` : String(v)}
                    </span>
                  </div>
                ))}
                <div className="text-slate-500">{'}'}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                {[
                  { l: 'QoS Level', v: '0 (At Most Once)' },
                  { l: 'Payload Size', v: `~${JSON.stringify(mqttPayload).length} Bytes` },
                  { l: 'Pub Interval', v: '1000 ms (1.0 Hz)' },
                ].map(i => (
                  <div key={i.l} className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-slate-500">{i.l}</div>
                    <div className="font-bold text-white mt-0.5">{i.v}</div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-slate-500">
                Broker: <span className="text-slate-300">mosquitto:1883</span> · Client: <span className="text-slate-300">ESP32-{selectedAssetId}</span>
              </div>
            </div>
          )}

          {/* ── TAB 5: SUSTAINABILITY & CARBON ROI ── */}
          {activeTab === 'sustainability' && (
            <div className="bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-800/40 rounded-2xl p-4 shadow-xl space-y-3 font-mono">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800 text-xs">
                <span className="font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Leaf className="w-4 h-4 text-emerald-400" /> Academic Sustainability & ROI
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  Green-IoT Metrics
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                {[
                  { l: 'Instantaneous Power', v: `${telemetry.powerW.toFixed(1)}`, u: 'Watts', c: 'text-cyan-400', s: `V=${telemetry.voltage}V × I=${telemetry.currentA}A` },
                  { l: 'Daily Energy Consumption', v: `${sustCalc.kwhPerDay.toFixed(3)}`, u: 'kWh/day', c: 'text-amber-400', s: `= ${sustCalc.co2PerDay.toFixed(3)} kg CO₂/day` },
                  { l: 'Avoided CO₂ / Year', v: `${sustCalc.avoidedCO2.toFixed(1)}`, u: 'kg CO₂', c: 'text-emerald-400', s: 'vs unmonitored baseline' },
                  { l: 'Annual Cost Savings', v: `$${sustCalc.costSavingUSD.toFixed(2)}`, u: 'USD/yr', c: 'text-green-400', s: '@ $0.12/kWh industrial tariff' },
                ].map(i => (
                  <div key={i.l} className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                    <div className="text-[10px] text-slate-400">{i.l}</div>
                    <div className={`text-lg font-bold mt-0.5 ${i.c}`}>
                      {i.v} <span className="text-xs text-slate-500">{i.u}</span>
                    </div>
                    <p className="text-[9px] text-slate-500 mt-0.5">{i.s}</p>
                  </div>
                ))}
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div className="flex justify-between items-center text-xs mb-1.5">
                  <span className="font-bold text-white">IoT Predictive Cutoff Efficiency</span>
                  <span className="text-emerald-400 font-bold">{sustCalc.savingsPct.toFixed(0)}%</span>
                </div>
                <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-green-400 transition-all duration-700"
                    style={{ width: `${Math.max(0, Math.min(100, sustCalc.savingsPct))}%` }}
                  />
                </div>
                <p className="text-[9px] text-slate-400 mt-1.5 leading-snug">
                  Automated relay shutdown prevents motor winding thermal runaway, avoiding 3× to 5× replacement energy cost and unscheduled shop floor downtime.
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-800/30 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-300 font-bold">Grid Carbon Intensity Factor</span>
                  <span className="text-emerald-300 font-bold">0.82 kg CO₂/kWh</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">UN SDG Target Alignment</span>
                  <span className="text-cyan-300 font-bold">SDG 7 · SDG 9 · SDG 12</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Current Safety Relay State</span>
                  <span className={relayTripped ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                    {relayTripped ? '✅ Motor Isolated (0.0 W Standby)' : `Motor Drawing ${telemetry.powerW.toFixed(0)} W`}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

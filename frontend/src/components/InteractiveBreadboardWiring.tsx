/**
 * InteractiveBreadboardWiring.tsx — Academic & Industrial Edition
 *
 * Feature 4: Custom Circuit Breadboard Wire Drag-and-Drop & Wiring Error Detection
 *
 * 1. Interactive Wire Dragging & Tie-Point Snapping:
 *    - Click or drag between ESP32 GPIO headers, power rails, and sensor pins.
 *    - Bezier curve DuPont wires with customizable colors.
 *    - Wire selection, inspection, and deletion.
 *
 * 2. Real-time Electrical Rule Check (ERC) & Miswiring Detection:
 *    - Short Circuit Detection (5V/3.3V shorted to GND -> MB102 shutdown alert)
 *    - Overvoltage Component Burnout (24V motor line touching 3.3V ESP32 GPIO)
 *    - I2C Bus Inversion (SDA/SCL swapped -> NACK error)
 *    - Missing OneWire Pull-up Resistor (DS18B20 line floating)
 *    - Floating Transducer Inputs (RPM reads 0, ACS712 floating)
 *
 * 3. Educational Viva Defense Scenarios & One-Click Presets:
 *    - Nominal Correct Wiring, Short Circuit, Inverted I2C, High-Voltage Injection, Missing Pull-up.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileCheck2,
  Flame,
  HelpCircle,
  Info,
  Layers,
  MousePointer,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

export interface PinDefinition {
  id: string;
  name: string;
  label: string;
  x: number;
  y: number;
  type: 'POWER' | 'GND' | 'I2C' | 'ADC' | 'INT' | 'ONEWIRE' | 'RELAY' | 'HIGH_VOLTAGE';
  voltage: '0V' | '3.3V' | '5V' | '24V';
  component: string;
}

export interface UserWire {
  id: string;
  fromPinId: string;
  toPinId: string;
  color: string;
}

export interface WiringDiagnosis {
  status: 'NOMINAL' | 'WARNING' | 'CRITICAL_HAZARD';
  title: string;
  description: string;
  affectedPins: string[];
  vivaNote: string;
  shortCircuit: boolean;
  overvoltage: boolean;
}

export interface ERCRuleResult {
  id: string;
  name: string;
  category: 'POWER' | 'GROUND' | 'ISOLATION' | 'PROTOCOL' | 'SIGNAL';
  status: 'PASS' | 'FAIL' | 'WARN';
  measuredValue: string;
  details: string;
  vivaNote: string;
  affectedPins?: string[];
}

// All breadboard tie-points
export const BOARD_PINS: PinDefinition[] = [
  // ESP32 Left Header
  { id: 'esp32_3v3', name: 'ESP32 3.3V', label: '3V3', x: 260, y: 110, type: 'POWER', voltage: '3.3V', component: 'ESP32' },
  { id: 'esp32_gnd1', name: 'ESP32 GND', label: 'GND', x: 260, y: 130, type: 'GND', voltage: '0V', component: 'ESP32' },
  { id: 'esp32_gpio34', name: 'ESP32 GPIO 34 (ADC1_CH6)', label: 'IO34', x: 260, y: 170, type: 'ADC', voltage: '3.3V', component: 'ESP32' },
  { id: 'esp32_gpio4', name: 'ESP32 GPIO 4 (OneWire DQ)', label: 'IO4', x: 260, y: 230, type: 'ONEWIRE', voltage: '3.3V', component: 'ESP32' },
  { id: 'esp32_gpio19', name: 'ESP32 GPIO 19 (DHT22 Data)', label: 'IO19', x: 260, y: 250, type: 'ONEWIRE', voltage: '3.3V', component: 'ESP32' },

  // ESP32 Right Header
  { id: 'esp32_vin', name: 'ESP32 VIN (5V)', label: 'VIN', x: 330, y: 110, type: 'POWER', voltage: '5V', component: 'ESP32' },
  { id: 'esp32_gnd2', name: 'ESP32 GND', label: 'GND', x: 330, y: 130, type: 'GND', voltage: '0V', component: 'ESP32' },
  { id: 'esp32_gpio21', name: 'ESP32 GPIO 21 (I2C SDA)', label: 'IO21', x: 330, y: 190, type: 'I2C', voltage: '3.3V', component: 'ESP32' },
  { id: 'esp32_gpio22', name: 'ESP32 GPIO 22 (I2C SCL)', label: 'IO22', x: 330, y: 210, type: 'I2C', voltage: '3.3V', component: 'ESP32' },
  { id: 'esp32_gpio18', name: 'ESP32 GPIO 18 (LM393 INT)', label: 'IO18', x: 330, y: 230, type: 'INT', voltage: '3.3V', component: 'ESP32' },
  { id: 'esp32_gpio26', name: 'ESP32 GPIO 26 (Relay IN)', label: 'IO26', x: 330, y: 250, type: 'RELAY', voltage: '3.3V', component: 'ESP32' },

  // Breadboard 5V / 3.3V / GND Rails
  { id: 'rail_5v', name: 'MB102 5.0V Rail (+)', label: '+5V', x: 140, y: 70, type: 'POWER', voltage: '5V', component: 'MB102 Power' },
  { id: 'rail_gnd', name: 'MB102 GND Rail (-)', label: 'GND', x: 140, y: 90, type: 'GND', voltage: '0V', component: 'MB102 Power' },
  { id: 'rail_3v3', name: 'MB102 3.3V Rail (+)', label: '+3.3V', x: 140, y: 390, type: 'POWER', voltage: '3.3V', component: 'MB102 Power' },
  { id: 'rail_gnd_bot', name: 'MB102 GND Rail (-)', label: 'GND', x: 140, y: 410, type: 'GND', voltage: '0V', component: 'MB102 Power' },

  // Transducer 1: ACS712
  { id: 'acs_vcc', name: 'ACS712 VCC (5V)', label: 'VCC', x: 175, y: 230, type: 'POWER', voltage: '5V', component: 'ACS712' },
  { id: 'acs_gnd', name: 'ACS712 GND', label: 'GND', x: 175, y: 245, type: 'GND', voltage: '0V', component: 'ACS712' },
  { id: 'acs_out', name: 'ACS712 VOUT (Analog)', label: 'OUT', x: 175, y: 260, type: 'ADC', voltage: '3.3V', component: 'ACS712' },

  // Transducer 2: MPU-6050
  { id: 'mpu_vcc', name: 'MPU-6050 VCC (3.3V)', label: 'VCC', x: 250, y: 320, type: 'POWER', voltage: '3.3V', component: 'MPU-6050' },
  { id: 'mpu_gnd', name: 'MPU-6050 GND', label: 'GND', x: 265, y: 320, type: 'GND', voltage: '0V', component: 'MPU-6050' },
  { id: 'mpu_sda', name: 'MPU-6050 SDA', label: 'SDA', x: 280, y: 320, type: 'I2C', voltage: '3.3V', component: 'MPU-6050' },
  { id: 'mpu_scl', name: 'MPU-6050 SCL', label: 'SCL', x: 295, y: 320, type: 'I2C', voltage: '3.3V', component: 'MPU-6050' },

  // Transducer 3: LM393 Tachometer
  { id: 'lm_vcc', name: 'LM393 VCC (3.3V)', label: 'VCC', x: 670, y: 270, type: 'POWER', voltage: '3.3V', component: 'LM393' },
  { id: 'lm_gnd', name: 'LM393 GND', label: 'GND', x: 670, y: 285, type: 'GND', voltage: '0V', component: 'LM393' },
  { id: 'lm_d0', name: 'LM393 D0 (Pulse INT)', label: 'D0', x: 670, y: 300, type: 'INT', voltage: '3.3V', component: 'LM393' },

  // Transducer 4: DS18B20 OneWire & Pullup Resistor
  { id: 'ds_vcc', name: 'DS18B20 VDD (3.3V)', label: 'VDD', x: 620, y: 160, type: 'POWER', voltage: '3.3V', component: 'DS18B20' },
  { id: 'ds_gnd', name: 'DS18B20 GND', label: 'GND', x: 620, y: 175, type: 'GND', voltage: '0V', component: 'DS18B20' },
  { id: 'ds_dq', name: 'DS18B20 DQ (1-Wire Data)', label: 'DQ', x: 620, y: 190, type: 'ONEWIRE', voltage: '3.3V', component: 'DS18B20' },
  { id: 'pullup_res', name: '4.7kΩ Pull-up Resistor', label: '4.7kΩ', x: 420, y: 230, type: 'ONEWIRE', voltage: '3.3V', component: 'Resistor' },

  // Transducer 5: DHT22 / AM2302 Ambient Air Sensor
  { id: 'dht_vcc', name: 'DHT22 VCC (3.3V)', label: 'VCC', x: 360, y: 140, type: 'POWER', voltage: '3.3V', component: 'DHT22' },
  { id: 'dht_gnd', name: 'DHT22 GND', label: 'GND', x: 360, y: 160, type: 'GND', voltage: '0V', component: 'DHT22' },
  { id: 'dht_data', name: 'DHT22 DATA (Single-Bus)', label: 'DAT', x: 360, y: 180, type: 'ONEWIRE', voltage: '3.3V', component: 'DHT22' },

  // Actuator: Songle Relay & 24V Motor Circuit
  { id: 'relay_vcc', name: 'Songle Relay VCC (5V)', label: 'VCC', x: 410, y: 290, type: 'POWER', voltage: '5V', component: 'Songle Relay' },
  { id: 'relay_gnd', name: 'Songle Relay GND', label: 'GND', x: 410, y: 305, type: 'GND', voltage: '0V', component: 'Songle Relay' },
  { id: 'relay_in', name: 'Songle Relay IN (Opto)', label: 'IN', x: 410, y: 320, type: 'RELAY', voltage: '3.3V', component: 'Songle Relay' },
  { id: 'rail_24v', name: '24V DC Spindle Supply (+)', label: '+24V', x: 540, y: 70, type: 'HIGH_VOLTAGE', voltage: '24V', component: '24V Power' },
  { id: 'relay_com', name: 'Relay Common Terminal', label: 'COM', x: 480, y: 300, type: 'HIGH_VOLTAGE', voltage: '24V', component: 'Songle Relay' },
  { id: 'relay_no', name: 'Relay Normally-Open (NO)', label: 'NO', x: 480, y: 320, type: 'HIGH_VOLTAGE', voltage: '24V', component: 'Songle Relay' },
  { id: 'motor_pos', name: 'RS-775 Motor (+)', label: 'M+', x: 650, y: 90, type: 'HIGH_VOLTAGE', voltage: '24V', component: 'RS-775 Motor' },
  { id: 'motor_neg', name: 'RS-775 Motor (-)', label: 'M-', x: 650, y: 110, type: 'GND', voltage: '0V', component: 'RS-775 Motor' },
];

export const NOMINAL_WIRES: UserWire[] = [
  // 1. ESP32 Power from MB102
  { id: 'w1', fromPinId: 'rail_5v', toPinId: 'esp32_vin', color: '#ef4444' },
  { id: 'w2', fromPinId: 'rail_gnd', toPinId: 'esp32_gnd1', color: '#0f172a' },
  // 2. ACS712 Hall Current Sensor
  { id: 'w3', fromPinId: 'rail_5v', toPinId: 'acs_vcc', color: '#ef4444' },
  { id: 'w4', fromPinId: 'rail_gnd', toPinId: 'acs_gnd', color: '#0f172a' },
  { id: 'w5', fromPinId: 'acs_out', toPinId: 'esp32_gpio34', color: '#10b981' },
  // 3. MPU-6050 6-Axis IMU (I2C)
  { id: 'w6', fromPinId: 'rail_3v3', toPinId: 'mpu_vcc', color: '#f97316' },
  { id: 'w7', fromPinId: 'rail_gnd_bot', toPinId: 'mpu_gnd', color: '#0f172a' },
  { id: 'w8', fromPinId: 'mpu_sda', toPinId: 'esp32_gpio21', color: '#38bdf8' },
  { id: 'w9', fromPinId: 'mpu_scl', toPinId: 'esp32_gpio22', color: '#eab308' },
  // 4. LM393 Tachometer
  { id: 'w10', fromPinId: 'rail_3v3', toPinId: 'lm_vcc', color: '#f97316' },
  { id: 'w11', fromPinId: 'rail_gnd_bot', toPinId: 'lm_gnd', color: '#0f172a' },
  { id: 'w12', fromPinId: 'lm_d0', toPinId: 'esp32_gpio18', color: '#ec4899' },
  // 5. DS18B20 OneWire & Pullup Resistor
  { id: 'w13', fromPinId: 'rail_3v3', toPinId: 'ds_vcc', color: '#f97316' },
  { id: 'w14', fromPinId: 'rail_gnd_bot', toPinId: 'ds_gnd', color: '#0f172a' },
  { id: 'w15', fromPinId: 'ds_dq', toPinId: 'pullup_res', color: '#a855f7' },
  { id: 'w16', fromPinId: 'pullup_res', toPinId: 'esp32_gpio4', color: '#a855f7' },
  // 6. Songle Safety Relay & 24V Motor Circuit
  { id: 'w17', fromPinId: 'rail_5v', toPinId: 'relay_vcc', color: '#ef4444' },
  { id: 'w18', fromPinId: 'rail_gnd', toPinId: 'relay_gnd', color: '#0f172a' },
  { id: 'w19', fromPinId: 'relay_in', toPinId: 'esp32_gpio26', color: '#06b6d4' },
  { id: 'w20', fromPinId: 'rail_24v', toPinId: 'relay_com', color: '#dc2626' },
  { id: 'w21', fromPinId: 'relay_no', toPinId: 'motor_pos', color: '#dc2626' },
  { id: 'w22', fromPinId: 'motor_neg', toPinId: 'rail_gnd', color: '#0f172a' },
  // 7. DHT22 Ambient Air Temperature Sensor
  { id: 'w23', fromPinId: 'rail_3v3', toPinId: 'dht_vcc', color: '#f97316' },
  { id: 'w24', fromPinId: 'rail_gnd_bot', toPinId: 'dht_gnd', color: '#0f172a' },
  { id: 'w25', fromPinId: 'dht_data', toPinId: 'esp32_gpio19', color: '#06b6d4' },
];

export interface InteractiveBreadboardWiringProps {
  onWiringStatusChange?: (diagnosis: WiringDiagnosis) => void;
  className?: string;
}

export const InteractiveBreadboardWiring: React.FC<InteractiveBreadboardWiringProps> = ({
  onWiringStatusChange,
  className = '',
}) => {
  const [wires, setWires] = useState<UserWire[]>(NOMINAL_WIRES);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [dragStartPinId, setDragStartPinId] = useState<string | null>(null);
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [activeWireColor, setActiveWireColor] = useState<string>('#38bdf8');
  const [testRunActive, setTestRunActive] = useState<boolean>(false);
  const [activePreset, setActivePreset] = useState<string>('nominal');
  const [isTestingERC, setIsTestingERC] = useState<boolean>(false);
  const [testProgress, setTestProgress] = useState<number>(0);
  const [isERCModalOpen, setIsERCModalOpen] = useState<boolean>(false);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Pin lookup dictionary
  const pinDict = useMemo(() => {
    const map: Record<string, PinDefinition> = {};
    BOARD_PINS.forEach(p => { map[p.id] = p; });
    return map;
  }, []);

  // ─── ELECTRICAL RULE CHECK (ERC) MULTI-RULE VERIFICATION ENGINE ──────────────
  const ercRules: ERCRuleResult[] = useMemo(() => {
    const isConn = (a: string, b: string) =>
      wires.some(w => (w.fromPinId === a && w.toPinId === b) || (w.fromPinId === b && w.toPinId === a));

    const rules: ERCRuleResult[] = [];

    // Rule 1: Power Rail Distribution (+5.0V & +3.3V MB102)
    const esp5v = isConn('rail_5v', 'esp32_vin');
    const acs5v = isConn('rail_5v', 'acs_vcc');
    const relay5v = isConn('rail_5v', 'relay_vcc');
    const mpu3v3 = isConn('rail_3v3', 'mpu_vcc') || isConn('esp32_3v3', 'mpu_vcc');
    const lm3v3 = isConn('rail_3v3', 'lm_vcc') || isConn('esp32_3v3', 'lm_vcc');
    const ds3v3 = isConn('rail_3v3', 'ds_vcc') || isConn('esp32_3v3', 'ds_vcc');
    const allPowerOk = esp5v && acs5v && relay5v && mpu3v3 && lm3v3 && ds3v3;

    rules.push({
      id: 'erc_pwr_rails',
      name: 'Regulated Power Rails (+5.0V & +3.3V MB102)',
      category: 'POWER',
      status: allPowerOk ? 'PASS' : !esp5v ? 'FAIL' : 'WARN',
      measuredValue: allPowerOk ? '+5.02V / +3.31V Regulated' : !esp5v ? '0.00V VIN (Unpowered MCU)' : 'Partial Rail Feed',
      details: allPowerOk
        ? 'ESP32 VIN receives 5V; ACS712 and Songle Relay coil receive 5V; MPU-6050, LM393, and DS18B20 receive regulated 3.3V.'
        : !esp5v
        ? 'ESP32 VIN is disconnected from MB102 5V rail. Onboard AMS1117-3.3 regulator has no input voltage and MCU cannot boot.'
        : 'One or more peripheral transducers lack an active VCC power connection from the breadboard rails.',
      vivaNote: 'The ESP32 DevKit onboard AMS1117 LDO requires Vin ≥ 4.5V to deliver a ripple-free 3.3V logic rail. Sensors must match their rated voltage to prevent CMOS latch-up.',
      affectedPins: !esp5v ? ['esp32_vin', 'rail_5v'] : [],
    });

    // Rule 2: Ground Reference Plane (Common 0V Star GND)
    const espGnd = isConn('rail_gnd', 'esp32_gnd1') || isConn('rail_gnd', 'esp32_gnd2') || isConn('rail_gnd_bot', 'esp32_gnd1');
    const acsGnd = isConn('rail_gnd', 'acs_gnd') || isConn('rail_gnd_bot', 'acs_gnd');
    const mpuGnd = isConn('rail_gnd_bot', 'mpu_gnd') || isConn('rail_gnd', 'mpu_gnd');
    const lmGnd = isConn('rail_gnd_bot', 'lm_gnd') || isConn('rail_gnd', 'lm_gnd');
    const dsGnd = isConn('rail_gnd_bot', 'ds_gnd') || isConn('rail_gnd', 'ds_gnd');
    const relayGnd = isConn('rail_gnd', 'relay_gnd') || isConn('rail_gnd_bot', 'relay_gnd');
    const allGndOk = espGnd && acsGnd && mpuGnd && lmGnd && dsGnd && relayGnd;

    rules.push({
      id: 'erc_gnd_net',
      name: 'Common Ground Return Plane (Star GND Net)',
      category: 'GROUND',
      status: allGndOk ? 'PASS' : 'WARN',
      measuredValue: allGndOk ? '0.00V Reference (Z < 0.05Ω)' : 'Floating Ground Potential',
      details: allGndOk
        ? 'All 6 modules and the ESP32 tie to the shared MB102 ground rails, guaranteeing a zero-volt potential reference.'
        : 'One or more module ground connections are missing. Floating ground references cause ground bounce and false ADC readings.',
      vivaNote: 'Star grounding prevents return currents of high-current actuators (motor/relay) from inducing parasitic voltage drops across sensitive analog sensor ground traces.',
      affectedPins: !espGnd ? ['esp32_gnd1', 'rail_gnd'] : [],
    });

    // Rule 3: Power-to-Ground Short Circuit Isolation
    let shortFaultPin1: string | null = null;
    let shortFaultPin2: string | null = null;
    for (const w of wires) {
      const p1 = pinDict[w.fromPinId];
      const p2 = pinDict[w.toPinId];
      if (!p1 || !p2) continue;
      if ((p1.type === 'POWER' || p1.type === 'HIGH_VOLTAGE') && p2.type === 'GND' && p1.voltage !== '0V') {
        shortFaultPin1 = p1.id;
        shortFaultPin2 = p2.id;
        break;
      }
      if (p1.type === 'GND' && (p2.type === 'POWER' || p2.type === 'HIGH_VOLTAGE') && p2.voltage !== '0V') {
        shortFaultPin1 = p2.id;
        shortFaultPin2 = p1.id;
        break;
      }
    }

    rules.push({
      id: 'erc_short_circuit',
      name: 'Power-to-Ground Short Circuit Isolation',
      category: 'POWER',
      status: shortFaultPin1 ? 'FAIL' : 'PASS',
      measuredValue: shortFaultPin1 ? '0.00V (Fault Current > 15A)' : 'Z_rail > 100 kΩ (Nominal)',
      details: shortFaultPin1
        ? `Direct zero-impedance short circuit detected between ${pinDict[shortFaultPin1]?.name} and ${pinDict[shortFaultPin2!]?.name}! MB102 regulator entering thermal shutdown.`
        : 'Zero short circuits between supply rails (+5V, +3.3V, +24V) and ground tie points.',
      vivaNote: 'According to Ohm\'s Law (I = V / R_wire), near-zero resistance paths collapse voltage rails and deliver destructive inrush currents that fuse PCB traces.',
      affectedPins: shortFaultPin1 ? [shortFaultPin1, shortFaultPin2!] : [],
    });

    // Rule 4: High-Voltage Optical Isolation (24V Motor Circuit)
    let hvFaultPin1: string | null = null;
    let hvFaultPin2: string | null = null;
    for (const w of wires) {
      const p1 = pinDict[w.fromPinId];
      const p2 = pinDict[w.toPinId];
      if (!p1 || !p2) continue;
      if (p1.voltage === '24V' && (p2.voltage === '3.3V' || p2.component === 'ESP32' || p2.component === 'MPU-6050')) {
        hvFaultPin1 = p1.id;
        hvFaultPin2 = p2.id;
        break;
      }
      if (p2.voltage === '24V' && (p1.voltage === '3.3V' || p1.component === 'ESP32' || p1.component === 'MPU-6050')) {
        hvFaultPin1 = p2.id;
        hvFaultPin2 = p1.id;
        break;
      }
    }

    rules.push({
      id: 'erc_hv_isolation',
      name: 'Galvanic Optical Isolation Barrier (24V Motor Loop)',
      category: 'ISOLATION',
      status: hvFaultPin1 ? 'FAIL' : 'PASS',
      measuredValue: hvFaultPin1 ? '24.0V DC (Destructive Stress)' : '2.1 kVRMS Optical Barrier (OK)',
      details: hvFaultPin1
        ? `CATASTROPHIC HAZARD: 24V industrial supply line is bridged directly to ${pinDict[hvFaultPin2!]?.name} (rated max 3.6V). Silicon substrate and ESD clamp diodes are vaporized!`
        : 'The 24V RS-775 motor loop is fully isolated from the 3.3V MCU via the EL817 optoisolator and Songle relay contacts.',
      vivaNote: 'Inductive back-EMF spikes from DC motors can exceed 60V upon sudden cutoff (V = -L di/dt). Optical isolation barriers prevent motor transients from coupling into digital logic.',
      affectedPins: hvFaultPin1 ? [hvFaultPin1, hvFaultPin2!] : [],
    });

    // Rule 5: I2C Serial Protocol Net Integrity (MPU-6050 Bus)
    const mpuSdaWire = wires.find(w => w.fromPinId === 'mpu_sda' || w.toPinId === 'mpu_sda');
    const mpuSclWire = wires.find(w => w.fromPinId === 'mpu_scl' || w.toPinId === 'mpu_scl');
    const sdaInverted = mpuSdaWire && (mpuSdaWire.fromPinId === 'esp32_gpio22' || mpuSdaWire.toPinId === 'esp32_gpio22');
    const sclInverted = mpuSclWire && (mpuSclWire.fromPinId === 'esp32_gpio21' || mpuSclWire.toPinId === 'esp32_gpio21');
    const i2cNominal = isConn('mpu_sda', 'esp32_gpio21') && isConn('mpu_scl', 'esp32_gpio22');

    rules.push({
      id: 'erc_i2c_bus',
      name: 'I2C Serial Bus Net Integrity (MPU-6050 @ 0x68)',
      category: 'PROTOCOL',
      status: sdaInverted || sclInverted ? 'FAIL' : i2cNominal ? 'PASS' : 'WARN',
      measuredValue: sdaInverted || sclInverted ? 'Bus Inverted (NACK 0x68)' : i2cNominal ? '400 kHz Fast I2C (ACK 0x68)' : 'Bus Disconnected',
      details: sdaInverted || sclInverted
        ? 'MPU-6050 SDA is connected to GPIO 22 (Clock) instead of GPIO 21 (Data). The I2C state machine cannot assert START condition or read ACK bit.'
        : i2cNominal
        ? 'Hardware I2C lines correctly mapped: SDA=GPIO21, SCL=GPIO22. Ready for 6-axis vibration telemetry at 400kHz.'
        : 'MPU-6050 I2C data or clock line is not connected to the ESP32 microcontroller.',
      vivaNote: 'ESP32 Wire.h default hardware I2C peripheral uses SDA=GPIO21 and SCL=GPIO22. Inverting lines holds clock low, causing bus deadlock.',
      affectedPins: sdaInverted ? ['mpu_sda', 'esp32_gpio22'] : [],
    });

    // Rule 6: Dallas 1-Wire Open-Drain Line & 4.7kΩ Pull-Up Resistor
    const hasPullup = wires.some(w => w.fromPinId === 'pullup_res' || w.toPinId === 'pullup_res');
    const hasDqWire = wires.some(w => w.fromPinId === 'ds_dq' || w.toPinId === 'ds_dq');
    const oneWireNominal = isConn('ds_dq', 'pullup_res') && isConn('pullup_res', 'esp32_gpio4');

    rules.push({
      id: 'erc_onewire_pullup',
      name: 'Dallas 1-Wire Bus & 4.7kΩ Pull-Up Resistor (DS18B20)',
      category: 'PROTOCOL',
      status: hasDqWire && !hasPullup ? 'FAIL' : oneWireNominal ? 'PASS' : 'WARN',
      measuredValue: hasDqWire && !hasPullup ? 'Floating Line (Missing 4.7kΩ)' : oneWireNominal ? '4.7kΩ Pull-Up to 3.3V (OK)' : 'Disconnected',
      details: hasDqWire && !hasPullup
        ? 'DS18B20 1-Wire DQ line is connected to MCU without a pull-up resistor to 3.3V. The open-drain bus cannot pull HIGH, yielding default -127°C error.'
        : oneWireNominal
        ? 'DS18B20 DQ open-drain line terminated with 4.7kΩ pull-up resistor on GPIO4. 12-bit digital temperature conversion nominal.'
        : 'DS18B20 temperature probe DQ data line is disconnected.',
      vivaNote: 'Dallas 1-Wire protocol operates in open-collector mode. Devices only pull line LOW; a 4.7kΩ pull-up resistor is strictly required to restore logic HIGH between bit slots.',
      affectedPins: hasDqWire && !hasPullup ? ['ds_dq', 'esp32_gpio4'] : [],
    });

    // Rule 7: Optical Tachometer Interrupt Pin (LM393 D0)
    const tachNominal = isConn('lm_d0', 'esp32_gpio18');
    rules.push({
      id: 'erc_tach_interrupt',
      name: 'Optical Tachometer Interrupt Pin (LM393 D0)',
      category: 'SIGNAL',
      status: tachNominal ? 'PASS' : 'WARN',
      measuredValue: tachNominal ? '3.3V Square Wave (GPIO18 INT)' : 'Disconnected',
      details: tachNominal
        ? 'LM393 optical gate digital output D0 connected to ESP32 hardware interrupt GPIO 18. Microsecond pulse capture enabled.'
        : 'LM393 tachometer D0 output is not connected to ESP32 GPIO 18.',
      vivaNote: 'Hardware timer interrupts on Core 0 capture optical slotted disc transitions without CPU polling latency, calculating accurate RPM = (pulse_freq / 8) * 60.',
      affectedPins: !tachNominal ? ['lm_d0', 'esp32_gpio18'] : [],
    });

    // Rule 8: ACS712 Current Transducer Analog Net (GPIO 34 ADC1)
    const acsNominal = isConn('acs_out', 'esp32_gpio34');
    rules.push({
      id: 'erc_adc_analog',
      name: 'Current Transducer Analog Net (ACS712 OUT)',
      category: 'SIGNAL',
      status: acsNominal ? 'PASS' : 'WARN',
      measuredValue: acsNominal ? '0-3.3V Analog (ADC1_CH6)' : 'Disconnected',
      details: acsNominal
        ? 'ACS712 linear 66 mV/A analog output connected to ESP32 ADC1 channel 6 (GPIO 34). Immune to Wi-Fi RF driver contention.'
        : 'ACS712 analog output OUT is not connected to ESP32 GPIO 34.',
      vivaNote: 'GPIO 34 belongs to ADC1. ADC2 is multiplexed with Wi-Fi RF registers; routing analog signals to ADC1 prevents telemetry dropouts during wireless packet transmission.',
      affectedPins: !acsNominal ? ['acs_out', 'esp32_gpio34'] : [],
    });

    return rules;
  }, [wires, pinDict]);

  // ─── ELECTRICAL RULE CHECK (ERC) & MISWIRING DETECTION ENGINE ──────────────
  const diagnosis: WiringDiagnosis = useMemo(() => {
    const hasCritical = ercRules.some(r => r.status === 'FAIL');
    const hasWarn = ercRules.some(r => r.status === 'WARN');

    if (hasCritical) {
      const critRule = ercRules.find(r => r.status === 'FAIL')!;
      return {
        status: 'CRITICAL_HAZARD',
        title: critRule.id === 'erc_short_circuit'
          ? '💥 Direct Short Circuit to Ground!'
          : critRule.id === 'erc_hv_isolation'
          ? '🔥 Catastrophic 24V Overvoltage Destruction!'
          : `💥 Critical Rule Failure: ${critRule.name}`,
        description: critRule.details,
        affectedPins: critRule.affectedPins || [],
        vivaNote: critRule.vivaNote,
        shortCircuit: critRule.id === 'erc_short_circuit',
        overvoltage: critRule.id === 'erc_hv_isolation',
      };
    }

    if (hasWarn) {
      const warnRule = ercRules.find(r => r.status === 'WARN')!;
      return {
        status: 'WARNING',
        title: `⚠ Electrical Rule Warning: ${warnRule.name}`,
        description: warnRule.details,
        affectedPins: warnRule.affectedPins || [],
        vivaNote: warnRule.vivaNote,
        shortCircuit: false,
        overvoltage: false,
      };
    }

    return {
      status: 'NOMINAL',
      title: '✓ All Electrical Rules Verified & Nominal (8/8 Checks Passed)',
      description: 'Power rails (5V, 3.3V, 24V), I2C bus (0x68), ADC input (GPIO34), and 1-Wire (GPIO4 with 4.7kΩ) are correctly mapped without short circuits or overvoltage risks.',
      affectedPins: [],
      vivaNote: 'Galvanic isolation between the 24V motor circuit and the 3.3V digital logic is strictly maintained via the optocoupler barrier.',
      shortCircuit: false,
      overvoltage: false,
    };
  }, [ercRules]);

  // Inform parent of status
  useEffect(() => {
    if (onWiringStatusChange) {
      onWiringStatusChange(diagnosis);
    }
  }, [diagnosis, onWiringStatusChange]);

  // Handle pin click to start / complete wire dragging
  const handlePinClick = (pinId: string) => {
    if (!dragStartPinId) {
      setDragStartPinId(pinId);
    } else {
      if (dragStartPinId !== pinId) {
        // Prevent duplicate wire
        const exists = wires.some(w =>
          (w.fromPinId === dragStartPinId && w.toPinId === pinId) ||
          (w.fromPinId === pinId && w.toPinId === dragStartPinId)
        );

        if (!exists) {
          const newWire: UserWire = {
            id: `user_wire_${Date.now()}`,
            fromPinId: dragStartPinId,
            toPinId: pinId,
            color: activeWireColor,
          };
          setWires(prev => [...prev, newWire]);
        }
      }
      setDragStartPinId(null);
    }
  };

  // SVG Mouse movement for interactive drawing
  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = 840 / rect.width;
    const scaleY = 480 / rect.height;
    setMousePos({
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    });
  };

  // Preset switchers
  const loadPreset = (presetKey: string) => {
    setActivePreset(presetKey);
    setSelectedWireId(null);
    setDragStartPinId(null);

    if (presetKey === 'nominal') {
      setWires(NOMINAL_WIRES);
    } else if (presetKey === 'short_circuit') {
      // Create a dangerous 5V to GND short
      setWires([
        ...NOMINAL_WIRES,
        { id: 'short_wire', fromPinId: 'rail_5v', toPinId: 'rail_gnd', color: '#f43f5e' },
      ]);
    } else if (presetKey === 'i2c_swap') {
      // Invert SDA with SCL
      const filtered = NOMINAL_WIRES.filter(w => w.id !== 'w8' && w.id !== 'w9');
      setWires([
        ...filtered,
        { id: 'w8_swapped', fromPinId: 'mpu_sda', toPinId: 'esp32_gpio22', color: '#eab308' },
        { id: 'w9_swapped', fromPinId: 'mpu_scl', toPinId: 'esp32_gpio21', color: '#38bdf8' },
      ]);
    } else if (presetKey === 'overvoltage') {
      // Connect 24V directly to ESP32 GPIO 34
      setWires([
        ...NOMINAL_WIRES,
        { id: 'burnout_wire', fromPinId: 'rail_24v', toPinId: 'esp32_gpio34', color: '#dc2626' },
      ]);
    } else if (presetKey === 'missing_pullup') {
      // Remove pullup resistor wire
      const filtered = NOMINAL_WIRES.filter(w => w.id !== 'w15');
      setWires(filtered);
    } else if (presetKey === 'empty') {
      setWires([]);
    }
  };

  // Delete selected wire
  const handleDeleteSelectedWire = () => {
    if (!selectedWireId) return;
    setWires(prev => prev.filter(w => w.id !== selectedWireId));
    setSelectedWireId(null);
  };

  // Automated Electrical Rule Check (ERC) Test Runner
  const startERCTest = () => {
    setIsTestingERC(true);
    setTestProgress(15);
    setTestRunActive(true);

    setTimeout(() => setTestProgress(45), 200);
    setTimeout(() => setTestProgress(75), 450);
    setTimeout(() => setTestProgress(92), 700);
    setTimeout(() => {
      setTestProgress(100);
      setIsTestingERC(false);
      setIsERCModalOpen(true);
      setTimeout(() => setTestRunActive(false), 2000);
    }, 950);
  };

  // Generate cubic bezier curve path between two pins
  const getWirePath = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const sag = Math.min(80, Math.max(25, dist * 0.25));

    // Dynamic control points simulating hanging flexible wire
    const cx1 = x1 + dx * 0.25;
    const cy1 = y1 + dy * 0.25 + sag;
    const cx2 = x1 + dx * 0.75;
    const cy2 = y1 + dy * 0.75 + sag;

    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  };

  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-2xl p-4 shadow-2xl font-mono space-y-4 ${className}`}>
      {/* ─── HEADER: TITLE & TEST CONTROLS ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/40 shadow-md">
            <MousePointer className="w-5 h-5 animate-bounce" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-sm tracking-wide">
                Interactive Breadboard Wiring & Fault Detector
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800">
                DRAG & DROP TIE-POINTS
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Click any pin to start routing a wire, then click a target pin to connect. Tests electrical rules in real time.
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {selectedWireId && (
            <button
              onClick={handleDeleteSelectedWire}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 transition-colors shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Wire</span>
            </button>
          )}

          {/* Direct link to open ERC Report */}
          <button
            onClick={() => setIsERCModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow-sm"
            title="Inspect Electrical Rule Check Verification Report"
          >
            <FileCheck2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>ERC Report ({ercRules.filter(r => r.status === 'PASS').length}/8)</span>
          </button>

          <button
            onClick={startERCTest}
            disabled={isTestingERC}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md ${
              isTestingERC
                ? 'bg-cyan-600 text-white animate-pulse'
                : 'bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white hover:scale-102'
            }`}
          >
            {isTestingERC ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Testing Nets ({testProgress}%)...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Test Circuit ERC</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ─── WIRING DIAGNOSIS STATUS BANNER ─── */}
      <div className={`p-3.5 rounded-xl border flex items-start gap-3 transition-all ${
        diagnosis.status === 'CRITICAL_HAZARD'
          ? 'bg-rose-950/70 border-rose-600/80 shadow-lg shadow-rose-950/50'
          : diagnosis.status === 'WARNING'
          ? 'bg-amber-950/60 border-amber-600/80'
          : 'bg-emerald-950/50 border-emerald-600/60'
      }`}>
        <div className="mt-0.5 shrink-0">
          {diagnosis.status === 'CRITICAL_HAZARD' ? (
            <AlertOctagon className="w-6 h-6 text-rose-400 animate-pulse" />
          ) : diagnosis.status === 'WARNING' ? (
            <AlertTriangle className="w-6 h-6 text-amber-400" />
          ) : (
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          )}
        </div>
        <div className="space-y-1 text-xs flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`font-bold text-sm ${
                diagnosis.status === 'CRITICAL_HAZARD' ? 'text-rose-300' :
                diagnosis.status === 'WARNING' ? 'text-amber-300' : 'text-emerald-300'
              }`}>
                {diagnosis.title}
              </span>
              <span className="text-[10px] text-slate-400 font-normal">({wires.length} wires routed)</span>
            </div>
            <button
              onClick={() => setIsERCModalOpen(true)}
              className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors underline underline-offset-2"
            >
              <span>View ERC Report</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <p className="text-slate-300 text-[11px] leading-relaxed">{diagnosis.description}</p>
          <div className="text-[10px] text-slate-400 bg-black/40 p-2 rounded-lg border border-slate-800/80 mt-1">
            <strong className="text-white">Academic Defense / Viva Note: </strong>
            <span>{diagnosis.vivaNote}</span>
          </div>
        </div>
      </div>

      {/* ─── TOOLBAR: COLOR PICKER & PRESET SCENARIOS ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-xs">
        {/* Wire Color Palette */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400 font-bold">Wire Color:</span>
          {[
            { color: '#ef4444', label: '5V Red' },
            { color: '#f97316', label: '3.3V Orange' },
            { color: '#1e293b', label: 'GND Black' },
            { color: '#38bdf8', label: 'SDA Sky' },
            { color: '#eab308', label: 'SCL Yellow' },
            { color: '#10b981', label: 'Analog Green' },
            { color: '#ec4899', label: 'INT Pink' },
            { color: '#a855f7', label: '1-Wire Purple' },
            { color: '#dc2626', label: '24V Motor' },
          ].map(c => (
            <button
              key={c.color}
              onClick={() => setActiveWireColor(c.color)}
              className={`w-5 h-5 rounded-full border-2 transition-transform ${
                activeWireColor === c.color ? 'scale-125 border-white shadow-md' : 'border-slate-700 hover:scale-110'
              }`}
              style={{ backgroundColor: c.color }}
              title={c.label}
            />
          ))}
        </div>

        {/* Miswiring Presets for Academic Testing */}
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          <span className="text-slate-500 font-bold mr-1">Presets:</span>
          {[
            { id: 'nominal', label: '✓ Nominal' },
            { id: 'short_circuit', label: '💥 Short 5V/GND' },
            { id: 'i2c_swap', label: '🔄 Invert I2C' },
            { id: 'overvoltage', label: '🔥 24V on GPIO' },
            { id: 'missing_pullup', label: '❓ No Pullup' },
            { id: 'empty', label: 'Clear' },
          ].map(p => (
            <button
              key={p.id}
              onClick={() => loadPreset(p.id)}
              className={`px-2 py-1 rounded-lg font-bold border transition-colors ${
                activePreset === p.id
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── INTERACTIVE SVG BREADBOARD WORKBENCH ─── */}
      <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-[#070b14] shadow-inner select-none">
        <svg
          ref={svgRef}
          viewBox="0 0 840 480"
          className="w-full h-auto block cursor-crosshair"
          onMouseMove={handleSvgMouseMove}
        >
          <defs>
            {/* Spark particle filter */}
            <filter id="sparkGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Grid pattern */}
            <pattern id="breadboardGrid" width="12" height="12" patternUnits="userSpaceOnUse">
              <circle cx="6" cy="6" r="1.5" fill="#1e293b" />
            </pattern>
          </defs>

          {/* Breadboard Body */}
          <rect x="110" y="30" width="410" height="420" rx="10" fill="#0f172a" stroke="#1e293b" strokeWidth="2" />
          <rect x="120" y="40" width="390" height="400" fill="url(#breadboardGrid)" opacity="0.6" />

          {/* Center Trench */}
          <rect x="295" y="40" width="14" height="400" fill="#020617" />

          {/* MB102 Power Supply Module Silhouette */}
          <rect x="120" y="50" width="50" height="380" rx="4" fill="#1e293b" stroke="#334155" strokeWidth="1.5" />
          <text x="145" y="240" fill="#64748b" fontSize="9" fontWeight="bold" transform="rotate(-90 145 240)" textAnchor="middle">
            MB102 DUAL POWER
          </text>

          {/* ESP32 Silhouette */}
          <rect x="250" y="90" width="90" height="190" rx="6" fill="#091322" stroke="#2563eb" strokeWidth="1.5" />
          <rect x="265" y="100" width="60" height="65" rx="3" fill="#334155" />
          <text x="295" y="136" fill="#e2e8f0" fontSize="8" fontWeight="bold" textAnchor="middle">
            ESP-WROOM-32
          </text>

          {/* ACS712 Transducer Silhouette */}
          <rect x="160" y="215" width="85" height="60" rx="4" fill="#064e3b" stroke="#059669" strokeWidth="1" />
          <text x="202" y="248" fill="#a7f3d0" fontSize="8" fontWeight="bold" textAnchor="middle">ACS712 ±5A</text>

          {/* MPU-6050 Silhouette */}
          <rect x="240" y="305" width="70" height="45" rx="4" fill="#1e3a8a" stroke="#3b82f6" strokeWidth="1" />
          <text x="275" y="332" fill="#bfdbfe" fontSize="8" fontWeight="bold" textAnchor="middle">MPU-6050</text>

          {/* LM393 Optical Bracket Silhouette */}
          <rect x="650" y="255" width="65" height="65" rx="4" fill="#1e293b" stroke="#475569" strokeWidth="1" />
          <text x="682" y="290" fill="#cbd5e1" fontSize="8" fontWeight="bold" textAnchor="middle">LM393 INT</text>

          {/* DS18B20 Stainless Probe Silhouette */}
          <rect x="600" y="145" width="90" height="65" rx="4" fill="#1e293b" stroke="#64748b" strokeWidth="1" />
          <text x="645" y="180" fill="#e2e8f0" fontSize="8" fontWeight="bold" textAnchor="middle">DS18B20 1-W</text>

          {/* DHT22 Ambient Air Sensor Silhouette */}
          <rect x="345" y="125" width="55" height="70" rx="4" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.2" />
          <line x1="353" y1="138" x2="392" y2="138" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="353" y1="144" x2="392" y2="144" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="353" y1="150" x2="392" y2="150" stroke="#94a3b8" strokeWidth="1.5" />
          <text x="372" y="172" fill="#0f172a" fontSize="7.5" fontWeight="bold" textAnchor="middle">DHT22</text>
          <text x="372" y="184" fill="#475569" fontSize="6" fontFamily="monospace" textAnchor="middle">Air Temp</text>

          {/* Songle Relay Silhouette */}
          <rect x="390" y="275" width="115" height="75" rx="5" fill="#1e3a8a" stroke="#2563eb" strokeWidth="1.5" />
          <text x="447" y="316" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="middle">SONGLE 5V RELAY</text>

          {/* RS-775 Motor Rig Silhouette */}
          <rect x="530" y="50" width="280" height="380" rx="8" fill="#090d16" stroke="#334155" strokeWidth="1.5" />
          <circle cx="670" cy="100" r="28" fill="#1e293b" stroke="#475569" strokeWidth="2" />
          <text x="670" y="104" fill="#e2e8f0" fontSize="9" fontWeight="bold" textAnchor="middle">RS-775</text>

          {/* ─── RENDER ROUTED WIRES ─── */}
          {wires.map(w => {
            const p1 = pinDict[w.fromPinId];
            const p2 = pinDict[w.toPinId];
            if (!p1 || !p2) return null;
            const isSelected = selectedWireId === w.id;
            const pathD = getWirePath(p1.x, p1.y, p2.x, p2.y);

            return (
              <g
                key={w.id}
                onClick={() => setSelectedWireId(isSelected ? null : w.id)}
                className="cursor-pointer"
              >
                {/* Outer shadow / selection ring */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={isSelected ? '#38bdf8' : '#000000'}
                  strokeWidth={isSelected ? 6 : 4}
                  strokeOpacity={isSelected ? 0.9 : 0.4}
                />
                {/* Core wire line */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={w.color}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
                {/* Active ERC testing scanner beam */}
                {isTestingERC && (
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={4.5}
                    strokeDasharray="8 6"
                    className="animate-pulse"
                    filter="url(#sparkGlow)"
                  />
                )}
                {/* Connector terminal boots */}
                <circle cx={p1.x} cy={p1.y} r="3.5" fill="#0f172a" stroke={w.color} strokeWidth="1.5" />
                <circle cx={p2.x} cy={p2.y} r="3.5" fill="#0f172a" stroke={w.color} strokeWidth="1.5" />
              </g>
            );
          })}

          {/* ─── LIVE DRAGGING WIRE PREVIEW ─── */}
          {dragStartPinId && mousePos && pinDict[dragStartPinId] && (
            <path
              d={getWirePath(pinDict[dragStartPinId].x, pinDict[dragStartPinId].y, mousePos.x, mousePos.y)}
              fill="none"
              stroke={activeWireColor}
              strokeWidth="2.5"
              strokeDasharray="4 3"
              className="animate-pulse"
            />
          )}

          {/* ─── SHORT CIRCUIT / OVERVOLTAGE SPARK ANIMATIONS ─── */}
          {(diagnosis.shortCircuit || diagnosis.overvoltage) && (
            diagnosis.affectedPins.map(pinId => {
              const p = pinDict[pinId];
              if (!p) return null;
              return (
                <g key={`spark_${pinId}`} transform={`translate(${p.x}, ${p.y})`}>
                  <circle cx="0" cy="0" r="14" fill="#f43f5e" opacity="0.3" className="animate-ping" />
                  <circle cx="0" cy="0" r="7" fill="#fbbf24" filter="url(#sparkGlow)" />
                  <text x="12" y="-6" fill="#f87171" fontSize="9" fontWeight="bold" fontFamily="monospace">
                    {diagnosis.shortCircuit ? '⚡ SHORT!' : '🔥 24V BURNOUT!'}
                  </text>
                </g>
              );
            })
          )}

          {/* ─── NOMINAL TEST PING INDICATOR (DURING ERC TEST RUN) ─── */}
          {testRunActive && diagnosis.status === 'NOMINAL' && (
            ['esp32_vin', 'rail_5v', 'rail_3v3', 'esp32_gpio21', 'esp32_gpio4', 'esp32_gpio34'].map(pinId => {
              const p = pinDict[pinId];
              if (!p) return null;
              return (
                <g key={`test_ping_${pinId}`} transform={`translate(${p.x}, ${p.y})`}>
                  <circle cx="0" cy="0" r="12" fill="#10b981" opacity="0.35" className="animate-ping" />
                  <circle cx="0" cy="0" r="4.5" fill="#34d399" filter="url(#sparkGlow)" />
                  <text x="8" y="-5" fill="#34d399" fontSize="7.5" fontWeight="bold" fontFamily="monospace">
                    ✓ PASS
                  </text>
                </g>
              );
            })
          )}

          {/* ─── RENDER ALL BOARD PINS ─── */}
          {BOARD_PINS.map(pin => {
            const isHovered = hoveredPinId === pin.id;
            const isDragStart = dragStartPinId === pin.id;
            const isAffected = diagnosis.affectedPins.includes(pin.id);

            return (
              <g
                key={pin.id}
                transform={`translate(${pin.x}, ${pin.y})`}
                onClick={() => handlePinClick(pin.id)}
                onMouseEnter={() => setHoveredPinId(pin.id)}
                onMouseLeave={() => setHoveredPinId(null)}
                className="cursor-pointer"
              >
                {/* Pin Target Ring */}
                <circle
                  cx="0"
                  cy="0"
                  r={isHovered || isDragStart ? 7 : 4.5}
                  fill={
                    isAffected ? '#ef4444' :
                    isDragStart ? '#38bdf8' :
                    pin.type === 'POWER' ? '#ef4444' :
                    pin.type === 'GND' ? '#1e293b' :
                    pin.type === 'HIGH_VOLTAGE' ? '#dc2626' :
                    pin.type === 'I2C' ? '#38bdf8' : '#22c55e'
                  }
                  stroke={isHovered ? '#ffffff' : '#64748b'}
                  strokeWidth={isHovered ? 2 : 1}
                />
                {/* Pin Label text */}
                <text
                  x="0"
                  y="-8"
                  textAnchor="middle"
                  fill={isAffected ? '#f87171' : '#94a3b8'}
                  fontSize="7"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {pin.label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hovered Pin Technical Tooltip */}
        {hoveredPinId && pinDict[hoveredPinId] && (
          <div className="absolute bottom-2 left-3 px-3 py-1.5 rounded-lg bg-slate-900/95 border border-slate-700 text-xs text-slate-200 font-mono shadow-xl backdrop-blur-md">
            <span className="font-bold text-cyan-400">{pinDict[hoveredPinId].name}</span>
            <span className="text-slate-400"> · Voltage: </span>
            <span className="text-white font-bold">{pinDict[hoveredPinId].voltage}</span>
            <span className="text-slate-400"> · Component: </span>
            <span className="text-amber-300 font-bold">{pinDict[hoveredPinId].component}</span>
          </div>
        )}

        {/* Instructions Overlay */}
        <div className="absolute top-2 right-2 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-[10px] text-slate-400 font-mono">
          {dragStartPinId ? (
            <span className="text-cyan-400 font-bold animate-pulse">
              Click destination pin to complete wire...
            </span>
          ) : (
            <span>Click any pin to route a wire · Click wire to select/delete</span>
          )}
        </div>
      </div>

      {/* ─── ELECTRICAL RULE CHECK (ERC) DIAGNOSTIC INSPECTION MODAL ─── */}
      {isERCModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-3xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden font-mono">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/80">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl border ${
                  diagnosis.status === 'CRITICAL_HAZARD'
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                    : diagnosis.status === 'WARNING'
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                }`}>
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-sm tracking-wide">
                      Electrical Rule Check (ERC) Diagnostic Report
                    </h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      diagnosis.status === 'CRITICAL_HAZARD'
                        ? 'bg-rose-950 text-rose-300 border-rose-800'
                        : diagnosis.status === 'WARNING'
                        ? 'bg-amber-950 text-amber-300 border-amber-800'
                        : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    }`}>
                      {ercRules.filter(r => r.status === 'PASS').length}/8 RULES PASSED
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Automated static and dynamic netlist inspection across 28 breadboard tie-points
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsERCModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Rule Results List */}
            <div className="p-4 overflow-y-auto space-y-3 flex-1 text-xs">
              {/* Overall Summary Banner */}
              <div className={`p-3 rounded-xl border flex items-start gap-3 ${
                diagnosis.status === 'CRITICAL_HAZARD'
                  ? 'bg-rose-950/60 border-rose-800 text-rose-200'
                  : diagnosis.status === 'WARNING'
                  ? 'bg-amber-950/60 border-amber-800 text-amber-200'
                  : 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
              }`}>
                {diagnosis.status === 'CRITICAL_HAZARD' ? (
                  <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                ) : diagnosis.status === 'WARNING' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold text-sm">{diagnosis.title}</div>
                  <div className="text-[11px] mt-0.5 text-slate-300">{diagnosis.description}</div>
                </div>
              </div>

              {/* 8 Rule Cards */}
              <div className="space-y-2">
                <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider px-1">
                  Verified Electrical Nets (8 System Checks):
                </div>
                {ercRules.map((rule, idx) => (
                  <div
                    key={rule.id}
                    className={`p-3 rounded-xl border transition-all ${
                      rule.status === 'FAIL'
                        ? 'bg-rose-950/30 border-rose-800/80'
                        : rule.status === 'WARN'
                        ? 'bg-amber-950/30 border-amber-800/80'
                        : 'bg-slate-950/60 border-slate-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800/60">
                      <div className="flex items-center gap-2">
                        {rule.status === 'FAIL' ? (
                          <AlertOctagon className="w-4 h-4 text-rose-400" />
                        ) : rule.status === 'WARN' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        )}
                        <span className="font-bold text-white text-[12px]">
                          {idx + 1}. {rule.name}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded font-bold bg-slate-800 text-slate-300 border border-slate-700">
                          {rule.category}
                        </span>
                      </div>
                      <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                        rule.status === 'FAIL'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : rule.status === 'WARN'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      }`}>
                        {rule.measuredValue}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-300 mt-2 leading-relaxed">
                      {rule.details}
                    </p>

                    <div className="mt-2 text-[10px] text-slate-400 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                      <strong className="text-cyan-400">Viva Defense Note: </strong>
                      <span>{rule.vivaNote}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 border-t border-slate-800 bg-slate-950">
              <div className="text-[11px] text-slate-400">
                Routed Wires: <strong className="text-white">{wires.length}</strong> · Active Tie-Points: <strong className="text-white">28</strong>
              </div>
              <div className="flex items-center gap-2">
                {diagnosis.status !== 'NOMINAL' && (
                  <button
                    onClick={() => {
                      loadPreset('nominal');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-cyan-950 text-cyan-300 border border-cyan-800 hover:bg-cyan-900 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset to Nominal</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setIsERCModalOpen(false);
                    startERCTest();
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Re-Run ERC Diagnostic</span>
                </button>
                <button
                  onClick={() => setIsERCModalOpen(false)}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

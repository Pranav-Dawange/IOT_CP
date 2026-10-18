/**
 * MachinePrototype3D.tsx
 *
 * Full WebGL 3D Interactive Digital Twin & Hardware Workbench
 * Built with Three.js (r182+) & OrbitControls:
 *
 * - Realistic 3D Breadboard with tie-points, power rails, and center trench
 * - High-detail 3D ESP32 DevKit V1 with RF shield, USB port, buttons & flashing LEDs
 * - MB102 Power Supply module with barrel jack, latch switch, and regulators
 * - ACS712 Current Sensor with Phoenix 2-pin screw terminals
 * - LM393 Optical Gate straddling an 8-notch spinning encoder disc
 * - Maxim DS18B20 stainless steel probe clamped to motor stator
 * - InvenSense MPU-6050 with 3-axis orientation
 * - Songle SRD-05VDC blue relay module with optocoupler & cutoff indicator
 * - RS-775 24V DC Spindle Motor with dynamic thermal glow, rotating shaft, and turbine fan
 * - 3D Curved Flexible DuPont Wires (CatmullRom curves) with traveling signal packets
 * - Interactive 3D Raycasting (hover & click to inspect components)
 * - Camera view presets: Isometric, ESP32 Focus, Motor Focus, Top-Down
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AlertTriangle, Camera, Compass, Maximize2, RotateCcw, Zap } from 'lucide-react';

interface MachinePrototype3DProps {
  telemetry: {
    rpm: number;
    torque: number;
    tempC: number;
    tempK: number;
    currentA: number;
    voltage: number;
    powerW: number;
    vibrationG: number;
    risk: number;
    status: string;
  };
  benchPowerOn: boolean;
  relayTripped: boolean;
  wifiSignal: boolean;
  selectedComponentId: string | null;
  onSelectComponent: (id: string) => void;
  wireBusFilter: string;
}

export const MachinePrototype3D: React.FC<MachinePrototype3DProps> = ({
  telemetry,
  benchPowerOn,
  relayTripped,
  wifiSignal,
  selectedComponentId,
  onSelectComponent,
  wireBusFilter,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredComponent, setHoveredComponent] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const [webglError, setWebglError] = useState(false);

  // References for dynamic updates inside animation loop
  const dynamicRefs = useRef({
    motorShaft: null as THREE.Group | null,
    discGroup: null as THREE.Group | null,
    fanGroup: null as THREE.Group | null,
    motorMesh: null as THREE.Mesh | null,
    relayCutoffLed: null as THREE.Mesh | null,
    wifiLed: null as THREE.Mesh | null,
    pulseParticles: [] as { mesh: THREE.Mesh; curve: THREE.CatmullRomCurve3; speed: number; progress: number }[],
    camera: null as THREE.PerspectiveCamera | null,
    controls: null as OrbitControls | null,
  });

  // Camera preset handler
  const setCameraPreset = (preset: 'iso' | 'esp32' | 'motor' | 'top') => {
    const { camera, controls } = dynamicRefs.current;
    if (!camera || !controls) return;

    if (preset === 'iso') {
      camera.position.set(16, 15, 20);
      controls.target.set(0, 1.5, 0);
    } else if (preset === 'esp32') {
      camera.position.set(-2, 8, 8);
      controls.target.set(-2, 1, 0);
    } else if (preset === 'motor') {
      camera.position.set(10, 8, 8);
      controls.target.set(8, 2, 0);
    } else if (preset === 'top') {
      camera.position.set(2, 24, 0.1);
      controls.target.set(2, 0, 0);
    }
    controls.update();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight || 460;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060913);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
    camera.position.set(16, 15, 20);
    dynamicRefs.current.camera = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      container.appendChild(renderer.domElement);
    } catch (err) {
      console.warn('[ThreeJS] WebGL not supported or context creation failed:', err);
      setWebglError(true);
      return;
    }

    // 2. OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Do not go beneath floor
    controls.minDistance = 6;
    controls.maxDistance = 50;
    controls.target.set(1, 1.5, 0);
    controls.update();
    dynamicRefs.current.controls = controls;

    // 3. Lighting
    const ambientLight = new THREE.AmbientLight(0x334155, 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
    dirLight.position.set(18, 28, 16);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 70;
    dirLight.shadow.camera.left = -16;
    dirLight.shadow.camera.right = 16;
    dirLight.shadow.camera.top = 16;
    dirLight.shadow.camera.bottom = -16;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    const blueFill = new THREE.PointLight(0x38bdf8, 2.5, 30);
    blueFill.position.set(-12, 10, -8);
    scene.add(blueFill);

    const warmFill = new THREE.PointLight(0xf97316, 1.8, 30);
    warmFill.position.set(14, 8, 12);
    scene.add(warmFill);

    // 4. Workbench ESD Table Mat
    const tableMat = new THREE.Mesh(
      new THREE.BoxGeometry(38, 0.4, 26),
      new THREE.MeshStandardMaterial({
        color: 0x0a1120,
        roughness: 0.65,
        metalness: 0.25,
      })
    );
    tableMat.position.y = -0.2;
    tableMat.receiveShadow = true;
    scene.add(tableMat);

    // Workbench Grid Lines
    const gridHelper = new THREE.GridHelper(36, 36, 0x1e293b, 0x0f172a);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Clickable Interactive Objects Map
    const interactiveObjects: { mesh: THREE.Object3D; id: string; name: string }[] = [];

    // Helper to register interactive component
    const registerInteractive = (obj: THREE.Object3D, id: string, name: string) => {
      obj.userData = { id, name };
      interactiveObjects.push({ mesh: obj, id, name });
    };

    // ─── 5. 3D BREADBOARD MODEL ──────────────────────────────────────────────
    const breadboardGroup = new THREE.Group();
    breadboardGroup.position.set(-3.5, 0, 0);

    // Breadboard Plastic Body
    const bbBody = new THREE.Mesh(
      new THREE.BoxGeometry(16, 0.9, 11),
      new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.5,
        metalness: 0.05,
      })
    );
    bbBody.position.y = 0.45;
    bbBody.castShadow = true;
    bbBody.receiveShadow = true;
    breadboardGroup.add(bbBody);

    // Center Divider Trench
    const trench = new THREE.Mesh(
      new THREE.BoxGeometry(14.5, 0.3, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.9 })
    );
    trench.position.set(0, 0.91, 0);
    breadboardGroup.add(trench);

    // Power Rails (Red & Blue lines)
    const createRail = (z: number, color: number) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(14.5, 0.02, 0.12),
        new THREE.MeshBasicMaterial({ color })
      );
      rail.position.set(0, 0.92, z);
      breadboardGroup.add(rail);
    };
    createRail(-4.6, 0xef4444); // Top Red (+)
    createRail(-4.2, 0x3b82f6); // Top Blue (-)
    createRail(4.2, 0xef4444);  // Bottom Red (+)
    createRail(4.6, 0x3b82f6);  // Bottom Blue (-)

    // Breadboard Socket Holes
    const holeGeo = new THREE.BoxGeometry(0.12, 0.05, 0.12);
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
    const holesInstanced = new THREE.InstancedMesh(holeGeo, holeMat, 22 * 10);
    let hIdx = 0;
    const dummy = new THREE.Object3D();
    for (let x = -6.5; x <= 6.5; x += 0.62) {
      // Upper rows (a..e)
      for (let z = -3.4; z <= -0.6; z += 0.7) {
        dummy.position.set(x, 0.92, z);
        dummy.updateMatrix();
        holesInstanced.setMatrixAt(hIdx++, dummy.matrix);
      }
      // Lower rows (f..j)
      for (let z = 0.6; z <= 3.4; z += 0.7) {
        dummy.position.set(x, 0.92, z);
        dummy.updateMatrix();
        holesInstanced.setMatrixAt(hIdx++, dummy.matrix);
      }
    }
    holesInstanced.instanceMatrix.needsUpdate = true;
    breadboardGroup.add(holesInstanced);
    scene.add(breadboardGroup);

    // ─── 6. 3D MB102 POWER SUPPLY MODULE ─────────────────────────────────────
    const mb102Group = new THREE.Group();
    mb102Group.position.set(-10, 0.9, 0);

    const mb102Pcb = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.18, 10.5),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.2 })
    );
    mb102Pcb.position.y = 0.09;
    mb102Pcb.castShadow = true;
    mb102Group.add(mb102Pcb);

    // DC Barrel Jack (Cylinder)
    const barrelJack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1.2, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.8 })
    );
    barrelJack.rotation.z = Math.PI / 2;
    barrelJack.position.set(-0.5, 0.65, -3.8);
    mb102Group.add(barrelJack);

    // Power Latch Push Switch
    const pwrSwitch = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.6, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 })
    );
    pwrSwitch.position.set(0, 0.45, -2.2);
    mb102Group.add(pwrSwitch);

    // Power LED
    const pwrLed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 0.2, 12),
      new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        emissive: 0x22c55e,
        emissiveIntensity: benchPowerOn ? 2.5 : 0.2,
      })
    );
    pwrLed.position.set(0, 0.25, -1.2);
    mb102Group.add(pwrLed);

    // Dual AMS1117 Regulators
    const reg1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.2, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7 })
    );
    reg1.position.set(0, 0.25, 0.5);
    const reg2 = reg1.clone();
    reg2.position.set(0, 0.25, 2.2);
    mb102Group.add(reg1);
    mb102Group.add(reg2);

    registerInteractive(mb102Pcb, 'mb102', 'MB102 Breadboard Power Supply');
    scene.add(mb102Group);

    // ─── 7. 3D ESP32 DEVKIT V1 MODULE ─────────────────────────────────────────
    const esp32Group = new THREE.Group();
    esp32Group.position.set(-3.5, 1.1, 0);

    // ESP32 Matte Black PCB
    const esp32Pcb = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.16, 2.8),
      new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.3,
        metalness: 0.1,
      })
    );
    esp32Pcb.position.y = 0.08;
    esp32Pcb.castShadow = true;
    esp32Group.add(esp32Pcb);

    // Metal RF Shield Can (ESP-WROOM-32)
    const rfShield = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.32, 2.2),
      new THREE.MeshStandardMaterial({
        color: 0xd1d5db,
        roughness: 0.2,
        metalness: 0.9,
      })
    );
    rfShield.position.set(0.6, 0.25, 0);
    rfShield.castShadow = true;
    esp32Group.add(rfShield);

    // Micro-USB Port
    const usbPort = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.35, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.95, roughness: 0.1 })
    );
    usbPort.position.set(-2.6, 0.25, 0);
    esp32Group.add(usbPort);

    // Wi-Fi / MQTT Status LED
    const wifiLed = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.1, 0.18),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x38bdf8,
        emissiveIntensity: 2.0,
      })
    );
    wifiLed.position.set(1.8, 0.2, 0.8);
    esp32Group.add(wifiLed);
    dynamicRefs.current.wifiLed = wifiLed;

    // Dual 15-Pin Black Header Strips
    const headerStrip1 = new THREE.Mesh(
      new THREE.BoxGeometry(5.0, 0.45, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x020617, roughness: 0.8 })
    );
    headerStrip1.position.set(0, -0.22, -1.25);
    const headerStrip2 = headerStrip1.clone();
    headerStrip2.position.set(0, -0.22, 1.25);
    esp32Group.add(headerStrip1);
    esp32Group.add(headerStrip2);

    registerInteractive(esp32Pcb, 'esp32', 'ESP32 DevKit V1 Microcontroller');
    scene.add(esp32Group);

    // ─── 8. 3D 0.96″ SSD1306 OLED DISPLAY ─────────────────────────────────────
    const oledGroup = new THREE.Group();
    oledGroup.position.set(-7.2, 1.1, -2.6);

    const oledPcb = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.14, 2.8),
      new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.4 })
    );
    oledPcb.position.y = 0.07;
    oledGroup.add(oledPcb);

    // Glass Screen with Emissive OLED Surface
    const oledGlass = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 0.18, 2.1),
      new THREE.MeshStandardMaterial({
        color: 0x020617,
        emissive: 0x0284c7,
        emissiveIntensity: benchPowerOn ? 0.9 : 0.0,
        roughness: 0.1,
        metalness: 0.9,
      })
    );
    oledGlass.position.set(0, 0.18, 0.15);
    oledGroup.add(oledGlass);

    registerInteractive(oledPcb, 'oled', '0.96″ I2C OLED Display (SSD1306)');
    scene.add(oledGroup);

    // ─── 9. 3D ACS712 CURRENT TRANSDUCER ──────────────────────────────────────
    const acsGroup = new THREE.Group();
    acsGroup.position.set(-7.2, 1.1, 2.4);

    const acsPcb = new THREE.Mesh(
      new THREE.BoxGeometry(2.9, 0.14, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x065f46, roughness: 0.4 })
    );
    acsPcb.position.y = 0.07;
    acsGroup.add(acsPcb);

    // Phoenix 2-Pin Screw Terminal (Green Box + Brass Screws)
    const phoenixBlock = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.75, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.5 })
    );
    phoenixBlock.position.set(-0.6, 0.45, 0);
    acsGroup.add(phoenixBlock);

    const screw1 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.9, roughness: 0.2 })
    );
    screw1.position.set(-0.6, 0.85, -0.35);
    const screw2 = screw1.clone();
    screw2.position.set(-0.6, 0.85, 0.35);
    acsGroup.add(screw1);
    acsGroup.add(screw2);

    registerInteractive(acsPcb, 'acs712', 'ACS712 Hall-Effect Current Sensor');
    scene.add(acsGroup);

    // ─── 10. 3D MPU-6050 6-DOF IMU (GY-521) ──────────────────────────────────
    const mpuGroup = new THREE.Group();
    mpuGroup.position.set(-3.5, 1.1, 3.2);

    const mpuPcb = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 0.12, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4 })
    );
    mpuPcb.position.y = 0.06;
    mpuGroup.add(mpuPcb);

    const mpuIc = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.15, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 })
    );
    mpuIc.position.set(0, 0.15, 0);
    mpuGroup.add(mpuIc);

    registerInteractive(mpuPcb, 'mpu6050', 'MPU-6050 6-Axis IMU (GY-521)');
    scene.add(mpuGroup);

    // ─── 11. 3D SONGLE 5V SAFETY RELAY MODULE ────────────────────────────────
    const relayGroup = new THREE.Group();
    relayGroup.position.set(1.6, 1.1, 2.4);

    const relayPcb = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.14, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 })
    );
    relayPcb.position.y = 0.07;
    relayGroup.add(relayPcb);

    // Blue Songle Box Cube
    const songleBox = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.4, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.25 })
    );
    songleBox.position.set(-0.4, 0.77, 0);
    songleBox.castShadow = true;
    relayGroup.add(songleBox);

    // Relay Trip LED
    const tripLed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.15, 12),
      new THREE.MeshStandardMaterial({
        color: relayTripped ? 0xef4444 : 0x22c55e,
        emissive: relayTripped ? 0xef4444 : 0x22c55e,
        emissiveIntensity: 2.2,
      })
    );
    tripLed.position.set(0.8, 0.2, 0.6);
    relayGroup.add(tripLed);
    dynamicRefs.current.relayCutoffLed = tripLed;

    registerInteractive(relayPcb, 'relay', 'Songle 5V Safety Cutoff Relay');
    scene.add(relayGroup);

    // ─── 12. 3D RS-775 24V DC SPINDLE MOTOR RIG (RIGHT WORKBENCH) ────────────
    const motorRigGroup = new THREE.Group();
    motorRigGroup.position.set(9.5, 0, 0);

    // Heavy Industrial Steel Mounting Base
    const motorStand = new THREE.Mesh(
      new THREE.BoxGeometry(6.5, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.6 })
    );
    motorStand.position.y = 0.25;
    motorStand.castShadow = true;
    motorStand.receiveShadow = true;
    motorRigGroup.add(motorStand);

    // Cylindrical RS-775 Motor Body
    const motorGeo = new THREE.CylinderGeometry(1.6, 1.6, 5.0, 32);
    const motorMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.85,
      roughness: 0.25,
      emissive: new THREE.Color(0xef4444),
      emissiveIntensity: 0.05,
    });
    const motorBody = new THREE.Mesh(motorGeo, motorMat);
    motorBody.rotation.x = Math.PI / 2;
    motorBody.position.set(0, 2.2, -2.2);
    motorBody.castShadow = true;
    motorRigGroup.add(motorBody);
    dynamicRefs.current.motorMesh = motorBody;

    // DS18B20 Clamped Stator Capsule (Mounted on motor cylinder)
    const statorProbe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 2.4, 16),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.95, roughness: 0.1 })
    );
    statorProbe.rotation.z = Math.PI / 2;
    statorProbe.position.set(0, 3.85, -2.2);
    motorRigGroup.add(statorProbe);

    // Motor Shaft & Spindle Group (Rotating)
    const shaftGroup = new THREE.Group();
    shaftGroup.position.set(0, 2.2, 0.5);

    // Central Steel Shaft
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 5.0, 24),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.95, roughness: 0.1 })
    );
    shaft.rotation.x = Math.PI / 2;
    shaftGroup.add(shaft);

    // 8-Notch Acrylic Encoder Disc
    const discGroup = new THREE.Group();
    discGroup.position.set(0, 0, 1.2);

    const discMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.7, 1.7, 0.12, 32),
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.3,
        metalness: 0.4,
        transparent: true,
        opacity: 0.85,
      })
    );
    discMesh.rotation.x = Math.PI / 2;
    discGroup.add(discMesh);

    // 8 Slotted Teeth Lines
    const slotGeo = new THREE.BoxGeometry(0.12, 0.65, 0.15);
    const slotMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const slot = new THREE.Mesh(slotGeo, slotMat);
      slot.position.set(Math.cos(angle) * 1.3, Math.sin(angle) * 1.3, 0);
      slot.rotation.z = angle;
      discGroup.add(slot);
    }
    shaftGroup.add(discGroup);
    dynamicRefs.current.discGroup = discGroup;

    // Impeller Turbine Cooling Fan
    const fanGroup = new THREE.Group();
    fanGroup.position.set(0, 0, 2.3);
    const bladeGeo = new THREE.BoxGeometry(0.25, 2.4, 0.08);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 });
    for (let b = 0; b < 6; b++) {
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.rotation.z = (b * Math.PI) / 3;
      fanGroup.add(blade);
    }
    shaftGroup.add(fanGroup);
    dynamicRefs.current.fanGroup = fanGroup;

    motorRigGroup.add(shaftGroup);
    dynamicRefs.current.motorShaft = shaftGroup;

    // LM393 Optical Gate Sensor (Bracket Straddling Encoder Disc)
    const lm393Group = new THREE.Group();
    lm393Group.position.set(1.4, 2.2, 1.7);

    const uBracket = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.4, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.5 })
    );
    lm393Group.add(uBracket);

    // Glowing Optical IR Beam
    const irBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.9, 8),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    );
    irBeam.rotation.x = Math.PI / 2;
    irBeam.position.set(-0.4, 0, 0);
    lm393Group.add(irBeam);

    motorRigGroup.add(lm393Group);

    registerInteractive(motorBody, 'motor', 'RS-775 24V DC Spindle Motor');
    registerInteractive(statorProbe, 'ds18b20', 'DS18B20 Stator Thermal Probe');
    registerInteractive(uBracket, 'lm393', 'LM393 Optical Speed Tachometer');
    scene.add(motorRigGroup);

    // ─── 13. 3D CURVED FLEXIBLE DUPONT JUMPER WIRES ───────────────────────────
    const wireDefinitions = [
      {
        id: 'pwr_5v',
        bus: 'power',
        color: 0xef4444,
        points: [
          new THREE.Vector3(-9.2, 1.2, -3.2),
          new THREE.Vector3(-8.0, 2.2, -4.0),
          new THREE.Vector3(-5.0, 1.8, -4.6),
          new THREE.Vector3(-2.8, 1.3, -4.6),
        ],
      },
      {
        id: 'gnd',
        bus: 'power',
        color: 0x1e293b,
        points: [
          new THREE.Vector3(-9.2, 1.2, -2.8),
          new THREE.Vector3(-7.5, 2.0, -3.5),
          new THREE.Vector3(-4.0, 1.6, -4.2),
          new THREE.Vector3(-1.8, 1.3, -4.2),
        ],
      },
      {
        id: 'oled_sda',
        bus: 'i2c',
        color: 0x38bdf8,
        points: [
          new THREE.Vector3(-6.0, 1.2, -2.0),
          new THREE.Vector3(-5.2, 2.1, -1.5),
          new THREE.Vector3(-4.5, 1.8, -1.0),
          new THREE.Vector3(-4.0, 1.3, -0.6),
        ],
      },
      {
        id: 'oled_scl',
        bus: 'i2c',
        color: 0xeab308,
        points: [
          new THREE.Vector3(-6.0, 1.2, -1.6),
          new THREE.Vector3(-5.0, 2.0, -1.0),
          new THREE.Vector3(-4.2, 1.6, -0.7),
          new THREE.Vector3(-3.8, 1.3, -0.3),
        ],
      },
      {
        id: 'acs_adc',
        bus: 'adc',
        color: 0x22c55e,
        points: [
          new THREE.Vector3(-6.0, 1.2, 2.2),
          new THREE.Vector3(-5.0, 2.4, 1.5),
          new THREE.Vector3(-4.0, 2.0, 0.8),
          new THREE.Vector3(-3.2, 1.3, 0.4),
        ],
      },
      {
        id: 'mpu_i2c',
        bus: 'i2c',
        color: 0x38bdf8,
        points: [
          new THREE.Vector3(-3.5, 1.2, 2.5),
          new THREE.Vector3(-3.2, 2.0, 1.8),
          new THREE.Vector3(-3.4, 1.7, 1.0),
          new THREE.Vector3(-3.5, 1.3, 0.6),
        ],
      },
      {
        id: 'relay_in',
        bus: 'power',
        color: 0xf8fafc,
        points: [
          new THREE.Vector3(0.5, 1.2, 2.2),
          new THREE.Vector3(-0.5, 2.2, 1.5),
          new THREE.Vector3(-1.8, 1.8, 0.8),
          new THREE.Vector3(-2.8, 1.3, 0.4),
        ],
      },
      {
        id: 'ds18b20_wire',
        bus: 'onewire',
        color: 0xa855f7,
        points: [
          new THREE.Vector3(9.5, 3.8, -2.2),
          new THREE.Vector3(6.5, 4.5, -1.0),
          new THREE.Vector3(2.0, 3.2, 0.0),
          new THREE.Vector3(-1.5, 1.4, 0.3),
        ],
      },
      {
        id: 'lm393_tach',
        bus: 'interrupt',
        color: 0xf97316,
        points: [
          new THREE.Vector3(10.5, 2.2, 1.7),
          new THREE.Vector3(7.0, 3.5, 2.5),
          new THREE.Vector3(2.5, 2.8, 1.5),
          new THREE.Vector3(-1.5, 1.4, 0.7),
        ],
      },
      {
        id: 'motor_24v_loop',
        bus: 'motor',
        color: 0xdc2626,
        points: [
          new THREE.Vector3(2.5, 1.4, 2.4),
          new THREE.Vector3(5.5, 3.2, 2.0),
          new THREE.Vector3(8.0, 3.5, 0.5),
          new THREE.Vector3(9.5, 2.4, -0.5),
        ],
      },
    ];

    const pulseList: { mesh: THREE.Mesh; curve: THREE.CatmullRomCurve3; speed: number; progress: number }[] = [];

    wireDefinitions.forEach(wDef => {
      const curve = new THREE.CatmullRomCurve3(wDef.points);
      const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.08, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: wDef.color,
        roughness: 0.35,
        metalness: 0.15,
      });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      tubeMesh.castShadow = true;
      scene.add(tubeMesh);

      // Black Crimp Connector Boots at ends
      const bootGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.4, 12);
      const bootMat = new THREE.MeshStandardMaterial({ color: 0x020617, roughness: 0.8 });
      const boot1 = new THREE.Mesh(bootGeo, bootMat);
      boot1.position.copy(wDef.points[0]);
      const boot2 = new THREE.Mesh(bootGeo, bootMat);
      boot2.position.copy(wDef.points[wDef.points.length - 1]);
      scene.add(boot1);
      scene.add(boot2);

      // Traveling Energy Pulse Particle
      const pulseGeo = new THREE.SphereGeometry(0.14, 12, 12);
      const pulseMat = new THREE.MeshBasicMaterial({ color: wDef.color });
      const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
      scene.add(pulseMesh);

      pulseList.push({
        mesh: pulseMesh,
        curve,
        speed: 0.008 + Math.random() * 0.004,
        progress: Math.random(),
      });
    });
    dynamicRefs.current.pulseParticles = pulseList;

    // ─── 14. RAYCASTING INTERACTION (MOUSE HOVER & CLICK) ─────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handlePointerMove = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const targetMeshes = interactiveObjects.map(io => io.mesh);
      const intersects = raycaster.intersectObjects(targetMeshes, true);

      if (intersects.length > 0) {
        let hit = intersects[0].object;
        while (hit.parent && !hit.userData.id && hit !== scene) {
          hit = hit.parent;
        }
        if (hit.userData.id) {
          setHoveredComponent({
            id: hit.userData.id,
            name: hit.userData.name,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
          container.style.cursor = 'pointer';
          return;
        }
      }
      setHoveredComponent(null);
      container.style.cursor = 'default';
    };

    const handleClick = () => {
      raycaster.setFromCamera(mouse, camera);
      const targetMeshes = interactiveObjects.map(io => io.mesh);
      const intersects = raycaster.intersectObjects(targetMeshes, true);

      if (intersects.length > 0) {
        let hit = intersects[0].object;
        while (hit.parent && !hit.userData.id && hit !== scene) {
          hit = hit.parent;
        }
        if (hit.userData.id) {
          onSelectComponent(hit.userData.id);
        }
      }
    };

    renderer.domElement.addEventListener('mousemove', handlePointerMove);
    renderer.domElement.addEventListener('click', handleClick);

    // ─── 15. MAIN RENDER ANIMATION LOOP ───────────────────────────────────────
    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // 1. Rotate motor shaft, disc, and fan proportionally to RPM
      if (dynamicRefs.current.motorShaft) {
        const speed = (telemetry.rpm / 60) * 0.12;
        dynamicRefs.current.motorShaft.rotation.z += speed;
      }

      // 2. Animate traveling wire pulse particles
      dynamicRefs.current.pulseParticles.forEach(p => {
        p.progress = (p.progress + p.speed) % 1.0;
        const pt = p.curve.getPoint(p.progress);
        p.mesh.position.copy(pt);
      });

      // 3. Dynamic motor thermal glow
      if (dynamicRefs.current.motorMesh) {
        const mat = dynamicRefs.current.motorMesh.material as THREE.MeshStandardMaterial;
        const heatRatio = Math.max(0, Math.min(1, (telemetry.tempC - 20) / 35));
        mat.emissive.setHex(telemetry.tempC > 40 ? 0xef4444 : telemetry.tempC > 32 ? 0xf59e0b : 0x38bdf8);
        mat.emissiveIntensity = heatRatio * 0.8;
      }

      // 4. Relay LED
      if (dynamicRefs.current.relayCutoffLed) {
        const rMat = dynamicRefs.current.relayCutoffLed.material as THREE.MeshStandardMaterial;
        rMat.color.setHex(relayTripped ? 0xef4444 : 0x22c55e);
        rMat.emissive.setHex(relayTripped ? 0xef4444 : 0x22c55e);
        rMat.emissiveIntensity = relayTripped ? 2.5 : 1.2;
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const newW = container.clientWidth;
      const newH = container.clientHeight || 460;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('mousemove', handlePointerMove);
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-[450px] rounded-xl overflow-hidden bg-[#060913] border border-slate-800 shadow-inner">
      {/* Three.js Canvas Container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Camera Preset Toolbar */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 p-1 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-mono backdrop-blur-md shadow-lg z-10">
        <span className="text-[10px] text-slate-400 font-bold px-1.5 uppercase flex items-center gap-1">
          <Compass className="w-3 h-3 text-cyan-400" /> View:
        </span>
        <button
          onClick={() => setCameraPreset('iso')}
          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white transition-colors"
        >
          Isometric
        </button>
        <button
          onClick={() => setCameraPreset('esp32')}
          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white transition-colors"
        >
          ESP32
        </button>
        <button
          onClick={() => setCameraPreset('motor')}
          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white transition-colors"
        >
          Motor Rig
        </button>
        <button
          onClick={() => setCameraPreset('top')}
          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white transition-colors"
        >
          Top-Down
        </button>
      </div>

      {/* Orbit Controls Hint Badge */}
      <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-800 text-[10px] font-mono text-slate-400 backdrop-blur-sm pointer-events-none">
        🖱️ Left Click: Rotate · Right Click: Pan · Scroll: Zoom
      </div>

      {/* Real-Time Live Status Pill */}
      <div className="absolute top-3 right-3 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 font-mono text-xs shadow-lg backdrop-blur-md z-10">
        <div className={`w-2.5 h-2.5 rounded-full ${relayTripped ? 'bg-rose-500 animate-ping' : telemetry.rpm > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
        <span className="text-white font-bold">{telemetry.rpm} RPM</span>
        <span className="text-slate-500">|</span>
        <span className="text-cyan-400 font-bold">{telemetry.powerW.toFixed(0)} W</span>
      </div>

      {/* Interactive Raycast Hover Tooltip */}
      {hoveredComponent && (
        <div
          className="absolute z-20 pointer-events-none px-2.5 py-1 rounded-lg bg-cyan-950/95 border border-cyan-400 text-cyan-200 text-xs font-mono shadow-2xl backdrop-blur-md"
          style={{
            left: `${hoveredComponent.x + 12}px`,
            top: `${hoveredComponent.y - 28}px`,
          }}
        >
          <div className="font-bold flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span>{hoveredComponent.name}</span>
          </div>
          <div className="text-[9px] text-cyan-400/80">Click to inspect technical specs</div>
        </div>
      )}

      {/* WebGL Hardware Fallback Overlay */}
      {webglError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 text-slate-400 p-6 text-center space-y-3 z-30">
          <AlertTriangle className="w-10 h-10 text-amber-400" />
          <h3 className="text-white font-bold text-sm">WebGL Hardware Acceleration Unavailable</h3>
          <p className="text-xs max-w-md text-slate-400">
            WebGL 3D graphics could not initialize in this headless or GPU-disabled session. The complete system is fully functional via the 2D Breadboard, Circuit Schematic, Pinout Matrix, and FFT Spectrum Analyzer.
          </p>
        </div>
      )}
    </div>
  );
};

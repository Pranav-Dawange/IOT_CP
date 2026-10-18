import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown,
  ChevronUp, Copy, Eye, HelpCircle, Info, Layers, Maximize2,
  Minimize2, Play, Radio, RefreshCw, RotateCcw, RotateCw,
  Sliders, Sparkles, Volume2, VolumeX, Waves, Wrench, Zap
} from 'lucide-react';

export interface VibrationSpectrumAnalyzerProps {
  rpm: number;
  vibrationG: number;
  isBearingWearActive?: boolean;
  onToggleBearingWear?: (active: boolean) => void;
  isPowered?: boolean;
  className?: string;
  compact?: boolean;
}

// Bearing geometry definition
export interface BearingGeometry {
  name: string;
  code: string;
  ballsZ: number;       // Number of rolling elements
  ballDiameterMm: number; // d (mm)
  pitchDiameterMm: number; // Dp (mm)
  contactAngleDeg: number; // alpha (degrees)
  description: string;
}

export const BEARING_PRESETS: Record<string, BearingGeometry> = {
  '608zz': {
    name: 'RS-775 Spindle 608ZZ',
    code: '608ZZ',
    ballsZ: 8,
    ballDiameterMm: 3.967,
    pitchDiameterMm: 20.0,
    contactAngleDeg: 0,
    description: 'Miniature radial deep-groove ball bearing installed on RS-775 DC motor shaft (8mm bore, 22mm OD).',
  },
  '6205': {
    name: 'Industrial Spindle 6205',
    code: '6205',
    ballsZ: 9,
    ballDiameterMm: 7.938,
    pitchDiameterMm: 38.5,
    contactAngleDeg: 0,
    description: 'Standard medium industrial ball bearing for 25mm shafts in industrial induction motors.',
  },
  '6308': {
    name: 'Heavy Duty 6308',
    code: '6308',
    ballsZ: 8,
    ballDiameterMm: 15.08,
    pitchDiameterMm: 66.0,
    contactAngleDeg: 0,
    description: 'Heavy duty roller bearing used in high-torque industrial gearboxes and pump drives.',
  },
};

export type FaultMode = 'NOMINAL' | 'BPFI' | 'BPFO' | 'BSF' | 'FTF' | 'MULTI_WEAR';

export const FAULT_DESCRIPTIONS: Record<FaultMode, { title: string; tag: string; color: string; desc: string }> = {
  NOMINAL: {
    title: 'Healthy Baseline (ISO Zone A/B)',
    tag: 'HEALTHY',
    color: '#10b981',
    desc: 'Low broadband noise floor with minimal 1× rotational speed peak. No bearing defect frequencies detected.',
  },
  BPFI: {
    title: 'Inner Raceway Spalling (BPFI)',
    tag: 'INNER RACE',
    color: '#f43f5e',
    desc: 'Pitting or spall on inner race passes rolling elements under load. Generates sharp BPFI peak with 1× fr modulation sidebands.',
  },
  BPFO: {
    title: 'Outer Raceway Fluting (BPFO)',
    tag: 'OUTER RACE',
    color: '#f97316',
    desc: 'Localized outer ring defect in fixed load zone. Produces distinct stationary impact peak at BPFO and its 2× harmonic.',
  },
  BSF: {
    title: 'Rolling Element Defect (BSF)',
    tag: 'BALL SPALL',
    color: '#06b6d4',
    desc: 'Spalling on a rotating ball strikes both inner and outer races per rotation. Generates non-synchronous BSF and 2× BSF harmonics.',
  },
  FTF: {
    title: 'Cage Looseness / Retainer (FTF)',
    tag: 'CAGE FAULT',
    color: '#eab308',
    desc: 'Retainer pocket wear or cracked ball cage causes sub-synchronous modulation (< 0.5× fr) and fundamental train jitter.',
  },
  MULTI_WEAR: {
    title: 'Critical Multi-Defect Bearing Wear',
    tag: 'CRITICAL ISO-D',
    color: '#ef4444',
    desc: 'Severe compound wear: elevated noise floor, combined BPFI + BPFO peaks, massive harmonic skirt, and high Crest Factor.',
  },
};

export const VibrationSpectrumAnalyzer: React.FC<VibrationSpectrumAnalyzerProps> = ({
  rpm,
  vibrationG,
  isBearingWearActive = false,
  onToggleBearingWear,
  isPowered = true,
  className = '',
  compact = false,
}) => {
  // Preset & Geometry
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>('608zz');
  const [geometry, setGeometry] = useState<BearingGeometry>(BEARING_PRESETS['608zz']);
  const [isCustomGeometry, setIsCustomGeometry] = useState(false);

  // Active Fault Mode (internal selection or driven by prop)
  const [selectedFault, setSelectedFault] = useState<FaultMode>(isBearingWearActive ? 'MULTI_WEAR' : 'NOMINAL');

  // Display & UI state
  const [viewMode, setViewMode] = useState<'spectrum' | 'time' | 'dual' | 'formulas'>('spectrum');
  const [freqSpan, setFreqSpan] = useState<200 | 500 | 1000>(500);
  const [powerScale, setPowerScale] = useState<'linear' | 'log'>('linear');
  const [showMarkers, setShowMarkers] = useState(true);
  const [showSidebands, setShowSidebands] = useState(true);
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [hoverData, setHoverData] = useState<{ freq: number; amp: number; x: number; y: number } | null>(null);

  // Audio Context for mechanical impact preview
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioIntervalRef = useRef<number | null>(null);

  // Sync external bearing wear toggle with local fault mode
  useEffect(() => {
    if (isBearingWearActive && selectedFault === 'NOMINAL') {
      setSelectedFault('MULTI_WEAR');
    } else if (!isBearingWearActive && selectedFault === 'MULTI_WEAR') {
      setSelectedFault('NOMINAL');
    }
  }, [isBearingWearActive]);

  // Update geometry when preset changes
  const handlePresetChange = (presetKey: string) => {
    setSelectedPresetKey(presetKey);
    if (presetKey in BEARING_PRESETS) {
      setGeometry(BEARING_PRESETS[presetKey]);
      setIsCustomGeometry(false);
    } else {
      setIsCustomGeometry(true);
    }
  };

  // ─── BEARING KINEMATICS CALCULATIONS ───────────────────────────────────────
  const kinematics = useMemo(() => {
    const effectiveRpm = isPowered ? rpm : 0;
    const fr = effectiveRpm / 60; // Shaft rotational frequency in Hz
    const gamma = geometry.ballDiameterMm / geometry.pitchDiameterMm;
    const rad = (geometry.contactAngleDeg * Math.PI) / 180;
    const cosAlpha = Math.cos(rad);
    const Z = geometry.ballsZ;

    // Kinematic Bearing Defect Frequencies (ISO 15243 / Harris & Kotzalas)
    const bpfo = (Z / 2) * fr * (1 - gamma * cosAlpha);
    const bpfi = (Z / 2) * fr * (1 + gamma * cosAlpha);
    const ftf = 0.5 * fr * (1 - gamma * cosAlpha);
    const bsf = (geometry.pitchDiameterMm / (2 * geometry.ballDiameterMm)) * fr * (1 - Math.pow(gamma * cosAlpha, 2));

    return {
      effectiveRpm,
      fr,
      gamma,
      cosAlpha,
      bpfo,
      bpfi,
      ftf,
      bsf,
      harmonics: {
        fr1: fr,
        fr2: 2 * fr,
        fr3: 3 * fr,
        bpfo2: 2 * bpfo,
        bsf2: 2 * bsf,
        bpfi_minus_fr: Math.max(0, bpfi - fr),
        bpfi_plus_fr: bpfi + fr,
      },
    };
  }, [rpm, isPowered, geometry]);

  // ─── SYNTHESIZE TIME & FREQUENCY DATA ──────────────────────────────────────
  const [spectralBins, setSpectralBins] = useState<number[]>([]);
  const [timeWaveform, setTimeWaveform] = useState<number[]>([]);
  const [statisticalMetrics, setStatisticalMetrics] = useState({
    rms: 0,
    peak: 0,
    crestFactor: 0,
    kurtosis: 3.0,
    isoZone: 'A',
  });

  // Real-time signal generator loop (60 FPS / 16ms)
  useEffect(() => {
    let animFrame: number;
    let tick = 0;
    const binCount = 300;
    const timePoints = 180;

    const generateData = () => {
      tick += 1;
      const { fr, bpfo, bpfi, bsf, ftf, effectiveRpm } = kinematics;

      if (!isPowered || effectiveRpm < 50) {
        // Motor off or idle
        setSpectralBins(new Array(binCount).fill(0).map(() => 0.02 + Math.random() * 0.02));
        setTimeWaveform(new Array(timePoints).fill(0).map(() => (Math.random() - 0.5) * 0.05));
        setStatisticalMetrics({ rms: 0.02, peak: 0.05, crestFactor: 1.4, kurtosis: 3.0, isoZone: 'A' });
        animFrame = requestAnimationFrame(generateData);
        return;
      }

      // Base vibration amplitude from telemetry or fault mode
      let baseVib = vibrationG;
      if (selectedFault === 'MULTI_WEAR') baseVib = Math.max(baseVib, 4.4);
      else if (selectedFault !== 'NOMINAL') baseVib = Math.max(baseVib, 2.6);

      // Noise floor (pink/white noise mix)
      const bins: number[] = [];
      const df = freqSpan / binCount;

      for (let i = 0; i < binCount; i++) {
        const f = i * df;
        // Background baseline noise floor with 1/f decay
        let power = 0.03 + (0.04 / (1 + f * 0.02)) + (Math.random() - 0.5) * 0.02;

        // 1X Shaft Unbalance Peak
        const dFr = Math.abs(f - fr);
        if (dFr < 8) {
          power += (0.45 * (baseVib / 2)) * Math.exp(-Math.pow(dFr / 2.2, 2));
        }

        // 2X Shaft Misalignment Harmonic
        const dFr2 = Math.abs(f - 2 * fr);
        if (dFr2 < 8) {
          power += (0.22 * (baseVib / 2)) * Math.exp(-Math.pow(dFr2 / 2.0, 2));
        }

        // Fault-specific resonance spikes:
        if (selectedFault === 'BPFI' || selectedFault === 'MULTI_WEAR') {
          // Sharp inner race defect peak
          const dBPFI = Math.abs(f - bpfi);
          if (dBPFI < 10) {
            power += (1.85 * (baseVib / 2)) * Math.exp(-Math.pow(dBPFI / 2.4, 2));
          }
          // Modulation sidebands at BPFI ± fr
          const dLeft = Math.abs(f - (bpfi - fr));
          if (dLeft < 8) power += (0.65 * (baseVib / 2)) * Math.exp(-Math.pow(dLeft / 2.0, 2));
          const dRight = Math.abs(f - (bpfi + fr));
          if (dRight < 8) power += (0.65 * (baseVib / 2)) * Math.exp(-Math.pow(dRight / 2.0, 2));
        }

        if (selectedFault === 'BPFO' || selectedFault === 'MULTI_WEAR') {
          // Dominant outer race defect peak
          const dBPFO = Math.abs(f - bpfo);
          if (dBPFO < 10) {
            power += (1.95 * (baseVib / 2)) * Math.exp(-Math.pow(dBPFO / 2.2, 2));
          }
          // 2X BPFO harmonic
          const dBPFO2 = Math.abs(f - 2 * bpfo);
          if (dBPFO2 < 10) {
            power += (0.95 * (baseVib / 2)) * Math.exp(-Math.pow(dBPFO2 / 2.4, 2));
          }
        }

        if (selectedFault === 'BSF' || selectedFault === 'MULTI_WEAR') {
          // Non-synchronous ball spinning defect
          const dBSF = Math.abs(f - bsf);
          if (dBSF < 8) {
            power += (1.35 * (baseVib / 2)) * Math.exp(-Math.pow(dBSF / 2.0, 2));
          }
          const dBSF2 = Math.abs(f - 2 * bsf);
          if (dBSF2 < 8) {
            power += (0.75 * (baseVib / 2)) * Math.exp(-Math.pow(dBSF2 / 2.2, 2));
          }
        }

        if (selectedFault === 'FTF' || selectedFault === 'MULTI_WEAR') {
          // Sub-synchronous cage defect peak
          const dFTF = Math.abs(f - ftf);
          if (dFTF < 6) {
            power += (0.95 * (baseVib / 2)) * Math.exp(-Math.pow(dFTF / 1.8, 2));
          }
        }

        // Add small jitter
        power += (Math.random() - 0.5) * 0.03 * power;
        bins.push(Math.max(0.01, power));
      }

      setSpectralBins(bins);

      // Synthesize Time-Domain Acceleration Waveform az(t)
      const wave: number[] = [];
      const dt = 0.0004; // 2500 Hz sampling rate
      const t0 = tick * 0.015;
      let sumSq = 0;
      let maxAbs = 0;
      let sum4 = 0;

      for (let j = 0; j < timePoints; j++) {
        const t = t0 + j * dt;
        let a = 0.4 * Math.sin(2 * Math.PI * fr * t); // 1X
        a += 0.15 * Math.sin(4 * Math.PI * fr * t); // 2X

        if (selectedFault === 'BPFI' || selectedFault === 'MULTI_WEAR') {
          // Impulsive bursts modulated by 1X rotation
          const mod = 1 + 0.8 * Math.cos(2 * Math.PI * fr * t);
          const carrier = Math.sin(2 * Math.PI * bpfi * t);
          a += 1.4 * mod * carrier;
        }

        if (selectedFault === 'BPFO' || selectedFault === 'MULTI_WEAR') {
          a += 1.3 * Math.sin(2 * Math.PI * bpfo * t);
        }

        if (selectedFault === 'BSF' || selectedFault === 'MULTI_WEAR') {
          a += 0.9 * Math.sin(2 * Math.PI * bsf * t);
        }

        if (selectedFault === 'FTF') {
          a += 0.6 * Math.sin(2 * Math.PI * ftf * t);
        }

        // Background noise
        a += (Math.random() - 0.5) * 0.25;

        // Scale by overall vibration level
        const sample = a * (baseVib / 2.2);
        wave.push(sample);

        const absS = Math.abs(sample);
        sumSq += sample * sample;
        if (absS > maxAbs) maxAbs = absS;
        sum4 += Math.pow(sample, 4);
      }

      setTimeWaveform(wave);

      // Compute condition monitoring metrics
      const computedRms = Math.sqrt(sumSq / timePoints);
      const computedPeak = maxAbs;
      const computedCF = computedRms > 0.05 ? computedPeak / computedRms : 1.4;
      // Kurtosis = E[x^4] / (E[x^2])^2
      const meanSq = sumSq / timePoints;
      const computedKurtosis = meanSq > 0.01 ? (sum4 / timePoints) / (meanSq * meanSq) : 3.0;

      // ISO 10816-3 Zone
      let iso = 'A';
      if (computedRms > 2.8 || computedPeak > 4.5) iso = 'D';
      else if (computedRms > 1.8) iso = 'C';
      else if (computedRms > 1.1) iso = 'B';

      setStatisticalMetrics({
        rms: computedRms,
        peak: computedPeak,
        crestFactor: computedCF,
        kurtosis: computedKurtosis,
        isoZone: iso,
      });

      animFrame = requestAnimationFrame(generateData);
    };

    animFrame = requestAnimationFrame(generateData);
    return () => cancelAnimationFrame(animFrame);
  }, [kinematics, isPowered, selectedFault, vibrationG, freqSpan]);

  // ─── AUDIO DEMODULATION / SONIC BEARING CLICKER ────────────────────────────
  const toggleAudio = () => {
    if (isAudioActive) {
      if (audioIntervalRef.current) clearInterval(audioIntervalRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close();
      audioCtxRef.current = null;
      setIsAudioActive(false);
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;

      // Defect impact click generator: emits periodic micro-clicks at target defect frequency
      const targetFreq =
        selectedFault === 'BPFI' ? kinematics.bpfi :
        selectedFault === 'BPFO' ? kinematics.bpfo :
        selectedFault === 'BSF'  ? kinematics.bsf :
        selectedFault === 'FTF'  ? kinematics.ftf :
        kinematics.fr;

      const clickIntervalMs = Math.max(12, Math.round(1000 / Math.max(10, targetFreq)));

      audioIntervalRef.current = window.setInterval(() => {
        if (!audioCtxRef.current || audioCtxRef.current.state !== 'running') return;
        const now = audioCtxRef.current.currentTime;
        const osc = audioCtxRef.current.createOscillator();
        const gain = audioCtxRef.current.createGain();

        // High frequency ping simulating metal-on-metal bearing spall micro-impact
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1400 + Math.random() * 400, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.015);

        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);

        osc.connect(gain);
        gain.connect(audioCtxRef.current.destination);

        osc.start(now);
        osc.stop(now + 0.02);
      }, clickIntervalMs);

      setIsAudioActive(true);
    } catch (e) {
      console.warn('AudioContext not supported or blocked:', e);
    }
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioIntervalRef.current) clearInterval(audioIntervalRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  // ─── CANVAS DRAWING (FFT SPECTRUM & BEARING MARKERS) ────────────────────────
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || spectralBins.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Padding for axes & labels
    const padL = 44;
    const padR = 20;
    const padT = 30;
    const padB = 30;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, padT, 0, height - padB);
    bgGrad.addColorStop(0, '#090d16');
    bgGrad.addColorStop(1, '#030712');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(padL, padT, plotW, plotH);

    // Grid lines & Axis values
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);

    // Frequency grid (X axis: 0 to freqSpan Hz)
    const freqStep = freqSpan === 200 ? 25 : freqSpan === 500 ? 50 : 100;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    for (let f = 0; f <= freqSpan; f += freqStep) {
      const x = padL + (f / freqSpan) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, height - padB);
      ctx.stroke();
      ctx.fillText(`${f}Hz`, x, height - padB + 14);
    }

    // Amplitude grid (Y axis)
    const maxAmp = powerScale === 'linear' ? 3.5 : 20; // 3.5g or +20dB
    const minAmp = powerScale === 'linear' ? 0 : -60; // 0g or -60dB
    const ampStep = powerScale === 'linear' ? 0.7 : 20;
    ctx.textAlign = 'right';

    for (let a = minAmp; a <= maxAmp; a += ampStep) {
      const normY = (a - minAmp) / (maxAmp - minAmp);
      const y = height - padB - normY * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
      const label = powerScale === 'linear' ? `${a.toFixed(1)}g` : `${Math.round(a)}dB`;
      ctx.fillText(label, padL - 6, y + 3);
    }
    ctx.setLineDash([]); // Reset line dash

    // ISO 10816 Alarm Threshold Line (at 2.8g)
    if (powerScale === 'linear' && 2.8 <= maxAmp) {
      const alarmY = height - padB - (2.8 / maxAmp) * plotH;
      ctx.strokeStyle = '#ef444488';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      ctx.moveTo(padL, alarmY);
      ctx.lineTo(width - padR, alarmY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ef4444';
      ctx.textAlign = 'left';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('ISO 10816 TRIP (2.8g)', padL + 6, alarmY - 4);
    }

    // Draw Spectrum Path
    ctx.beginPath();
    const binCount = spectralBins.length;
    const df = freqSpan / binCount;

    for (let i = 0; i < binCount; i++) {
      const f = i * df;
      const x = padL + (f / freqSpan) * plotW;
      let val = spectralBins[i];
      let yVal = val;
      if (powerScale === 'log') {
        // Convert to dB: 20 * log10(val / 0.1)
        yVal = 20 * Math.log10(Math.max(0.001, val / 0.1));
      }
      const normY = Math.max(0, Math.min(1, (yVal - minAmp) / (maxAmp - minAmp)));
      const y = height - padB - normY * plotH;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Line stroke with neon electric glow
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#0284c7';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0; // Reset blur

    // Under-curve gradient fill
    ctx.lineTo(width - padR, height - padB);
    ctx.lineTo(padL, height - padB);
    ctx.closePath();
    const areaGrad = ctx.createLinearGradient(0, padT, 0, height - padB);
    areaGrad.addColorStop(0, 'rgba(56, 189, 248, 0.28)');
    areaGrad.addColorStop(1, 'rgba(14, 165, 233, 0.01)');
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // ─── BEARING CHARACTERISTIC FREQUENCY MARKERS ────────────────────────────
    if (showMarkers && kinematics.fr > 0) {
      const markers = [
        { label: '1X (fr)', freq: kinematics.fr, color: '#38bdf8', tag: 'Shaft' },
        { label: '2X (2fr)', freq: 2 * kinematics.fr, color: '#a855f7', tag: '2nd' },
        { label: 'FTF', freq: kinematics.ftf, color: '#eab308', tag: 'Cage' },
        { label: 'BSF', freq: kinematics.bsf, color: '#10b981', tag: 'Ball' },
        { label: 'BPFO', freq: kinematics.bpfo, color: '#f97316', tag: 'Outer' },
        { label: 'BPFI', freq: kinematics.bpfi, color: '#f43f5e', tag: 'Inner' },
      ];

      markers.forEach(m => {
        if (m.freq <= 0 || m.freq > freqSpan) return;
        const x = padL + (m.freq / freqSpan) * plotW;

        // Vertical guide line
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, height - padB);
        ctx.stroke();
        ctx.setLineDash([]);

        // Marker Flag at top
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.roundRect(x - 18, padT - 18, 36, 15, 3);
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(m.label, x, padT - 7);

        // Subtext showing frequency in Hz
        ctx.fillStyle = m.color;
        ctx.font = '8px monospace';
        ctx.fillText(`${m.freq.toFixed(1)}`, x, padT + 12);
      });

      // Sideband markers around BPFI (BPFI ± fr)
      if (showSidebands && (selectedFault === 'BPFI' || selectedFault === 'MULTI_WEAR')) {
        const sidebands = [
          { f: kinematics.bpfi - kinematics.fr, label: '-1X' },
          { f: kinematics.bpfi + kinematics.fr, label: '+1X' },
        ];
        sidebands.forEach(sb => {
          if (sb.f <= 0 || sb.f > freqSpan) return;
          const x = padL + (sb.f / freqSpan) * plotW;
          ctx.strokeStyle = '#f43f5e88';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(x, padT + 20);
          ctx.lineTo(x, height - padB);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#f43f5e';
          ctx.font = '7px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`SB ${sb.label}`, x, padT + 28);
        });
      }
    }

    // ─── INTERACTIVE HOVER CROSSHAIR ─────────────────────────────────────────
    if (hoverData) {
      const { x, y, freq, amp } = hoverData;
      if (x >= padL && x <= width - padR && y >= padT && y <= height - padB) {
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);

        // Vertical crosshair
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, height - padB);
        ctx.stroke();

        // Horizontal crosshair
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(width - padR, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Coordinate Badge
        const badgeText = `${freq.toFixed(1)} Hz · ${amp.toFixed(2)}${powerScale === 'linear' ? 'g' : 'dB'}`;
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        const bw = 120;
        const bx = Math.min(width - padR - bw - 4, Math.max(padL + 4, x - bw / 2));
        const by = Math.max(padT + 4, y - 24);
        ctx.fillRect(bx, by, bw, 20);
        ctx.strokeRect(bx, by, bw, 20);

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(badgeText, bx + bw / 2, by + 13);
      }
    }
  }, [spectralBins, kinematics, freqSpan, powerScale, showMarkers, showSidebands, hoverData]);

  // Handle canvas mouse move for interactive cursor
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const padL = 44;
    const padR = 20;
    const padT = 30;
    const padB = 30;
    const plotW = canvas.width - padL - padR;
    const plotH = canvas.height - padT - padB;

    if (mouseX >= padL && mouseX <= canvas.width - padR && mouseY >= padT && mouseY <= canvas.height - padB) {
      const normX = (mouseX - padL) / plotW;
      const freq = normX * freqSpan;

      const maxAmp = powerScale === 'linear' ? 3.5 : 20;
      const minAmp = powerScale === 'linear' ? 0 : -60;
      const normY = (canvas.height - padB - mouseY) / plotH;
      const amp = minAmp + normY * (maxAmp - minAmp);

      setHoverData({ freq, amp, x: mouseX, y: mouseY });
    } else {
      setHoverData(null);
    }
  };

  const handleMouseLeave = () => setHoverData(null);

  // Set fault mode and inform parent if toggling full bearing wear
  const handleSelectFault = (mode: FaultMode) => {
    setSelectedFault(mode);
    if (onToggleBearingWear) {
      if (mode === 'MULTI_WEAR') onToggleBearingWear(true);
      else if (mode === 'NOMINAL') onToggleBearingWear(false);
    }
  };

  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-2xl p-4 shadow-2xl font-mono space-y-4 ${className}`}>
      {/* ─── HEADER BAR: TITLE & TOOLBAR CONTROLS ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/40 text-cyan-400 shadow-md">
            <Waves className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-sm tracking-wide">
                MPU-6050 FFT Spectrum Analyzer
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950 text-cyan-400 border border-cyan-800">
                400kHz I2C · Radix-2 FFT
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
              <span>Bearing Defect Kinematics:</span>
              <span className="text-cyan-300 font-bold">BPFI · BPFO · FTF · BSF</span>
              <span>· ISO 10816 Class II</span>
            </div>
          </div>
        </div>

        {/* View mode switcher */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          {[
            { id: 'spectrum', label: 'FFT Power', icon: <Waves className="w-3.5 h-3.5" /> },
            { id: 'time', label: 'Time Wave az(t)', icon: <Activity className="w-3.5 h-3.5" /> },
            { id: 'dual', label: 'Dual Domain', icon: <Layers className="w-3.5 h-3.5" /> },
            { id: 'formulas', label: 'Kinematics & Viva', icon: <HelpCircle className="w-3.5 h-3.5" /> },
          ].map(v => (
            <button
              key={v.id}
              onClick={() => setViewMode(v.id as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                viewMode === v.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v.icon}
              <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ─── LIVE NUMERICAL KPI TILES ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
        {/* Shaft Speed 1X */}
        <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
          <div className="text-[10px] text-slate-500 flex items-center justify-between">
            <span>Shaft 1X (fr)</span>
            <RotateCw className="w-3 h-3 text-cyan-400" />
          </div>
          <div className="text-base font-bold text-cyan-300 mt-1">
            {kinematics.fr.toFixed(1)} <span className="text-[10px] text-slate-500 font-normal">Hz</span>
          </div>
          <div className="text-[9px] text-slate-500 font-mono mt-0.5">
            {kinematics.effectiveRpm} RPM · 2X: {(kinematics.fr * 2).toFixed(1)}Hz
          </div>
        </div>

        {/* BPFI (Inner Race) */}
        <div className={`p-2.5 rounded-xl bg-slate-950 border transition-colors ${selectedFault === 'BPFI' || selectedFault === 'MULTI_WEAR' ? 'border-rose-500/60 bg-rose-950/20' : 'border-slate-800'}`}>
          <div className="text-[10px] text-slate-500 flex items-center justify-between">
            <span className="font-bold text-rose-400">BPFI (Inner)</span>
            <span className="text-[9px] text-slate-500 font-mono">{(kinematics.bpfi / (kinematics.fr || 1)).toFixed(2)}× fr</span>
          </div>
          <div className="text-base font-bold text-rose-400 mt-1">
            {kinematics.bpfi.toFixed(1)} <span className="text-[10px] text-slate-500 font-normal">Hz</span>
          </div>
          <div className="text-[9px] text-slate-400 font-mono mt-0.5">
            SB: ±{kinematics.fr.toFixed(0)}Hz (Spalling)
          </div>
        </div>

        {/* BPFO (Outer Race) */}
        <div className={`p-2.5 rounded-xl bg-slate-950 border transition-colors ${selectedFault === 'BPFO' || selectedFault === 'MULTI_WEAR' ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-800'}`}>
          <div className="text-[10px] text-slate-500 flex items-center justify-between">
            <span className="font-bold text-amber-400">BPFO (Outer)</span>
            <span className="text-[9px] text-slate-500 font-mono">{(kinematics.bpfo / (kinematics.fr || 1)).toFixed(2)}× fr</span>
          </div>
          <div className="text-base font-bold text-amber-400 mt-1">
            {kinematics.bpfo.toFixed(1)} <span className="text-[10px] text-slate-500 font-normal">Hz</span>
          </div>
          <div className="text-[9px] text-slate-400 font-mono mt-0.5">
            Fluting · 2×: {(kinematics.bpfo * 2).toFixed(1)}Hz
          </div>
        </div>

        {/* BSF (Ball Spin) */}
        <div className={`p-2.5 rounded-xl bg-slate-950 border transition-colors ${selectedFault === 'BSF' || selectedFault === 'MULTI_WEAR' ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800'}`}>
          <div className="text-[10px] text-slate-500 flex items-center justify-between">
            <span className="font-bold text-emerald-400">BSF (Ball)</span>
            <span className="text-[9px] text-slate-500 font-mono">{(kinematics.bsf / (kinematics.fr || 1)).toFixed(2)}× fr</span>
          </div>
          <div className="text-base font-bold text-emerald-400 mt-1">
            {kinematics.bsf.toFixed(1)} <span className="text-[10px] text-slate-500 font-normal">Hz</span>
          </div>
          <div className="text-[9px] text-slate-400 font-mono mt-0.5">
            Rolling Element Pitting
          </div>
        </div>

        {/* Crest Factor */}
        <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
          <div className="text-[10px] text-slate-500 flex items-center justify-between">
            <span>Crest Factor (CF)</span>
            <Zap className="w-3 h-3 text-yellow-400" />
          </div>
          <div className={`text-base font-bold mt-1 ${statisticalMetrics.crestFactor > 4.0 ? 'text-rose-400' : statisticalMetrics.crestFactor > 3.0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {statisticalMetrics.crestFactor.toFixed(2)}
          </div>
          <div className="text-[9px] text-slate-500 font-mono mt-0.5">
            {statisticalMetrics.crestFactor > 4.0 ? '⚠ Impulsive Shocks' : 'Nominal Smooth'}
          </div>
        </div>

        {/* Kurtosis & ISO Status */}
        <div className={`p-2.5 rounded-xl bg-slate-950 border transition-colors ${statisticalMetrics.isoZone === 'D' ? 'border-rose-600/70' : statisticalMetrics.isoZone === 'C' ? 'border-amber-600/70' : 'border-slate-800'}`}>
          <div className="text-[10px] text-slate-500 flex items-center justify-between">
            <span>Kurtosis (β₂)</span>
            <span className={`px-1.5 py-0.2 rounded font-bold text-[9px] ${
              statisticalMetrics.isoZone === 'D' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
              statisticalMetrics.isoZone === 'C' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
              'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            }`}>
              ISO Zone {statisticalMetrics.isoZone}
            </span>
          </div>
          <div className="text-base font-bold text-white mt-1">
            {statisticalMetrics.kurtosis.toFixed(2)}
          </div>
          <div className="text-[9px] text-slate-500 font-mono mt-0.5">
            Gaussian: ~3.0 · RMS: {statisticalMetrics.rms.toFixed(2)}g
          </div>
        </div>
      </div>

      {/* ─── MAIN VISUALIZATION AREA (CANVAS / OSCILLOSCOPE / FORMULAS) ─── */}
      {(viewMode === 'spectrum' || viewMode === 'dual') && (
        <div className="space-y-2">
          {/* Canvas Spectrum Plot */}
          <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-inner">
            <canvas
              ref={canvasRef}
              width={820}
              height={viewMode === 'dual' ? 220 : 320}
              className="w-full block cursor-crosshair"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            />

            {/* Quick interactive badges overlay */}
            <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-sm border border-slate-800 px-2 py-1 rounded-lg text-[10px]">
              <span className="text-slate-400">Freq Span:</span>
              {[200, 500, 1000].map(span => (
                <button
                  key={span}
                  onClick={() => setFreqSpan(span as any)}
                  className={`px-1.5 py-0.5 rounded font-bold ${
                    freqSpan === span ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {span}Hz
                </button>
              ))}
              <span className="text-slate-600">|</span>
              <button
                onClick={() => setPowerScale(powerScale === 'linear' ? 'log' : 'linear')}
                className={`px-1.5 py-0.5 rounded font-bold ${
                  powerScale === 'log' ? 'bg-purple-500 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {powerScale === 'linear' ? 'Linear (g)' : 'Log (dB)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── TIME DOMAIN OSCILLOGRAM a_z(t) ─── */}
      {(viewMode === 'time' || viewMode === 'dual') && (
        <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs pb-1 border-b border-slate-800/80">
            <span className="font-bold text-white flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              Time-Domain Acceleration Signal: a_z(t) [MPU-6050 Accelerometer]
            </span>
            <span className="text-[10px] text-cyan-400 font-mono">
              fs = 2.5 kHz · Window: Hanning · RMS = {statisticalMetrics.rms.toFixed(2)}g
            </span>
          </div>

          {/* SVG Waveform renderer */}
          <div className="h-28 w-full bg-slate-950 rounded-lg border border-slate-900 relative overflow-hidden flex items-center">
            {/* Center zero line */}
            <div className="absolute inset-x-0 top-1/2 border-b border-slate-800/60" />

            <svg className="w-full h-full overflow-visible" viewBox="0 0 180 80" preserveAspectRatio="none">
              <defs>
                <linearGradient id="waveGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#0284c7" />
                </linearGradient>
              </defs>
              <path
                d={timeWaveform
                  .map((val, idx) => {
                    const x = idx;
                    const y = 40 - val * 18; // scale
                    return `${idx === 0 ? 'M' : 'L'} ${x} ${Math.max(2, Math.min(78, y))}`;
                  })
                  .join(' ')}
                fill="none"
                stroke="url(#waveGlow)"
                strokeWidth="1.6"
              />
            </svg>

            {/* Timebase indicator */}
            <div className="absolute bottom-1 right-2 text-[9px] text-slate-500 font-mono">
              Window: 72 ms · Peak: {statisticalMetrics.peak.toFixed(2)}g
            </div>
          </div>
        </div>
      )}

      {/* ─── KINEMATICS & VIVA DEFENSE EQUATIONS VIEW ─── */}
      {viewMode === 'formulas' && (
        <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-cyan-400" />
              <span className="font-bold text-white text-sm">
                Academic & Industrial Viva Defense: Bearing Kinematic Equations
              </span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              ISO 15243 Mechanical Damage & Harris Rolling Bearing Analysis
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
            {/* BPFO Equation */}
            <div className="p-3 bg-slate-900/80 rounded-xl border border-amber-900/40 space-y-2">
              <div className="flex justify-between items-center text-amber-400 font-bold">
                <span>1. Ball Pass Frequency Outer Race (BPFO)</span>
                <span className="text-[10px] bg-amber-950 px-2 py-0.5 rounded border border-amber-800">Outer Ring</span>
              </div>
              <div className="p-2 rounded bg-slate-950 border border-slate-800 text-cyan-300 text-[11px]">
                BPFO = (Z / 2) · f_r · [ 1 - (d / D_p) · cos(α) ]
              </div>
              <div className="text-[10px] text-slate-400 space-y-1">
                <div>Substituted Parameters:</div>
                <div className="text-slate-300">
                  = ({geometry.ballsZ} / 2) · {kinematics.fr.toFixed(2)}Hz · [ 1 - ({geometry.ballDiameterMm} / {geometry.pitchDiameterMm}) · cos({geometry.contactAngleDeg}°) ]
                </div>
                <div className="text-amber-400 font-bold">
                  = 4 · {kinematics.fr.toFixed(2)} · (1 - {kinematics.gamma.toFixed(4)}) = <span className="text-base text-amber-300">{kinematics.bpfo.toFixed(2)} Hz</span>
                </div>
              </div>
            </div>

            {/* BPFI Equation */}
            <div className="p-3 bg-slate-900/80 rounded-xl border border-rose-900/40 space-y-2">
              <div className="flex justify-between items-center text-rose-400 font-bold">
                <span>2. Ball Pass Frequency Inner Race (BPFI)</span>
                <span className="text-[10px] bg-rose-950 px-2 py-0.5 rounded border border-rose-800">Inner Spall</span>
              </div>
              <div className="p-2 rounded bg-slate-950 border border-slate-800 text-cyan-300 text-[11px]">
                BPFI = (Z / 2) · f_r · [ 1 + (d / D_p) · cos(α) ]
              </div>
              <div className="text-[10px] text-slate-400 space-y-1">
                <div>Substituted Parameters:</div>
                <div className="text-slate-300">
                  = ({geometry.ballsZ} / 2) · {kinematics.fr.toFixed(2)}Hz · [ 1 + ({geometry.ballDiameterMm} / {geometry.pitchDiameterMm}) · cos({geometry.contactAngleDeg}°) ]
                </div>
                <div className="text-rose-400 font-bold">
                  = 4 · {kinematics.fr.toFixed(2)} · (1 + {kinematics.gamma.toFixed(4)}) = <span className="text-base text-rose-300">{kinematics.bpfi.toFixed(2)} Hz</span>
                </div>
              </div>
            </div>

            {/* BSF Equation */}
            <div className="p-3 bg-slate-900/80 rounded-xl border border-emerald-900/40 space-y-2">
              <div className="flex justify-between items-center text-emerald-400 font-bold">
                <span>3. Ball Spin Frequency (BSF)</span>
                <span className="text-[10px] bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">Rolling Ball</span>
              </div>
              <div className="p-2 rounded bg-slate-950 border border-slate-800 text-cyan-300 text-[11px]">
                BSF = [ D_p / (2 · d) ] · f_r · [ 1 - ((d / D_p) · cos(α))² ]
              </div>
              <div className="text-[10px] text-slate-400 space-y-1">
                <div>Substituted Parameters:</div>
                <div className="text-slate-300">
                  = [ {geometry.pitchDiameterMm} / (2 · {geometry.ballDiameterMm}) ] · {kinematics.fr.toFixed(2)}Hz · [ 1 - ({kinematics.gamma.toFixed(4)})² ]
                </div>
                <div className="text-emerald-400 font-bold">
                  = {(geometry.pitchDiameterMm / (2 * geometry.ballDiameterMm)).toFixed(3)} · {kinematics.fr.toFixed(2)} · {(1 - Math.pow(kinematics.gamma, 2)).toFixed(4)} = <span className="text-base text-emerald-300">{kinematics.bsf.toFixed(2)} Hz</span>
                </div>
              </div>
            </div>

            {/* FTF Equation */}
            <div className="p-3 bg-slate-900/80 rounded-xl border border-yellow-900/40 space-y-2">
              <div className="flex justify-between items-center text-yellow-400 font-bold">
                <span>4. Fundamental Train Frequency (FTF)</span>
                <span className="text-[10px] bg-yellow-950 px-2 py-0.5 rounded border border-yellow-800">Cage / Train</span>
              </div>
              <div className="p-2 rounded bg-slate-950 border border-slate-800 text-cyan-300 text-[11px]">
                FTF = (1 / 2) · f_r · [ 1 - (d / D_p) · cos(α) ] = BPFO / Z
              </div>
              <div className="text-[10px] text-slate-400 space-y-1">
                <div>Substituted Parameters:</div>
                <div className="text-slate-300">
                  = 0.5 · {kinematics.fr.toFixed(2)}Hz · [ 1 - {kinematics.gamma.toFixed(4)} ]
                </div>
                <div className="text-yellow-400 font-bold">
                  = 0.5 · {kinematics.fr.toFixed(2)} · {(1 - kinematics.gamma).toFixed(4)} = <span className="text-base text-yellow-300">{kinematics.ftf.toFixed(2)} Hz</span>
                </div>
              </div>
            </div>
          </div>

          {/* Condition Monitoring Standards Reference */}
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="font-bold text-white flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Academic Defense Evaluation Criteria (ISO 10816-3 & ISO 13373-1):</span>
            </div>
            <p>
              When a localized spall emerges on the inner race (BPFI), the defect enters and leaves the highest load zone once per shaft revolution, producing sidebands spaced at exactly <span className="text-cyan-300">±1× fr</span> around the carrier frequency. Crest Factor ({'>'} 4.0) and Kurtosis ({'>'} 5.0) indicate high-energy impulsive shocks prior to overall RMS escalation, enabling early predictive alerts 300+ operating hours before catastrophic failure.
            </p>
          </div>
        </div>
      )}

      {/* ─── FAULT INJECTION CONTROLS & BEARING PRESETS ─── */}
      <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white">Bearing Fault Injection & Physical Presets:</span>
          </div>

          {/* Bearing Preset Selector */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 text-[11px]">Rig Bearing:</span>
            <select
              value={selectedPresetKey}
              onChange={e => handlePresetChange(e.target.value)}
              className="bg-slate-900 text-cyan-300 font-bold border border-slate-700 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-cyan-400"
            >
              {Object.entries(BEARING_PRESETS).map(([k, b]) => (
                <option key={k} value={k}>
                  {b.name} (Z={b.ballsZ}, d={b.ballDiameterMm}mm, Dp={b.pitchDiameterMm}mm)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Fault Buttons Matrix */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {(Object.keys(FAULT_DESCRIPTIONS) as FaultMode[]).map(mode => {
            const f = FAULT_DESCRIPTIONS[mode];
            const isSelected = selectedFault === mode;
            return (
              <button
                key={mode}
                onClick={() => handleSelectFault(mode)}
                className={`p-2 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'border-cyan-400 bg-cyan-950/40 shadow-md ring-1 ring-cyan-500'
                    : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: `${f.color}25`, color: f.color }}
                  >
                    {f.tag}
                  </span>
                  {isSelected && <span className="text-[10px] text-cyan-400 font-bold">● ACTIVE</span>}
                </div>
                <div className="text-[11px] font-bold text-white mt-1.5 truncate">
                  {mode === 'NOMINAL' ? 'Nominal Rig' : mode}
                </div>
                <div className="text-[9px] text-slate-400 mt-0.5 line-clamp-1">
                  {f.title.split('(')[0]}
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Fault Explanation Banner */}
        <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-start justify-between gap-3 text-xs">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
            <div>
              <span className="font-bold text-white">{FAULT_DESCRIPTIONS[selectedFault].title}: </span>
              <span className="text-slate-300">{FAULT_DESCRIPTIONS[selectedFault].desc}</span>
            </div>
          </div>

          {/* Audio Demodulation Button */}
          <button
            onClick={toggleAudio}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${
              isAudioActive
                ? 'bg-rose-600 text-white border-rose-500 animate-pulse'
                : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
            }`}
          >
            {isAudioActive ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>{isAudioActive ? 'Stop Audio' : 'Sonic Demodulation'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

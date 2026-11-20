import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Flame,
  Gauge,
  GitBranch,
  Layers,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wifi,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react';
import { Asset } from '../types';

interface SystemOrchestrationFlowProps {
  assets: Asset[];
  selectedAsset: Asset | null;
}

interface PipelineStage {
  step: number;
  id: string;
  title: string;
  subtitle: string;
  layer: 'Perception' | 'Network' | 'Edge' | 'Storage' | 'Intelligence' | 'Broadcast' | 'Actuation';
  icon: React.ReactNode;
  accentColor: string;
  borderColor: string;
  bgGlow: string;
  badge: string;
  inputDescription: string;
  processDescription: string;
  outputDescription: string;
  nextStepName: string;
  nextStepReason: string;
  contractInvariant: string;
}

export const SystemOrchestrationFlow: React.FC<SystemOrchestrationFlowProps> = ({
  assets,
  selectedAsset,
}) => {
  const [activeStep, setActiveStep] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(3000); // ms per step
  const [selectedAssetId, setSelectedAssetId] = useState<string>(selectedAsset?.asset_id || 'asset_01');

  const currentAsset = assets.find((a) => a.asset_id === selectedAssetId) || selectedAsset || assets[0];

  const telem = currentAsset?.latest_telemetry || {
    air_temperature: 300.2,
    process_temperature: 310.8,
    rotational_speed: 1530,
    torque: 42.1,
    tool_wear: 172,
    sequence_number: 142,
    timestamp: new Date().toISOString(),
  };

  const pred = currentAsset?.latest_prediction || {
    failure_probability: 0.724,
    prediction: 1,
    threshold: 0.55,
    window_size: 30,
    prediction_horizon: 10,
  };

  // Pipeline stages definition
  const stages: PipelineStage[] = [
    {
      step: 1,
      id: 'perception',
      title: 'Perception & Hardware Simulation',
      subtitle: '20 Synthetic Industrial Assets emitting 5 raw sensor features',
      layer: 'Perception',
      icon: <Radio className="w-5 h-5 text-cyan-400" />,
      accentColor: 'text-cyan-400',
      borderColor: 'border-cyan-500/50',
      bgGlow: 'bg-cyan-950/20',
      badge: 'Step 1: Ingestion Source',
      inputDescription: 'AI4I 2020 Continuous Industrial Dataset (10,000 observations partitioned into 20 non-overlapping contiguous slices of 500 rows).',
      processDescription: `Simulated edge device clock triggers every 500ms. Reads row #${telem.sequence_number % 500 || 142}, strictly extracts the 5 physical dimensions (Air Temp, Process Temp, Speed, Torque, Tool Wear), and increments the global monotonic sequence number.`,
      outputDescription: `Formatted valid MQTT JSON payload with sequence #${telem.sequence_number} and UTC timestamp. Strictly isolates ground-truth failure labels (never leaked into data stream).`,
      nextStepName: 'Network Messaging Layer (Mosquitto MQTT)',
      nextStepReason: 'The simulated device publishes this packet over TCP to the central MQTT broker so downstream consumers receive it asynchronously.',
      contractInvariant: 'Ground Truth Isolation: Machine failure labels and type tags are strictly withheld from telemetry payloads.',
    },
    {
      step: 2,
      id: 'mqtt_network',
      title: 'Message Broker & Network Transport',
      subtitle: 'Eclipse Mosquitto Pub/Sub router (Port 1883)',
      layer: 'Network',
      icon: <Workflow className="w-5 h-5 text-blue-400" />,
      accentColor: 'text-blue-400',
      borderColor: 'border-blue-500/50',
      bgGlow: 'bg-blue-950/20',
      badge: 'Step 2: Network Fabric',
      inputDescription: `Raw publish event on MQTT topic: 'factory/${currentAsset?.line || 'lineA'}/${currentAsset?.asset_id || 'asset_01'}/telemetry'.`,
      processDescription: 'Mosquitto routes messages with QoS 0/1 to all active subscribers. Decouples physical sensor emitters from processing workers, buffering bursts during network jitter.',
      outputDescription: `Dispatches message to subscribed consumers: the Edge Gateway processor and the Central FastAPI ingestion queue.`,
      nextStepName: 'Edge Processing & Gateway Filtering',
      nextStepReason: 'The Edge Gateway receives the raw packet to calculate rolling noise filters, inspect physical thresholds, and check for sequence packet drops.',
      contractInvariant: 'Topic Hierarchy: Enforces factory/{line}/{asset_id}/{channel} naming standard across all 20 assets.',
    },
    {
      step: 3,
      id: 'edge_processing',
      title: 'Edge Gateway & Pre-Filtering',
      subtitle: 'Noise reduction, threshold checks & sequence gap detection',
      layer: 'Edge',
      icon: <Cpu className="w-5 h-5 text-emerald-400" />,
      accentColor: 'text-emerald-400',
      borderColor: 'border-emerald-500/50',
      bgGlow: 'bg-emerald-950/20',
      badge: 'Step 3: Edge Computing',
      inputDescription: 'Raw sensor readings received from Mosquitto MQTT subscriber.',
      processDescription: `Computes Rolling Moving Average with window size W=5. Simultaneously compares values against physical threshold limits (e.g. Torque > 80 Nm, Temp > 315 K) and verifies that sequence #${telem.sequence_number} is strictly sequential (detecting dropped radio packets).`,
      outputDescription: `Publishes enriched message to 'factory/.../telemetry/processed' containing BOTH raw values and separate smoothed overlay metrics.`,
      nextStepName: 'Central Ingestion & Time-Series Storage',
      nextStepReason: 'Processed data is forwarded to the backend storage layer for permanent time-series persistence in TimescaleDB.',
      contractInvariant: 'Raw Preservation: Smoothed sensor values are kept in separate fields; raw sensor readings are strictly preserved un-smoothed.',
    },
    {
      step: 4,
      id: 'database_storage',
      title: 'Time-Series Storage & Ingestion',
      subtitle: 'TimescaleDB Hypertables & FastAPI Consumer Queue',
      layer: 'Storage',
      icon: <Database className="w-5 h-5 text-indigo-400" />,
      accentColor: 'text-indigo-400',
      borderColor: 'border-indigo-500/50',
      bgGlow: 'bg-indigo-950/20',
      badge: 'Step 4: Relational Persistence',
      inputDescription: 'Edge-processed telemetry messages and diagnostic anomaly alert payloads.',
      processDescription: 'FastAPI async consumer service buffers messages into a thread-safe queue. Inserts telemetry into TimescaleDB hypertables partitioned by timestamp, with duplicate idempotency skipping.',
      outputDescription: `Persisted row in PostgreSQL/TimescaleDB. Telemetry dictionary passed to PredictionService to feed the machine's live sliding buffer.`,
      nextStepName: 'Frozen GRU Predictive Maintenance Engine',
      nextStepReason: 'The newly persisted raw observation is immediately pushed into the temporal buffer to check if it completes a 30-observation inference window.',
      contractInvariant: 'Idempotency: Duplicate sequence numbers or repeated timestamps are safely ignored without throwing primary key violations.',
    },
    {
      step: 5,
      id: 'gru_inference',
      title: 'Predictive ML Engine (Frozen GRU)',
      subtitle: '30-Timestep sliding buffer evaluated against 0.55 decision boundary',
      layer: 'Intelligence',
      icon: <Sparkles className="w-5 h-5 text-amber-400" />,
      accentColor: 'text-amber-400',
      borderColor: 'border-amber-500/50',
      bgGlow: 'bg-amber-950/20',
      badge: 'Step 5: Artificial Intelligence',
      inputDescription: `Strictly the 5 raw features across exactly 30 contiguous time steps [Air Temp, Proc Temp, Speed, Torque, Tool Wear].`,
      processDescription: `Pushes reading into FIFO buffer. If a sequence gap was flagged, the buffer resets to 0 observations to prevent false predictions across missing time. Once buffer reaches 30/30 observations, features are transformed via training-fitted scaler.pkl and passed through the 2-layer GRU model.`,
      outputDescription: `Predicted failure probability for the next 10 observations lookahead horizon (${(pred.failure_probability * 100).toFixed(1)}%). If >= 0.55, sets prediction=1 (Elevated Risk Alert).`,
      nextStepName: 'Live WebSocket & Dashboard Orchestration',
      nextStepReason: 'The prediction score and risk assessment are immediately broadcast to all connected web clients.',
      contractInvariant: 'Strictly Frozen ML: Model weights, training scaler, and 0.55 threshold are strictly frozen. No smoothed data or engineered features enter the GRU.',
    },
    {
      step: 6,
      id: 'websocket_broadcast',
      title: 'Real-Time Streaming & UI Orchestration',
      subtitle: 'WebSocket /ws/live broadcasting to React Dashboard',
      layer: 'Broadcast',
      icon: <Wifi className="w-5 h-5 text-purple-400" />,
      accentColor: 'text-purple-400',
      borderColor: 'border-purple-500/50',
      bgGlow: 'bg-purple-950/20',
      badge: 'Step 6: Live Interface',
      inputDescription: 'Live event payloads emitted by backend services: telemetry, predictions, edge alerts, and device status updates.',
      processDescription: 'ConnectionManager pushes real-time JSON packets over active WebSocket channels (/ws/live) to all connected browser dashboards in sub-millisecond latency.',
      outputDescription: `React state updates: live time-series charts, 3D WebGL digital twin, vibration spectrum analyzer, and anomaly notifications.`,
      nextStepName: 'Operator Closed-Loop Actuation',
      nextStepReason: 'Plant operators and reliability engineers review the live risk assessment to take preventive actions or stress-test the machine.',
      contractInvariant: 'Decoupled Client: Frontend gracefully handles disconnection, reconnection backoff, and buffer accumulation indicators.',
    },
    {
      step: 7,
      id: 'actuation_loop',
      title: 'Operator Action & Digital Twin Control',
      subtitle: 'Closed-loop maintenance dispatch, tool reset & chaos testing',
      layer: 'Actuation',
      icon: <Wrench className="w-5 h-5 text-rose-400" />,
      accentColor: 'text-rose-400',
      borderColor: 'border-rose-500/50',
      bgGlow: 'bg-rose-950/20',
      badge: 'Step 7: Closed-Loop Action',
      inputDescription: 'Operator decisions triggered via the Operator Control Center or Load Test scenarios.',
      processDescription: `Operator clicks 'Dispatch Work Order' (issues crew ticket), 'Replace Tool' (resets cutter wear and re-initializes GRU buffer), or injects deliberate faults (Torque Spike, Thermal Crisis).`,
      outputDescription: `Action dispatches REST API call to /assets/{id}/action. System state updates, re-initializes sequence buffer, and loops back to Step 1 with a healthy or stressed machine state.`,
      nextStepName: 'Loop Continues (Step 1: Next Sensor Observation)',
      nextStepReason: 'Continuous industrial lifecycle restarts for the subsequent sampling interval (every 500ms).',
      contractInvariant: 'Auditability: Every operator intervention, alert acknowledgment, and work order is logged with timestamp and user persona.',
    },
  ];

  // Auto-play stepper animation
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev >= stages.length ? 1 : prev + 1));
    }, playbackSpeed);
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, stages.length]);

  const currentStage = stages[activeStep - 1];

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-300">
      {/* ── Top Header Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl glass-panel border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-gradient-to-br from-cyan-500/20 via-blue-500/20 to-purple-500/20 border border-cyan-500/40 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
            <Workflow className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-extrabold text-white tracking-wide">
                System Architecture &amp; Orchestration Flow
              </h2>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-mono font-bold uppercase tracking-wider">
                Live Data Pipeline
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Visualizing the end-to-end data lifecycle: from physical sensor perception &rarr; edge filtering &rarr; GRU ML inference &rarr; live action.
            </p>
          </div>
        </div>

        {/* Controls: Target Machine & Stepper Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Target Machine Selector */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs">
            <span className="text-slate-400 font-medium">Trace Asset:</span>
            <select
              value={selectedAssetId}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              className="bg-transparent text-cyan-300 font-mono font-bold focus:outline-none cursor-pointer"
            >
              {assets.map((a) => (
                <option key={a.asset_id} value={a.asset_id} className="bg-slate-900 text-white">
                  {a.asset_id.toUpperCase()} ({a.line.replace('line', 'Line ')})
                </option>
              ))}
            </select>
          </div>

          {/* Stepper Play/Pause & Speed */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`p-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition-all ${
                isPlaying
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title={isPlaying ? 'Pause Auto-Advance' : 'Play Auto-Advance'}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isPlaying ? 'Auto-Flow' : 'Paused'}</span>
            </button>

            <button
              onClick={() => setActiveStep((prev) => (prev >= stages.length ? 1 : prev + 1))}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Next Step"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setActiveStep(1)}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Reset to Step 1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Visual 7-Stage Pipeline Breadcrumb ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        {stages.map((st) => {
          const isCurrent = activeStep === st.step;
          const isPassed = activeStep > st.step;

          return (
            <button
              key={st.step}
              onClick={() => {
                setActiveStep(st.step);
                setIsPlaying(false);
              }}
              className={`relative p-3 rounded-xl border text-left transition-all duration-300 flex flex-col justify-between ${
                isCurrent
                  ? `${st.borderColor} ${st.bgGlow} shadow-[0_0_20px_rgba(59,130,246,0.15)] ring-1 ring-blue-500 scale-[1.02]`
                  : isPassed
                  ? 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'
                  : 'border-slate-800/60 bg-slate-950/40 text-slate-400 hover:border-slate-800'
              }`}
            >
              {/* Step Number & Layer */}
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  isCurrent ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                }`}>
                  0{st.step}
                </span>
                <span className="text-[10px] uppercase font-mono tracking-wider opacity-70">
                  {st.layer}
                </span>
              </div>

              {/* Title & Icon */}
              <div className="flex items-center gap-2 mb-1">
                <div className={`p-1 rounded-md ${isCurrent ? 'bg-blue-500/20' : 'bg-slate-800/50'}`}>
                  {st.icon}
                </div>
                <div className="text-xs font-bold leading-tight line-clamp-1 text-white">
                  {st.title.split(' ')[0]}
                </div>
              </div>

              {/* Status Indicator */}
              <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px]">
                <span className={isCurrent ? st.accentColor : 'text-slate-400 font-mono'}>
                  {isCurrent ? 'Processing...' : isPassed ? 'Completed' : 'Upcoming'}
                </span>
                {isPassed && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                {isCurrent && <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />}
              </div>

              {/* Active Arrow Pointer */}
              {isCurrent && (
                <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-blue-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Main Interactive Split: Stage Deep Dive & Live Telemetry Inspector ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Stage Deep Dive Card (7 cols) */}
        <div className={`lg:col-span-7 rounded-2xl border ${currentStage.borderColor} ${currentStage.bgGlow} p-6 glass-panel shadow-2xl relative overflow-hidden transition-all duration-300`}>
          {/* Background Stage Watermark */}
          <div className="absolute top-2 right-4 text-7xl font-mono font-black text-white/[0.03] pointer-events-none select-none">
            0{currentStage.step}
          </div>

          {/* Header of Stage */}
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-700 shadow-inner">
                {currentStage.icon}
              </div>
              <div>
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-blue-400">
                  {currentStage.badge}
                </span>
                <h3 className="text-lg font-bold text-white tracking-wide mt-0.5">
                  {currentStage.title}
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  {currentStage.subtitle}
                </p>
              </div>
            </div>
          </div>

          {/* 3-Box Flow Breakdown: Inputs -> Processing -> Outputs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-5">
            {/* 1. Inputs */}
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-cyan-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                1. Inputs Received
              </span>
              <p className="text-xs text-slate-300 leading-relaxed">
                {currentStage.inputDescription}
              </p>
            </div>

            {/* 2. Process */}
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-amber-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                2. Internal Logic
              </span>
              <p className="text-xs text-slate-300 leading-relaxed">
                {currentStage.processDescription}
              </p>
            </div>

            {/* 3. Outputs */}
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                3. Outputs Emitted
              </span>
              <p className="text-xs text-slate-300 leading-relaxed">
                {currentStage.outputDescription}
              </p>
            </div>
          </div>

          {/* ── Crucial Contract & Architectural Guarantee ── */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-start gap-3 text-xs mb-4">
            <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-white uppercase tracking-wider text-[11px] font-mono block">
                Architectural Invariant Guarantee
              </span>
              <p className="text-slate-300 mt-0.5 leading-relaxed">
                {currentStage.contractInvariant}
              </p>
            </div>
          </div>

          {/* ── Where Does The Data Go Next? (Orchestration Link) ── */}
          <div className="p-4 rounded-xl bg-blue-950/30 border border-blue-500/30 flex items-start justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5">
              <ArrowRight className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5 animate-pulse" />
              <div>
                <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-cyan-300">
                  Next Step in Orchestration:
                </span>
                <div className="font-bold text-white text-sm mt-0.5">
                  {currentStage.nextStepName}
                </div>
                <p className="text-slate-300 text-xs mt-1 leading-relaxed">
                  {currentStage.nextStepReason}
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setActiveStep((prev) => (prev >= stages.length ? 1 : prev + 1));
                setIsPlaying(false);
              }}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-1 flex-shrink-0 transition-colors shadow"
            >
              <span>Inspect Next</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right Column: Live Data Packet Inspector (5 cols) */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/90 p-6 glass-panel shadow-2xl flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
                <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                  Live Telemetry Packet Inspector
                </h4>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                Seq #{telem.sequence_number}
              </span>
            </div>

            {/* Target Machine Summary Pill */}
            <div className="my-3 p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-mono">Current Machine:</span>
                <div className="font-bold text-white font-mono">
                  {currentAsset?.asset_id.toUpperCase()} ({currentAsset?.line})
                </div>
              </div>
              <div className="text-right">
                <span className="text-slate-400 text-[10px] uppercase font-mono">Connection:</span>
                <div className="font-bold text-emerald-400 flex items-center gap-1 justify-end font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  {currentAsset?.status || 'ONLINE'}
                </div>
              </div>
            </div>

            {/* 5 Raw Physical Dimensions Live Values */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 block">
                Extracted 5 Raw Sensor Features:
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block">Air Temp</span>
                  <span className="text-white font-bold">{Number(telem.air_temperature).toFixed(1)} K</span>
                  <span className="text-[10px] text-slate-400 ml-1">({(Number(telem.air_temperature) - 273.15).toFixed(1)}°C)</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block">Process Temp</span>
                  <span className="text-orange-400 font-bold">{Number(telem.process_temperature).toFixed(1)} K</span>
                  <span className="text-[10px] text-slate-400 ml-1">({(Number(telem.process_temperature) - 273.15).toFixed(1)}°C)</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block">Rotational Speed</span>
                  <span className="text-emerald-400 font-bold">{Math.round(Number(telem.rotational_speed))} rpm</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block">Torque Load</span>
                  <span className="text-amber-400 font-bold">{Number(telem.torque).toFixed(1)} Nm</span>
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 text-xs font-mono flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block">Accumulated Tool Wear</span>
                  <span className="text-purple-400 font-bold">{Math.round(Number(telem.tool_wear))} minutes</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                  Number(telem.tool_wear) >= 200
                    ? 'bg-rose-950 text-rose-300 border border-rose-800'
                    : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                }`}>
                  {Number(telem.tool_wear) >= 200 ? 'Limit Exceeded' : 'Safe Tool'}
                </span>
              </div>
            </div>

            {/* Live Model Prediction Output */}
            <div className="mt-4 p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  GRU Model Risk Score:
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  Threshold: <strong>0.55</strong>
                </span>
              </div>

              <div className="flex items-baseline justify-between">
                <span className={`text-2xl font-extrabold font-mono ${
                  pred.failure_probability >= 0.55 ? 'text-rose-400' : 'text-emerald-400'
                }`}>
                  {(pred.failure_probability * 100).toFixed(1)}%
                </span>
                <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded uppercase ${
                  pred.failure_probability >= 0.55
                    ? 'bg-rose-950/80 text-rose-300 border border-rose-800'
                    : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                }`}>
                  {pred.failure_probability >= 0.55 ? 'CRITICAL FAILURE RISK' : 'NORMAL NOMINAL'}
                </span>
              </div>

              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden relative border border-slate-700">
                <div
                  className={`h-full transition-all duration-300 ${
                    pred.failure_probability >= 0.55
                      ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, pred.failure_probability * 100)}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.9)]"
                  style={{ left: '55%' }}
                  title="Decision Threshold (0.55)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

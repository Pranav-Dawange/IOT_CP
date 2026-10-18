/**
 * SimulationDashboard.tsx
 *
 * Simulation Control Center — dedicated dashboard tab for the `simulation` branch.
 *
 * Features:
 *  - Fleet-wide simulation status grid (20 devices, lifecycle & connectivity state)
 *  - Scenario presets (Pre-Failure Ramp, Cascade Failure, Network Storm, Normal Ops)
 *  - One-click bulk fault injection across the entire fleet or per production line
 *  - Per-device individual fault injection controls
 *  - Live simulation telemetry stats (observations/sec, total published, dropout events)
 *  - Simulation legend explaining how the simulator works
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Cpu,
  Flame,
  Layers,
  Play,
  Radio,
  RefreshCw,
  Settings2,
  Sparkles,
  Timer,
  WifiOff,
  Wrench,
  Zap,
} from 'lucide-react';

import { apiClient } from '../api/client';
import { Asset } from '../types';
import { MachinePrototypeSimulator } from './MachinePrototypeSimulator';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SimDeviceStats {
  asset_id: string;
  line: string;
  status: string;
  torque?: number | null;
  tool_wear?: number | null;
  process_temp?: number | null;
  seq?: number | null;
  risk?: number | null;
  hasAnomaly?: boolean;
}

interface ScenarioPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  color: string;
  icon: React.ReactNode;
  faults: { type: string; label: string; lines: string[] }[];
}

// ─── Scenario Presets ─────────────────────────────────────────────────────────

const SCENARIOS: ScenarioPreset[] = [
  {
    id: 'normal',
    name: 'Normal Operations',
    badge: 'Baseline',
    description: 'All devices operating within nominal sensor ranges. No faults active. Good for establishing a healthy baseline prediction.',
    color: 'border-emerald-600/50 bg-emerald-950/20 hover:border-emerald-500',
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
    faults: [],
  },
  {
    id: 'pre_failure_ramp',
    name: 'Pre-Failure Ramp',
    badge: 'Tool Wear',
    description: 'Simulates gradual tool degradation across Line A. Torque and tool wear creep up — watch the GRU risk score rise toward the 0.55 threshold.',
    color: 'border-purple-600/50 bg-purple-950/20 hover:border-purple-500',
    icon: <Wrench className="w-4 h-4 text-purple-400" />,
    faults: [
      { type: 'TOOL_WEAR_SURGE', label: 'Tool Wear Surge', lines: ['lineA'] },
    ],
  },
  {
    id: 'thermal_crisis',
    name: 'Thermal Crisis',
    badge: 'Heat Runaway',
    description: 'Overheating scenario across Line B & C. Process temperature gradient drops below the safe 8.6 K threshold — triggering HDF-type failure risk.',
    color: 'border-rose-600/50 bg-rose-950/20 hover:border-rose-500',
    icon: <Flame className="w-4 h-4 text-rose-400" />,
    faults: [
      { type: 'THERMAL_OVERHEAT', label: 'Thermal Overheat', lines: ['lineB', 'lineC'] },
    ],
  },
  {
    id: 'cascade_failure',
    name: 'Cascade Failure',
    badge: 'Full Fleet',
    description: 'Simultaneous torque spikes across all 4 production lines — simulates a factory-wide overload event to stress-test the edge processor and GRU model under load.',
    color: 'border-amber-600/50 bg-amber-950/20 hover:border-amber-500',
    icon: <AlertOctagon className="w-4 h-4 text-amber-400" />,
    faults: [
      { type: 'TORQUE_SPIKE', label: 'Torque Spike', lines: ['lineA', 'lineB', 'lineC', 'lineD'] },
    ],
  },
  {
    id: 'network_storm',
    name: 'Network Storm',
    badge: 'Connectivity',
    description: 'Simulates radio dropout events across Line D — devices disconnect and reconnect, creating sequence gaps the edge processor must detect and alert on.',
    color: 'border-cyan-600/50 bg-cyan-950/20 hover:border-cyan-500',
    icon: <WifiOff className="w-4 h-4 text-cyan-400" />,
    faults: [
      { type: 'NETWORK_DROPOUT', label: 'Radio Dropout', lines: ['lineD'] },
    ],
  },
];

// ─── Line Badge ───────────────────────────────────────────────────────────────

const LINE_COLORS: Record<string, string> = {
  lineA: 'bg-blue-950 text-blue-300 border-blue-800/60',
  lineB: 'bg-violet-950 text-violet-300 border-violet-800/60',
  lineC: 'bg-amber-950 text-amber-300 border-amber-800/60',
  lineD: 'bg-teal-950 text-teal-300 border-teal-800/60',
};

const STATUS_DOT: Record<string, string> = {
  ONLINE: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]',
  DISCONNECTED: 'bg-amber-400',
  RECONNECTING: 'bg-blue-400 animate-pulse',
  EXHAUSTED: 'bg-slate-500',
  EMERGENCY_STOP: 'bg-rose-500',
  UNKNOWN: 'bg-slate-600',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRiskColor(risk?: number | null) {
  if (risk == null) return 'text-slate-500';
  if (risk >= 0.55) return 'text-rose-400';
  if (risk >= 0.35) return 'text-amber-400';
  return 'text-emerald-400';
}

function getRiskBg(risk?: number | null) {
  if (risk == null) return 'bg-slate-800';
  if (risk >= 0.55) return 'bg-rose-950/60 border-rose-800/60';
  if (risk >= 0.35) return 'bg-amber-950/60 border-amber-800/60';
  return 'bg-emerald-950/30 border-emerald-900/40';
}

// ─── Device Card ──────────────────────────────────────────────────────────────

const DeviceCard: React.FC<{
  device: SimDeviceStats;
  onInjectFault: (assetId: string, faultType: string) => void;
  injecting: string | null;
}> = ({ device, onInjectFault, injecting }) => {
  const [showFaults, setShowFaults] = useState(false);
  const isInjecting = injecting === device.asset_id;

  const faultOptions = [
    { type: 'TORQUE_SPIKE', label: 'Torque Spike', icon: <Zap className="w-3 h-3" /> },
    { type: 'THERMAL_OVERHEAT', label: 'Overheat', icon: <Flame className="w-3 h-3" /> },
    { type: 'TOOL_WEAR_SURGE', label: 'Wear Surge', icon: <Wrench className="w-3 h-3" /> },
    { type: 'NETWORK_DROPOUT', label: 'Dropout', icon: <Radio className="w-3 h-3" /> },
  ];

  return (
    <div
      className={`relative rounded-xl border p-3 space-y-2 transition-all duration-200 ${getRiskBg(device.risk)}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[device.status] || STATUS_DOT.UNKNOWN}`} />
          <span className="text-xs font-bold text-white font-mono">{device.asset_id}</span>
        </div>
        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${LINE_COLORS[device.line] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
          {device.line}
        </span>
      </div>

      {/* Sensor snapshot */}
      <div className="grid grid-cols-3 gap-1 text-center">
        <div className="bg-slate-900/60 rounded p-1">
          <div className="text-[9px] text-slate-400 uppercase font-mono">Torque</div>
          <div className={`text-[11px] font-bold font-mono ${(device.torque ?? 0) > 65 ? 'text-amber-400' : 'text-slate-200'}`}>
            {device.torque != null ? `${device.torque.toFixed(0)} Nm` : '—'}
          </div>
        </div>
        <div className="bg-slate-900/60 rounded p-1">
          <div className="text-[9px] text-slate-400 uppercase font-mono">Wear</div>
          <div className={`text-[11px] font-bold font-mono ${(device.tool_wear ?? 0) > 200 ? 'text-rose-400' : 'text-slate-200'}`}>
            {device.tool_wear != null ? `${device.tool_wear.toFixed(0)} m` : '—'}
          </div>
        </div>
        <div className="bg-slate-900/60 rounded p-1">
          <div className="text-[9px] text-slate-400 uppercase font-mono">Risk</div>
          <div className={`text-[11px] font-bold font-mono ${getRiskColor(device.risk)}`}>
            {device.risk != null ? `${(device.risk * 100).toFixed(0)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Anomaly badge */}
      {device.hasAnomaly && (
        <div className="flex items-center gap-1 text-[10px] text-amber-300 bg-amber-950/40 border border-amber-800/50 px-1.5 py-0.5 rounded">
          <AlertTriangle className="w-2.5 h-2.5" />
          <span>Anomaly detected</span>
        </div>
      )}

      {/* Fault Injection */}
      <div className="pt-1 border-t border-slate-800/60">
        <button
          onClick={() => setShowFaults((v) => !v)}
          disabled={isInjecting}
          className="w-full flex items-center justify-between text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
        >
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-400/70" />
            Inject Fault
          </span>
          <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${showFaults ? 'rotate-90' : ''}`} />
        </button>

        {showFaults && (
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {faultOptions.map((f) => (
              <button
                key={f.type}
                onClick={() => {
                  onInjectFault(device.asset_id, f.type);
                  setShowFaults(false);
                }}
                disabled={isInjecting}
                className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 border border-slate-700 transition-colors"
              >
                {f.icon}
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

interface SimulationDashboardProps {
  assets: Asset[];
  onNotification: (msg: string, type?: 'success' | 'warning' | 'info') => void;
}

export const SimulationDashboard: React.FC<SimulationDashboardProps> = ({
  assets,
  onNotification,
}) => {
  const [activeScenario, setActiveScenario] = useState<string>('normal');
  const [isRunningScenario, setIsRunningScenario] = useState(false);
  const [injectingDevice, setInjectingDevice] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<string>('all');
  const [simViewMode, setSimViewMode] = useState<'prototype' | 'fleet' | 'all'>('prototype');

  // Live counters
  const [totalEvents, setTotalEvents] = useState(0);
  const [alertCount, setAlertCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef(Date.now());

  // Tick the clock
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Track events from assets
  useEffect(() => {
    setTotalEvents(assets.filter((a) => a.status === 'ONLINE').length * 10);
    setAlertCount(assets.filter((a) => a.latest_prediction?.prediction === 1).length);
  }, [assets]);

  // Build device stats from live assets
  const deviceStats: SimDeviceStats[] = assets.map((a) => ({
    asset_id: a.asset_id,
    line: a.line,
    status: a.status,
    torque: a.latest_telemetry?.torque ?? null,
    tool_wear: a.latest_telemetry?.tool_wear ?? null,
    process_temp: a.latest_telemetry?.process_temperature ?? null,
    seq: a.latest_telemetry?.sequence_number ?? null,
    risk: a.latest_prediction?.failure_probability ?? null,
    hasAnomaly: (a.latest_telemetry?.edge?.anomaly_flags?.length ?? 0) > 0,
  }));

  const filteredDevices = selectedLine === 'all'
    ? deviceStats
    : deviceStats.filter((d) => d.line === selectedLine);

  // ── Scenario Runner ─────────────────────────────────────────────────────────

  const runScenario = async (scenario: ScenarioPreset) => {
    if (scenario.faults.length === 0) {
      setActiveScenario(scenario.id);
      onNotification(`✅ Scenario "${scenario.name}" set — normal operations, no faults active.`, 'success');
      return;
    }

    setIsRunningScenario(true);
    setActiveScenario(scenario.id);

    let successCount = 0;
    let failCount = 0;

    for (const fault of scenario.faults) {
      const targets = assets.filter((a) => fault.lines.includes(a.line));
      for (const asset of targets) {
        try {
          await apiClient.executeAssetAction(asset.asset_id, 'INJECT_FAULT', undefined, fault.type);
          successCount++;
        } catch {
          failCount++;
        }
        // small delay to avoid hammering the backend
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    setIsRunningScenario(false);
    if (successCount > 0) {
      onNotification(
        `🎬 Scenario "${scenario.name}" deployed — ${successCount} fault(s) injected across ${scenario.faults.map((f) => f.lines.join(', ')).join('; ')}.`,
        'success'
      );
    }
    if (failCount > 0) {
      onNotification(`⚠️ ${failCount} fault injection(s) failed — backend may not be ready.`, 'warning');
    }
  };

  // ── Per-Device Fault Injection ──────────────────────────────────────────────

  const injectSingleFault = async (assetId: string, faultType: string) => {
    setInjectingDevice(assetId);
    try {
      await apiClient.executeAssetAction(assetId, 'INJECT_FAULT', undefined, faultType);
      onNotification(`⚡ Injected ${faultType} into ${assetId}.`, 'success');
    } catch (err: any) {
      onNotification(`Failed to inject fault into ${assetId}: ${err.message}`, 'warning');
    } finally {
      setInjectingDevice(null);
    }
  };

  // ── Fleet Stats ─────────────────────────────────────────────────────────────

  const onlineCount = assets.filter((a) => a.status === 'ONLINE').length;
  const disconnectedCount = assets.filter((a) => ['DISCONNECTED', 'RECONNECTING'].includes(a.status)).length;
  const criticalCount = assets.filter((a) => (a.latest_prediction?.failure_probability ?? 0) >= 0.55).length;
  const elevatedCount = assets.filter(
    (a) =>
      (a.latest_prediction?.failure_probability ?? 0) >= 0.35 &&
      (a.latest_prediction?.failure_probability ?? 0) < 0.55
  ).length;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30">
            <Settings2 className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
              Simulation Control Center
              <span className="px-2 py-0.5 text-[10px] rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-normal">
                simulation branch
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Monitor all 20 synthetic assets · Deploy scenarios · Inject faults in real-time
            </p>
          </div>
        </div>

        {/* Clock & View Switcher */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setSimViewMode('prototype')}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
                simViewMode === 'prototype'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Machine Prototype
            </button>
            <button
              onClick={() => setSimViewMode('fleet')}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
                simViewMode === 'fleet'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Fleet Matrix
            </button>
            <button
              onClick={() => setSimViewMode('all')}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
                simViewMode === 'all'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Unified View
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg">
            <Timer className="w-3.5 h-3.5 text-blue-400" />
            <span>Session:</span>
            <span className="text-white font-bold">{formatTime(elapsedSeconds)}</span>
          </div>
        </div>
      </div>

      {/* ── Interactive Machine Digital Twin & Prototype Rig ── */}
      {(simViewMode === 'prototype' || simViewMode === 'all') && (
        <MachinePrototypeSimulator
          assets={assets}
          onInjectFault={injectSingleFault}
        />
      )}

      {/* ── Fleet Stats & Controls (Shown in Fleet or All mode) ── */}
      {(simViewMode === 'fleet' || simViewMode === 'all') && (
        <>
          {/* Fleet Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Online Devices',
            value: onlineCount,
            total: assets.length,
            color: 'text-emerald-400',
            bg: 'bg-emerald-950/30 border-emerald-900/50',
            icon: <CircleDot className="w-4 h-4 text-emerald-400" />,
          },
          {
            label: 'Disconnected',
            value: disconnectedCount,
            total: assets.length,
            color: 'text-amber-400',
            bg: 'bg-amber-950/30 border-amber-900/50',
            icon: <WifiOff className="w-4 h-4 text-amber-400" />,
          },
          {
            label: 'Critical Risk',
            value: criticalCount,
            total: assets.length,
            color: 'text-rose-400',
            bg: 'bg-rose-950/30 border-rose-900/50',
            icon: <AlertOctagon className="w-4 h-4 text-rose-400" />,
          },
          {
            label: 'Elevated Risk',
            value: elevatedCount,
            total: assets.length,
            color: 'text-amber-400',
            bg: 'bg-amber-950/20 border-amber-900/40',
            icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
          },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-xl border p-3 ${stat.bg}`}>
            <div className="flex items-center justify-between mb-1">
              {stat.icon}
              <span className="text-[10px] font-mono text-slate-400">{stat.total} total</span>
            </div>
            <div className={`text-2xl font-extrabold font-mono ${stat.color}`}>{stat.value}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{stat.label}</div>
            <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${stat.color.replace('text-', 'bg-')}`}
                style={{ width: `${stat.total > 0 ? (stat.value / stat.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* ── Scenario Presets ── */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
            Simulation Scenarios
          </h3>
          <span className="text-[11px] text-slate-400 ml-auto">
            Click a scenario to deploy it across the relevant production lines
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              onClick={() => runScenario(scenario)}
              disabled={isRunningScenario}
              className={`relative p-3 rounded-xl border text-left transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait ${scenario.color} ${
                activeScenario === scenario.id ? 'ring-2 ring-white/20 ring-offset-1 ring-offset-slate-900' : ''
              }`}
            >
              {activeScenario === scenario.id && (
                <div className="absolute top-2 right-2">
                  <Activity className="w-3 h-3 text-white/50 animate-pulse" />
                </div>
              )}
              <div className="flex items-center gap-1.5 mb-1.5">
                {scenario.icon}
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                  {scenario.badge}
                </span>
              </div>
              <div className="text-xs font-bold text-white leading-snug">{scenario.name}</div>
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed line-clamp-2">
                {scenario.description}
              </p>
            </button>
          ))}
        </div>

        {/* Active scenario summary */}
        {activeScenario !== 'normal' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-indigo-950/30 border border-indigo-800/40 text-xs text-indigo-300">
            <Play className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-white">Active: </span>
              {SCENARIOS.find((s) => s.id === activeScenario)?.description}
            </div>
          </div>
        )}
      </div>

      {/* ── Device Fleet Grid ── */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
              Device Fleet — 20 Assets
            </h3>
          </div>

          {/* Line filter */}
          <div className="flex items-center gap-1.5">
            {['all', 'lineA', 'lineB', 'lineC', 'lineD'].map((line) => (
              <button
                key={line}
                onClick={() => setSelectedLine(line)}
                className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors border ${
                  selectedLine === line
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {line === 'all' ? 'All' : line}
              </button>
            ))}
          </div>
        </div>

        {assets.length === 0 ? (
          <div className="text-center py-10 text-slate-500">
            <RefreshCw className="w-8 h-8 mx-auto mb-2 opacity-40 animate-spin" />
            <p className="text-sm">Waiting for simulator to connect and stream data...</p>
            <p className="text-xs mt-1 text-slate-600">
              Make sure the Docker stack is running: <code className="text-slate-400">docker compose up</code>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
            {filteredDevices.map((device) => (
              <DeviceCard
                key={device.asset_id}
                device={device}
                onInjectFault={injectSingleFault}
                injecting={injectingDevice}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── How the Simulator Works ── */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
          <Cpu className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
            How This Simulation Works
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              step: '01',
              color: 'border-blue-800/50 bg-blue-950/20',
              accent: 'text-blue-400',
              title: 'Data Source',
              body: 'The AI4I 2020 dataset (10,000 real sensor rows) is split into 20 contiguous 500-row slices. Each virtual device replays its assigned slice.',
            },
            {
              step: '02',
              color: 'border-violet-800/50 bg-violet-950/20',
              accent: 'text-violet-400',
              title: 'Sensor Noise',
              body: 'Gaussian noise (σ=0.05 K for temp, σ=2 rpm for speed) is added each tick to simulate real sensor imprecision. Rotational speed & torque stay non-negative.',
            },
            {
              step: '03',
              color: 'border-amber-800/50 bg-amber-950/20',
              accent: 'text-amber-400',
              title: 'Fault Injection',
              body: '1% dropout probability per tick (3-tick silence window) + 0.5% malformed packet rate. You can also inject faults manually from the scenario presets above.',
            },
            {
              step: '04',
              color: 'border-emerald-800/50 bg-emerald-950/20',
              accent: 'text-emerald-400',
              title: 'MQTT → Edge → GRU',
              body: 'Each tick publishes to Mosquitto via factory/{line}/{id}/telemetry. Edge smooths and validates → backend feeds a 30-obs window into the frozen GRU model.',
            },
          ].map((item) => (
            <div key={item.step} className={`rounded-xl border p-3 ${item.color}`}>
              <div className={`text-xs font-black font-mono ${item.accent} mb-1`}>Step {item.step}</div>
              <div className="text-xs font-bold text-white mb-1">{item.title}</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>

        {/* Quick stats row */}
        <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-800 text-[11px] text-slate-400 font-mono">
          <span className="flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
            Dataset: <strong className="text-white">10,000 rows</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-violet-400" />
            Devices: <strong className="text-white">20 × 500 rows each</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5 text-amber-400" />
            Tick rate: <strong className="text-white">500 ms (--loop)</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            GRU window: <strong className="text-white">30 obs → 10 horizon</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
            Threshold: <strong className="text-white">τ = 0.55</strong>
          </span>
        </div>
      </div>
        </>
      )}
    </div>
  );
};

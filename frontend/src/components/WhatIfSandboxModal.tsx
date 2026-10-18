import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Flame,
  Gauge,
  Info,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Thermometer,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

import { apiClient } from '../api/client';
import { Asset, WhatIfSimulationParams, WhatIfSimulationResult } from '../types';

interface WhatIfSandboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAsset: Asset | null;
}

const PRESETS: {
  name: string;
  badge: string;
  color: string;
  params: WhatIfSimulationParams;
}[] = [
  {
    name: 'Nominal Baseline',
    badge: 'Safe',
    color: 'border-emerald-600/50 bg-emerald-950/20 text-emerald-300 hover:border-emerald-500',
    params: {
      air_temperature: 300.0,
      process_temperature: 310.0,
      rotational_speed: 1538.0,
      torque: 39.8,
      tool_wear: 15.0,
    },
  },
  {
    name: 'Severe Torque Overload',
    badge: 'Strain Failure',
    color: 'border-amber-600/50 bg-amber-950/20 text-amber-300 hover:border-amber-500',
    params: {
      air_temperature: 300.8,
      process_temperature: 310.8,
      rotational_speed: 1210.0,
      torque: 76.5,
      tool_wear: 85.0,
    },
  },
  {
    name: 'Thermal Dissipation (HDF)',
    badge: 'Heat Runaway',
    color: 'border-rose-600/50 bg-rose-950/20 text-rose-300 hover:border-rose-500',
    params: {
      air_temperature: 304.5,
      process_temperature: 312.2,
      rotational_speed: 1350.0,
      torque: 52.0,
      tool_wear: 110.0,
    },
  },
  {
    name: 'Critical Tool Wear (TWF)',
    badge: 'Worn Cutter',
    color: 'border-purple-600/50 bg-purple-950/20 text-purple-300 hover:border-purple-500',
    params: {
      air_temperature: 301.2,
      process_temperature: 311.5,
      rotational_speed: 1420.0,
      torque: 63.0,
      tool_wear: 235.0,
    },
  },
  {
    name: 'High Speed Power Surge',
    badge: 'Electrical',
    color: 'border-cyan-600/50 bg-cyan-950/20 text-cyan-300 hover:border-cyan-500',
    params: {
      air_temperature: 302.0,
      process_temperature: 312.8,
      rotational_speed: 2820.0,
      torque: 35.0,
      tool_wear: 45.0,
    },
  },
];

export const WhatIfSandboxModal: React.FC<WhatIfSandboxModalProps> = ({
  isOpen,
  onClose,
  selectedAsset,
}) => {
  const [params, setParams] = useState<WhatIfSimulationParams>({
    air_temperature: 300.0,
    process_temperature: 310.0,
    rotational_speed: 1538.0,
    torque: 40.0,
    tool_wear: 0.0,
    simulation_mode: 'steady_state',
  });

  const [simulationResult, setSimulationResult] = useState<WhatIfSimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Sync with selected asset latest telemetry when modal opens
  useEffect(() => {
    if (isOpen && selectedAsset?.latest_telemetry) {
      const telem = selectedAsset.latest_telemetry;
      setParams({
        air_temperature: telem.air_temperature,
        process_temperature: telem.process_temperature,
        rotational_speed: telem.rotational_speed,
        torque: telem.torque,
        tool_wear: telem.tool_wear,
        asset_id: selectedAsset.asset_id,
        simulation_mode: 'steady_state',
      });
    }
  }, [isOpen, selectedAsset]);

  // Run simulation whenever params change
  useEffect(() => {
    if (!isOpen) return;

    let isSubscribed = true;
    const runInference = async () => {
      setIsSimulating(true);
      setError(null);
      try {
        const result = await apiClient.simulatePrediction({
          ...params,
          asset_id: selectedAsset?.asset_id,
        });
        if (isSubscribed) {
          setSimulationResult(result);
        }
      } catch (err: any) {
        if (isSubscribed) {
          setError(err.message || 'Simulation error');
        }
      } finally {
        if (isSubscribed) {
          setIsSimulating(false);
        }
      }
    };

    const timeout = setTimeout(runInference, 150);
    return () => {
      isSubscribed = false;
      clearTimeout(timeout);
    };
  }, [params, isOpen, selectedAsset]);

  if (!isOpen) return null;

  const handleSliderChange = (key: keyof WhatIfSimulationParams, val: number) => {
    setParams((prev) => ({ ...prev, [key]: val }));
  };

  const applyPreset = (presetParams: WhatIfSimulationParams) => {
    setParams((prev) => ({
      ...prev,
      ...presetParams,
    }));
  };

  const riskProb = simulationResult ? simulationResult.failure_probability : 0;
  const isHighRisk = simulationResult ? simulationResult.is_alert : false;
  const riskPercent = (riskProb * 100).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="glass-panel w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] border border-white/10">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-wide">
                  Interactive "What-If" AI Digital Twin
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                  Frozen GRU Model
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Adjust sensor parameters to evaluate failure probability in real-time under the frozen inference contract.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-200">
          {/* Quick Scenario Presets */}
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2 font-mono flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Quick Stress-Test Presets:
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p.params)}
                  className={`p-2.5 rounded-lg border text-left transition-all ${p.color}`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                    {p.badge}
                  </div>
                  <div className="text-xs font-semibold mt-0.5 leading-snug">{p.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Main Controls & Live Inference Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: 5 Interactive Sliders (7 cols) */}
            <div className="lg:col-span-7 space-y-4 bg-slate-950/50 p-4 rounded-lg border border-slate-800">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                <span className="text-xs font-bold text-slate-300 font-mono uppercase tracking-wide">
                  Raw Sensor Feature Inputs
                </span>
                <span className="text-[11px] text-slate-400">
                  Target Machine: <strong className="text-cyan-400">{selectedAsset ? selectedAsset.asset_id.replace(/asset_?/i, 'Machine ') : 'All Machines'}</strong>
                </span>
              </div>

              {/* 1. Air Temperature Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <Thermometer className="w-3.5 h-3.5 text-sky-400" />
                    Air Temperature [K]
                  </span>
                  <span className="font-mono font-bold text-sky-400">
                    {params.air_temperature.toFixed(1)} K{' '}
                    <span className="text-[10px] text-slate-400">
                      ({(params.air_temperature - 273.15).toFixed(1)} °C)
                    </span>
                  </span>
                </div>
                <input
                  type="range"
                  min="290.0"
                  max="315.0"
                  step="0.1"
                  value={params.air_temperature}
                  onChange={(e) => handleSliderChange('air_temperature', parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>290 K</span>
                  <span>Nominal ~300 K</span>
                  <span>315 K</span>
                </div>
              </div>

              {/* 2. Process Temperature Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <Flame className="w-3.5 h-3.5 text-orange-400" />
                    Process Temperature [K]
                  </span>
                  <span className="font-mono font-bold text-orange-400">
                    {params.process_temperature.toFixed(1)} K{' '}
                    <span className="text-[10px] text-slate-400">
                      ({(params.process_temperature - 273.15).toFixed(1)} °C)
                    </span>
                  </span>
                </div>
                <input
                  type="range"
                  min="300.0"
                  max="325.0"
                  step="0.1"
                  value={params.process_temperature}
                  onChange={(e) => handleSliderChange('process_temperature', parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>300 K</span>
                  <span>Nominal ~310 K</span>
                  <span>325 K</span>
                </div>
              </div>

              {/* 3. Rotational Speed Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                    Rotational Speed [rpm]
                  </span>
                  <span className="font-mono font-bold text-emerald-400">
                    {Math.round(params.rotational_speed)} rpm
                  </span>
                </div>
                <input
                  type="range"
                  min="1000"
                  max="2900"
                  step="10"
                  value={params.rotational_speed}
                  onChange={(e) => handleSliderChange('rotational_speed', parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>1000 rpm</span>
                  <span>Nominal ~1538 rpm</span>
                  <span>2900 rpm</span>
                </div>
              </div>

              {/* 4. Torque Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    Torque [Nm]
                  </span>
                  <span className="font-mono font-bold text-amber-400">
                    {params.torque.toFixed(1)} Nm
                  </span>
                </div>
                <input
                  type="range"
                  min="5.0"
                  max="85.0"
                  step="0.5"
                  value={params.torque}
                  onChange={(e) => handleSliderChange('torque', parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>5 Nm</span>
                  <span>Nominal ~40 Nm</span>
                  <span>85 Nm (Overload)</span>
                </div>
              </div>

              {/* 5. Tool Wear Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <Wrench className="w-3.5 h-3.5 text-purple-400" />
                    Tool Wear [min]
                  </span>
                  <span className="font-mono font-bold text-purple-400">
                    {Math.round(params.tool_wear)} min
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="250"
                  step="1"
                  value={params.tool_wear}
                  onChange={(e) => handleSliderChange('tool_wear', parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>0 min (Fresh Tool)</span>
                  <span>Warning: 200 min</span>
                  <span>250 min (Critical)</span>
                </div>
              </div>
            </div>

            {/* Right Column: Live Model Inference Result (5 cols) */}
            <div className="lg:col-span-5 flex flex-col justify-between space-y-4 bg-slate-950/70 p-4 rounded-lg border border-slate-800">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <span className="text-xs font-bold text-slate-300 font-mono uppercase tracking-wide flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-blue-400" />
                    GRU Risk Assessment
                  </span>
                  {isSimulating && (
                    <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                  )}
                </div>

                {/* Big Risk Gauge Meter */}
                <div className="mt-4 text-center p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-inner">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                    Predicted Failure Risk (10 Timesteps Horizon)
                  </div>
                  <div
                    className={`text-4xl font-extrabold font-mono mt-1 ${
                      isHighRisk
                        ? 'text-rose-400 animate-pulse'
                        : riskProb >= 0.35
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {riskPercent}%
                  </div>

                  {/* Visual Probability Bar with 0.55 Threshold Marker */}
                  <div className="relative mt-3 h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                    {/* Fill */}
                    <div
                      className={`h-full transition-all duration-300 ${
                        isHighRisk
                          ? 'bg-gradient-to-r from-amber-500 to-rose-600'
                          : riskProb >= 0.35
                          ? 'bg-gradient-to-r from-emerald-500 to-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(2, riskProb * 100))}%` }}
                    />
                    {/* Threshold marker line at 55% */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-rose-400 z-10 shadow-[0_0_8px_rgba(244,63,94,0.8)]"
                      style={{ left: '55%' }}
                      title="Decision Threshold (0.55)"
                    />
                  </div>

                  {/* Threshold Labels */}
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1">
                    <span>0.0</span>
                    <span className="text-rose-400 font-bold">Threshold: 0.55</span>
                    <span>1.0</span>
                  </div>

                  {/* Status Badge */}
                  <div className="mt-3">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${
                        isHighRisk
                          ? 'bg-rose-950/80 border-rose-500 text-rose-300'
                          : riskProb >= 0.35
                          ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                          : 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                      }`}
                    >
                      {isHighRisk ? (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                          CRITICAL RISK (Prediction = 1)
                        </>
                      ) : riskProb >= 0.35 ? (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                          ELEVATED RISK (Warning)
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          NORMAL OPERATION (Prediction = 0)
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Physics Derived Cards */}
                {simulationResult && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="p-2.5 rounded bg-slate-900 border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-mono">
                        Shaft Power Draw
                      </span>
                      <span className="text-sm font-bold font-mono text-cyan-400">
                        {simulationResult.power_watts.toLocaleString()} W
                      </span>
                      <span className="block text-[9px] text-slate-400 mt-0.5">
                        {simulationResult.power_watts > 9000
                          ? '⚠️ Overpower Limit'
                          : 'Normal Range'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded bg-slate-900 border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-mono">
                        Thermal Gradient (ΔT)
                      </span>
                      <span className="text-sm font-bold font-mono text-amber-400">
                        {simulationResult.temp_diff_k.toFixed(1)} K
                      </span>
                      <span className="block text-[9px] text-slate-400 mt-0.5">
                        {simulationResult.temp_diff_k < 8.6
                          ? '⚠️ Low Gradient (HDF)'
                          : 'Adequate Cooling'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Diagnostic Insights Feed */}
                {simulationResult?.insights && simulationResult.insights.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono block">
                      AI Diagnostic Drivers:
                    </span>
                    <ul className="space-y-1">
                      {simulationResult.insights.map((insight, idx) => (
                        <li
                          key={idx}
                          className="text-[11px] text-slate-300 flex items-start gap-1.5 bg-slate-900/60 p-1.5 rounded border border-slate-800/80"
                        >
                          <ArrowRight className="w-3 h-3 text-blue-400 flex-shrink-0 mt-0.5" />
                          <span>{insight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Reset to Baseline Button */}
              <button
                onClick={() => applyPreset(PRESETS[0].params)}
                className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-slate-700"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reset Parameters to Nominal Baseline
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/90 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-400" />
            <span>
              Calls live backend endpoint <code>/predictions/simulate</code> with frozen model checkpoint.
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Gauge,
  Layers,
  Thermometer,
  Wrench,
  Zap,
} from 'lucide-react';
import { Asset } from '../types';

interface AssetCardProps {
  asset: Asset;
  isSelected: boolean;
  onSelect: (assetId: string) => void;
}

export const AssetCard: React.FC<AssetCardProps> = ({ asset, isSelected, onSelect }) => {
  const isOnline = asset.status === 'ONLINE';
  const isExhausted = asset.status === 'EXHAUSTED';
  const isDisconnected = asset.status === 'DISCONNECTED';
  const isReconnecting = asset.status === 'RECONNECTING';

  const pred = asset.latest_prediction;
  const failureProb = pred ? pred.failure_probability : null;
  const isElevatedRisk = failureProb !== null && failureProb >= 0.55;

  const buffer = asset.buffer_status;
  const accumulated = buffer ? buffer.accumulated_observations : 0;
  const required = buffer ? buffer.required_window_size : 30;
  const isBufferReady = buffer ? buffer.is_ready : false;

  const latestTelemetry = asset.latest_telemetry;

  // Status badge styling
  const statusBadge = () => {
    if (isOnline) {
      return (
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          ONLINE
        </span>
      );
    }
    if (isExhausted) {
      return (
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-950/60 text-purple-300 border border-purple-800">
          EXHAUSTED (500/500)
        </span>
      );
    }
    if (isReconnecting) {
      return (
        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950/60 text-amber-400 border border-amber-800">
          RECONNECTING
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
        DISCONNECTED
      </span>
    );
  };

  return (
    <div
      onClick={() => onSelect(asset.asset_id)}
      className={`group relative rounded-xl p-4 transition-all duration-200 cursor-pointer text-left border ${
        isSelected
          ? 'bg-slate-900 border-blue-500 shadow-lg shadow-blue-950/40 ring-1 ring-blue-500'
          : isElevatedRisk
          ? 'bg-slate-900/90 border-rose-800/80 hover:border-rose-600 shadow-rose-950/20'
          : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
      }`}
    >
      {/* Header: ID, Line, Status */}
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors font-mono">
              {asset.asset_id}
            </h3>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              {asset.asset_type}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
            <span className="font-semibold text-slate-300">{asset.line}</span>
            <span>•</span>
            <span className="truncate max-w-[140px]" title={asset.location}>
              {asset.location.split('-').slice(-2).join('-')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">{statusBadge()}</div>
      </div>

      {/* Sensor Readings Grid */}
      <div className="grid grid-cols-3 gap-1.5 my-3 text-[11px]">
        {/* Air Temp */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded p-1.5">
          <span className="text-slate-400 block text-[10px] flex items-center gap-1">
            <Thermometer className="w-2.5 h-2.5 text-blue-400" /> Air Temp
          </span>
          <span className="font-mono font-medium text-slate-200">
            {latestTelemetry ? `${latestTelemetry.air_temperature.toFixed(1)} K` : '—'}
          </span>
        </div>

        {/* Process Temp */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded p-1.5">
          <span className="text-slate-400 block text-[10px] flex items-center gap-1">
            <Thermometer className="w-2.5 h-2.5 text-orange-400" /> Proc Temp
          </span>
          <span className="font-mono font-medium text-slate-200">
            {latestTelemetry ? `${latestTelemetry.process_temperature.toFixed(1)} K` : '—'}
          </span>
        </div>

        {/* Rotational Speed */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded p-1.5">
          <span className="text-slate-400 block text-[10px] flex items-center gap-1">
            <Zap className="w-2.5 h-2.5 text-yellow-400" /> Speed
          </span>
          <span className="font-mono font-medium text-slate-200">
            {latestTelemetry ? `${Math.round(latestTelemetry.rotational_speed)} rpm` : '—'}
          </span>
        </div>

        {/* Torque */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded p-1.5">
          <span className="text-slate-400 block text-[10px] flex items-center gap-1">
            <Gauge className="w-2.5 h-2.5 text-cyan-400" /> Torque
          </span>
          <span className="font-mono font-medium text-slate-200">
            {latestTelemetry ? `${latestTelemetry.torque.toFixed(1)} Nm` : '—'}
          </span>
        </div>

        {/* Tool Wear */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded p-1.5">
          <span className="text-slate-400 block text-[10px] flex items-center gap-1">
            <Wrench className="w-2.5 h-2.5 text-purple-400" /> Tool Wear
          </span>
          <span className="font-mono font-medium text-slate-200">
            {latestTelemetry ? `${Math.round(latestTelemetry.tool_wear)} min` : '—'}
          </span>
        </div>

        {/* Sequence Progress */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded p-1.5">
          <span className="text-slate-400 block text-[10px] flex items-center gap-1">
            <Clock className="w-2.5 h-2.5 text-slate-400" /> Seq #
          </span>
          <span className="font-mono font-medium text-slate-300">
            {latestTelemetry ? `#${latestTelemetry.sequence_number}` : '—'}
          </span>
        </div>
      </div>

      {/* Prediction & Risk Engine Section */}
      <div
        className={`rounded-lg p-2.5 border transition-colors ${
          isElevatedRisk
            ? 'bg-rose-950/30 border-rose-800/80 text-rose-200'
            : failureProb !== null
            ? 'bg-slate-950/80 border-slate-800 text-slate-300'
            : 'bg-slate-950/40 border-slate-800/50 text-slate-400'
        }`}
      >
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="font-semibold text-[11px] flex items-center gap-1">
            {isElevatedRisk ? (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 animate-bounce" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            )}
            Estimated Failure Risk
          </span>

          {failureProb !== null ? (
            <span
              className={`font-mono font-bold text-xs px-1.5 py-0.5 rounded ${
                isElevatedRisk
                  ? 'bg-rose-900/80 text-rose-300 border border-rose-700'
                  : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
              }`}
            >
              {(failureProb * 100).toFixed(1)}%
            </span>
          ) : (
            <span className="text-[10px] text-slate-400 italic">
              {accumulated < required ? `Buffering ${accumulated}/${required}` : 'No prediction'}
            </span>
          )}
        </div>

        {/* Probability bar relative to 0.55 threshold */}
        <div className="relative w-full h-2 bg-slate-800 rounded-full overflow-hidden">
          {/* Threshold marker tick at 55% */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10"
            style={{ left: '55%' }}
            title="Decision Threshold: 0.55"
          ></div>
          {failureProb !== null && (
            <div
              className={`h-full transition-all duration-300 ${
                isElevatedRisk ? 'bg-gradient-to-r from-amber-500 to-rose-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, failureProb * 100))}%` }}
            ></div>
          )}
        </div>

        <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
          <span>0.0</span>
          <span className="text-red-400 font-mono font-semibold">Threshold: 0.55</span>
          <span>1.0</span>
        </div>
      </div>

      {/* Select indicator */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2.5 pt-2 border-t border-slate-800/60">
        <span className="flex items-center gap-1 font-mono text-[10px]">
          <Layers className="w-3 h-3 text-cyan-400" />
          {isBufferReady ? (
            <span className="text-emerald-400 font-medium">GRU Buffer Ready (30)</span>
          ) : (
            <span className="text-slate-400">{accumulated}/30 Observations</span>
          )}
        </span>

        <span className="text-blue-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5 text-xs font-medium">
          {isSelected ? 'Viewing Details' : 'View Charts'}
          <ArrowRight className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
};

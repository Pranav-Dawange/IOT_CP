import React from 'react';
import { AlertCircle, Cpu, ShieldAlert, ShieldCheck, Zap } from 'lucide-react';
import { Asset, EdgeAlert } from '../types';

interface StatsOverviewProps {
  assets: Asset[];
  alerts: EdgeAlert[];
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ assets, alerts }) => {
  const totalAssets = assets.length;
  const onlineAssets = assets.filter((a) => a.status === 'ONLINE').length;
  const elevatedRiskAssets = assets.filter(
    (a) => a.latest_prediction && a.latest_prediction.failure_probability >= 0.55
  ).length;

  const sequenceGapAlerts = alerts.filter(
    (a) => a.alert_type === 'DATA_GAP_DETECTED' || a.alert_type === 'SEQUENCE_GAP'
  ).length;

  const criticalOrWarningAlerts = alerts.filter(
    (a) => a.severity === 'CRITICAL' || a.severity === 'WARNING'
  ).length;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {/* 1. Total Assets */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400">Total Monitored Assets</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold text-white">{totalAssets}</span>
            <span className="text-xs text-slate-400">across 4 lines</span>
          </div>
        </div>
        <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
          <Cpu className="w-5 h-5" />
        </div>
      </div>

      {/* 2. Online Assets */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400">Active / Online Assets</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold text-emerald-400">{onlineAssets}</span>
            <span className="text-xs text-slate-400">
              / {totalAssets} ({totalAssets > 0 ? Math.round((onlineAssets / totalAssets) * 100) : 0}%)
            </span>
          </div>
        </div>
        <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <Zap className="w-5 h-5" />
        </div>
      </div>

      {/* 3. Elevated Risk Assets (Prob >= 0.55) */}
      <div
        className={`bg-slate-900/90 border rounded-lg p-3.5 flex items-center justify-between transition-colors ${
          elevatedRiskAssets > 0 ? 'border-rose-800/80 bg-rose-950/20' : 'border-slate-800'
        }`}
      >
        <div>
          <p className="text-xs font-medium text-slate-400">Elevated Failure Risk</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span
              className={`text-2xl font-bold ${
                elevatedRiskAssets > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-300'
              }`}
            >
              {elevatedRiskAssets}
            </span>
            <span className="text-xs text-rose-300/80 font-mono">prob ≥ 0.55</span>
          </div>
        </div>
        <div
          className={`p-2.5 rounded-lg border ${
            elevatedRiskAssets > 0
              ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
              : 'bg-slate-800 border-slate-700 text-slate-400'
          }`}
        >
          {elevatedRiskAssets > 0 ? <ShieldAlert className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
        </div>
      </div>

      {/* 4. Sequence Continuity / Gaps */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400">Sequence Integrity</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span
              className={`text-2xl font-bold ${
                sequenceGapAlerts > 0 ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {sequenceGapAlerts === 0 ? 'Continuous' : `${sequenceGapAlerts} Gaps`}
            </span>
          </div>
        </div>
        <div
          className={`p-2.5 rounded-lg border ${
            sequenceGapAlerts > 0
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
          }`}
        >
          <AlertCircle className="w-5 h-5" />
        </div>
      </div>

      {/* 5. Active Diagnostic Alerts */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 flex items-center justify-between col-span-2 lg:col-span-1">
        <div>
          <p className="text-xs font-medium text-slate-400">Diagnostic Alerts</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span
              className={`text-2xl font-bold ${
                criticalOrWarningAlerts > 0 ? 'text-amber-400' : 'text-slate-300'
              }`}
            >
              {alerts.length}
            </span>
            <span className="text-xs text-slate-400">recent</span>
          </div>
        </div>
        <div className="p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400">
          <AlertCircle className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};

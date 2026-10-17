import React, { useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  BellOff,
  CheckCircle2,
  Cpu,
  Flame,
  Play,
  Radio,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  StopCircle,
  Wrench,
  Zap,
} from 'lucide-react';

import { apiClient } from '../api/client';
import { Asset } from '../types';

interface OperatorControlPanelProps {
  asset: Asset;
  onOpenWhatIf: () => void;
  onRefreshData?: () => void;
  onNotification?: (msg: string, type?: 'success' | 'warning' | 'info') => void;
}

export const OperatorControlPanel: React.FC<OperatorControlPanelProps> = ({
  asset,
  onOpenWhatIf,
  onRefreshData,
  onNotification,
}) => {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showWorkOrderModal, setShowWorkOrderModal] = useState<boolean>(false);
  const [workOrderNotes, setWorkOrderNotes] = useState<string>('');
  const [showChaosDropdown, setShowChaosDropdown] = useState<boolean>(false);

  const handleAction = async (action: string, notes?: string, faultType?: string) => {
    setActionLoading(action);
    try {
      const res = await apiClient.executeAssetAction(asset.asset_id, action, notes, faultType);
      const msg = res.message || `Action ${action} executed successfully.`;
      if (onNotification) onNotification(msg, 'success');
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      if (onNotification) onNotification(err.message || 'Action failed', 'warning');
    } finally {
      setActionLoading(null);
      setShowWorkOrderModal(false);
      setShowChaosDropdown(false);
    }
  };

  const isEmergencyStopped = asset.status === 'EMERGENCY_STOP';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-3">
      {/* Top Bar: Title & Status */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/30">
            <Wrench className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
              Operator Control Center: {asset.asset_id}
            </h3>
            <span className="text-[11px] text-slate-400">
              Interactive maintenance actions, ML simulation, and chaos injection
            </span>
          </div>
        </div>

        {/* Quick Launch What-If Sandbox Button */}
        <button
          onClick={onOpenWhatIf}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-200" />
          <span>What-If AI Sandbox</span>
          <Sparkles className="w-3 h-3 text-amber-300" />
        </button>
      </div>

      {/* Main Action Buttons Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {/* 1. Dispatch Maintenance Work Order */}
        <button
          onClick={() => setShowWorkOrderModal(true)}
          disabled={actionLoading !== null}
          className="p-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-left transition-all group hover:border-blue-500/50"
        >
          <div className="flex items-center justify-between text-blue-400 mb-1">
            <Wrench className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-blue-950 border border-blue-800/60 text-blue-300">
              Work Order
            </span>
          </div>
          <div className="text-xs font-bold text-white">Dispatch Crew</div>
          <div className="text-[10px] text-slate-400">Issue preventive service order</div>
        </button>

        {/* 2. Acknowledge Alerts */}
        <button
          onClick={() => handleAction('ACKNOWLEDGE_ALERTS')}
          disabled={actionLoading !== null}
          className="p-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-left transition-all group hover:border-emerald-500/50"
        >
          <div className="flex items-center justify-between text-emerald-400 mb-1">
            <BellOff className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-800/60 text-emerald-300">
              Clear
            </span>
          </div>
          <div className="text-xs font-bold text-white">Acknowledge Alerts</div>
          <div className="text-[10px] text-slate-400">Silence active machine warnings</div>
        </button>

        {/* 3. Replace Tool & Reset Buffer */}
        <button
          onClick={() => handleAction('REPLACE_TOOL')}
          disabled={actionLoading !== null}
          className="p-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-left transition-all group hover:border-purple-500/50"
        >
          <div className="flex items-center justify-between text-purple-400 mb-1">
            <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-950 border border-purple-800/60 text-purple-300">
              Reset
            </span>
          </div>
          <div className="text-xs font-bold text-white">Replace Tool</div>
          <div className="text-[10px] text-slate-400">Reset cutter wear & GRU buffer</div>
        </button>

        {/* 4. Emergency Stop / Resume */}
        <button
          onClick={() => handleAction(isEmergencyStopped ? 'RESUME_OPERATION' : 'EMERGENCY_STOP')}
          disabled={actionLoading !== null}
          className={`p-2.5 rounded-lg border text-left transition-all group ${
            isEmergencyStopped
              ? 'bg-emerald-950/40 border-emerald-600 text-emerald-200 hover:bg-emerald-900/50'
              : 'bg-rose-950/30 border-rose-800/60 text-rose-200 hover:border-rose-600'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            {isEmergencyStopped ? (
              <Play className="w-4 h-4 text-emerald-400" />
            ) : (
              <StopCircle className="w-4 h-4 text-rose-400" />
            )}
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-black/40 border border-current">
              {isEmergencyStopped ? 'RESUME' : 'E-STOP'}
            </span>
          </div>
          <div className="text-xs font-bold text-white">
            {isEmergencyStopped ? 'Resume Machine' : 'Emergency Stop'}
          </div>
          <div className="text-[10px] text-slate-400">
            {isEmergencyStopped ? 'Restore normal production' : 'Halt asset immediately'}
          </div>
        </button>
      </div>

      {/* Chaos & Fault Injection Stress-Testing Section */}
      <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span className="font-semibold text-slate-300">Live Chaos & Fault Injection:</span>
          <span className="hidden sm:inline text-slate-400 text-[11px]">
            Inject deliberate sensor anomalies to watch the edge and GRU react live
          </span>
        </div>

        {/* Chaos Injection Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => handleAction('INJECT_FAULT', undefined, 'TORQUE_SPIKE')}
            disabled={actionLoading !== null}
            className="px-2.5 py-1 rounded bg-amber-950/40 hover:bg-amber-900/50 border border-amber-800/60 text-amber-300 text-[11px] font-medium transition-colors flex items-center gap-1"
            title="Inject Torque spike of 78.5 Nm"
          >
            <Zap className="w-3 h-3 text-amber-400" />
            <span>Torque Spike (78 Nm)</span>
          </button>

          <button
            onClick={() => handleAction('INJECT_FAULT', undefined, 'THERMAL_OVERHEAT')}
            disabled={actionLoading !== null}
            className="px-2.5 py-1 rounded bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/60 text-rose-300 text-[11px] font-medium transition-colors flex items-center gap-1"
            title="Inject 315.6 K Process Overheat"
          >
            <Flame className="w-3 h-3 text-rose-400" />
            <span>Thermal Overheat</span>
          </button>

          <button
            onClick={() => handleAction('INJECT_FAULT', undefined, 'TOOL_WEAR_SURGE')}
            disabled={actionLoading !== null}
            className="px-2.5 py-1 rounded bg-purple-950/40 hover:bg-purple-900/50 border border-purple-800/60 text-purple-300 text-[11px] font-medium transition-colors flex items-center gap-1"
            title="Inject 235 min Tool Wear"
          >
            <Wrench className="w-3 h-3 text-purple-400" />
            <span>Wear Surge (235m)</span>
          </button>

          <button
            onClick={() => handleAction('INJECT_FAULT', undefined, 'NETWORK_DROPOUT')}
            disabled={actionLoading !== null}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-medium transition-colors flex items-center gap-1"
            title="Simulate network dropout"
          >
            <Radio className="w-3 h-3 text-slate-400" />
            <span>Radio Dropout</span>
          </button>

          <button
            onClick={() => handleAction('INJECT_FAULT', undefined, 'SEQUENCE_GAP')}
            disabled={actionLoading !== null}
            className="px-2.5 py-1 rounded bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-800/60 text-cyan-300 text-[11px] font-medium transition-colors flex items-center gap-1"
            title="Skip sequence numbers to test buffer reset"
          >
            <span>Gap (+10 Seq)</span>
          </button>
        </div>
      </div>

      {/* Dispatch Work Order Quick Modal */}
      {showWorkOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-blue-400" />
                <h4 className="text-sm font-bold text-white">
                  Dispatch Maintenance Work Order
                </h4>
              </div>
              <span className="text-xs font-mono text-blue-400 font-bold">{asset.asset_id}</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Target Production Line:</label>
                <div className="font-mono text-white bg-slate-950 p-2 rounded border border-slate-800">
                  {asset.line} — Location: {asset.location} ({asset.asset_type})
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Quick Select Issue Description:</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    'High GRU Failure Risk (>0.55)',
                    'Excessive Tool Wear Inspection',
                    'Torque Overload & Bearing Check',
                    'Cooling Gradient Thermal Service',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setWorkOrderNotes(preset)}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] text-left border border-slate-700"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Maintenance Instructions / Notes:</label>
                <textarea
                  rows={3}
                  value={workOrderNotes}
                  onChange={(e) => setWorkOrderNotes(e.target.value)}
                  placeholder="Enter details for the dispatched reliability technician..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowWorkOrderModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleAction('DISPATCH_MAINTENANCE', workOrderNotes)}
                disabled={actionLoading !== null}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors"
              >
                Dispatch Work Order Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BellOff,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Cpu,
  Flame,
  Gauge,
  HelpCircle,
  Layers,
  Play,
  Radio,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  StopCircle,
  Thermometer,
  WifiOff,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { Asset, EdgeAlert, Prediction, TelemetryRecord } from '../types';
import { apiClient } from '../api/client';
import { AlertsTable } from './AlertsTable';

interface FleetCommandCenterProps {
  assets: Asset[];
  selectedAssetId: string | null;
  onSelectAsset: (id: string) => void;
  telemetryHistory: Record<string, TelemetryRecord[]>;
  predictionHistory: Record<string, Prediction[]>;
  alerts: EdgeAlert[];
  isLoading: boolean;
  onOpenWhatIf: () => void;
  onRefreshData?: () => void;
  onNotification?: (msg: string, type?: 'success' | 'warning' | 'info') => void;
  personaMode: 'operator' | 'engineer';
  onClearUnreadAlerts?: () => void;
}

// ── Shared Helpers ──────────────────────────────────────────────────────────
export const getLineShort = (line: string): string => {
  if (!line) return '';
  return line.replace(/^line/i, 'Line ').trim();
};

export const getMachineName = (assetId: string): string => {
  if (!assetId) return '';
  return assetId.replace(/asset_?/i, 'Machine ').replace(/\b\w/g, (c) => c.toUpperCase());
};

export const getMachineIcon = (type: string) => {
  const t = (type || '').toLowerCase();
  if (t.includes('pump')) return '💧';
  if (t.includes('compressor')) return '🌀';
  if (t.includes('spindle')) return '⚡';
  return '⚙️';
};

export const FleetCommandCenter: React.FC<FleetCommandCenterProps> = ({
  assets,
  selectedAssetId,
  onSelectAsset,
  telemetryHistory,
  predictionHistory,
  alerts,
  isLoading,
  onOpenWhatIf,
  onRefreshData,
  onNotification,
  personaMode,
  onClearUnreadAlerts,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLineFilter, setSelectedLineFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [metricFilter, setMetricFilter] = useState<'all' | 'torque_speed' | 'temp' | 'wear'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // CSV export helper
  const handleExportCSV = () => {
    if (!activeAsset || activeTelemetry.length === 0) return;
    const headers = ['timestamp', 'torque_nm', 'speed_rpm', 'temp_celsius', 'tool_wear_min'];
    const rows = [...activeTelemetry].reverse().map((t) => [
      t.timestamp ?? '',
      t.torque ?? '',
      t.rotational_speed ?? '',
      t.process_temperature ? (t.process_temperature - 273.15).toFixed(1) : '',
      t.tool_wear ?? '',
    ]);
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telemetry_${activeAsset.asset_id}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    if (onNotification) onNotification(`↓ Exported ${activeTelemetry.length} records for ${getMachineName(activeAsset.asset_id)}`, 'success');
  };

  // Modals & Panels
  const [showWorkOrderModal, setShowWorkOrderModal] = useState<boolean>(false);
  const [workOrderNotes, setWorkOrderNotes] = useState<string>('');
  const [workOrderPriority, setWorkOrderPriority] = useState<string>('HIGH');
  const [showFleetAlerts, setShowFleetAlerts] = useState<boolean>(false);

  // Group assets by Line & Search
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      if (selectedLineFilter !== 'all' && asset.line !== selectedLineFilter) return false;
      if (selectedStatusFilter !== 'all' && asset.status !== selectedStatusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchId = asset.asset_id.toLowerCase().includes(q);
        const matchType = asset.asset_type.toLowerCase().includes(q);
        const matchLine = asset.line.toLowerCase().includes(q);
        if (!matchId && !matchType && !matchLine) return false;
      }
      return true;
    });
  }, [assets, selectedLineFilter, selectedStatusFilter, searchTerm]);

  // Selected asset object
  const activeAsset = useMemo(() => {
    return assets.find((a) => a.asset_id === selectedAssetId) || assets[0] || null;
  }, [assets, selectedAssetId]);

  const activeTelemetry = activeAsset ? telemetryHistory[activeAsset.asset_id] || [] : [];
  const activePredictions = activeAsset ? predictionHistory[activeAsset.asset_id] || [] : [];
  const activeAlerts = activeAsset ? alerts.filter((a) => a.asset_id === activeAsset.asset_id) : [];

  // Telemetry Chart Data formatting
  const chartData = useMemo(() => {
    return [...activeTelemetry]
      .reverse()
      .slice(-30)
      .map((t, i) => {
        const timeStr = t.timestamp
          ? new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : `${i}s`;
        return {
          time: timeStr,
          torque: t.torque ?? 0,
          speed: t.rotational_speed ?? 0,
          processTemp: t.process_temperature ? Number((t.process_temperature - 273.15).toFixed(1)) : 0,
          toolWear: t.tool_wear ?? 0,
        };
      });
  }, [activeTelemetry]);

  // Summary Metrics
  const onlineCount = assets.filter((a) => a.status === 'ONLINE').length;
  const criticalRiskCount = assets.filter((a) => (a.latest_prediction?.failure_probability ?? 0) >= 0.55).length;
  const avgToolWear = assets.length > 0
    ? Math.round(assets.reduce((acc, a) => acc + (a.latest_telemetry?.tool_wear || 0), 0) / assets.length)
    : 0;

  // Execute Operator Action
  const handleAction = async (action: string, notes?: string, faultType?: string) => {
    if (!activeAsset) return;
    setActionLoading(action);
    try {
      const res = await apiClient.executeAssetAction(activeAsset.asset_id, action, notes, faultType);
      if (onNotification) onNotification(res.message || `Action ${action} executed successfully.`, 'success');
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      if (onNotification) onNotification(err.message || 'Action failed', 'warning');
    } finally {
      setActionLoading(null);
      setShowWorkOrderModal(false);
    }
  };

  const latestProb = activeAsset?.latest_prediction?.failure_probability ?? 0;
  const isHighRisk = latestProb >= 0.55;
  const isEmergencyStopped = activeAsset?.status === 'EMERGENCY_STOP';

  // Buffer Status
  const buffer = activeAsset?.buffer_status;
  const accumulated = buffer ? buffer.accumulated_observations : 0;
  const required = buffer ? buffer.required_window_size : 30;
  const isBufferReady = buffer ? buffer.is_ready : false;

  return (
    <div className="w-full space-y-4">
      {/* ── 1. Top Fleet Health Summary Ribbon (Edge-to-Edge Glassmorphic) ── */}
      <div className="w-full glass-panel px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-sm font-bold text-white tracking-wide">Live Fleet Overview</span>
          </div>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <div className="flex items-center gap-5 text-xs">
            <div>
              <span className="text-slate-400">Total Units:</span>{' '}
              <span className="font-bold text-white font-mono">{assets.length}</span>
            </div>
            <div>
              <span className="text-slate-400">Online:</span>{' '}
              <span className="font-bold text-emerald-400 font-mono">{onlineCount}</span>
            </div>
            <div>
              <span className="text-slate-400">Attention:</span>{' '}
              <span className={`font-bold font-mono ${criticalRiskCount > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-300'}`}>
                {criticalRiskCount}
              </span>
            </div>
            <div className="hidden lg:block">
              <span className="text-slate-400">Avg Wear:</span>{' '}
              <span className="font-bold text-cyan-300 font-mono">{avgToolWear} min</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-slate-400">Active Mode:</span>{' '}
              <span className={`font-semibold px-2 py-0.5 rounded text-[10px] ${
                personaMode === 'operator'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
              }`}>
                {personaMode === 'operator' ? 'Standard' : 'Expert'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle Full Fleet Alerts Drawer */}
          <button
            onClick={() => {
              const opening = !showFleetAlerts;
              setShowFleetAlerts(opening);
              if (opening && onClearUnreadAlerts) onClearUnreadAlerts();
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              showFleetAlerts
                ? 'bg-amber-500/20 border border-amber-500/40 text-amber-200'
                : 'glass-interactive text-slate-300 hover:text-white'
            }`}
          >
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            <span>Alerts Feed ({alerts.length})</span>
            {showFleetAlerts ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
          </button>

          {onRefreshData && (
            <button
              onClick={onRefreshData}
              className="glass-interactive px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white flex items-center gap-1.5"
              title="Refresh telemetry & status from server"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}

          <button
            onClick={onOpenWhatIf}
            className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600/80 to-cyan-600/80 hover:from-indigo-500 hover:to-cyan-500 text-white text-xs font-semibold border border-cyan-400/30 flex items-center gap-1.5 shadow-lg shadow-cyan-950/40"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>What-If Sandbox</span>
            <Sparkles className="w-3 h-3 text-amber-300" />
          </button>
        </div>
      </div>

      {/* ── Optional Expandable Fleet-Wide Alerts Drawer ── */}
      {showFleetAlerts && (
        <div className="glass-panel p-4 animate-in slide-in-from-top-3 duration-200 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                Fleet Diagnostics &amp; Sequence Gaps Feed ({alerts.length} Total)
              </h3>
            </div>
            <button
              onClick={() => setShowFleetAlerts(false)}
              className="text-slate-400 hover:text-white text-xs p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <AlertsTable
            alerts={alerts}
            selectedAssetId={selectedAssetId}
            onSelectAsset={(id) => {
              onSelectAsset(id);
              setShowFleetAlerts(false);
            }}
          />
        </div>
      )}

      {/* ── 2. Master-Detail Split Pane (Full-Width, High Density) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        
        {/* ── LEFT PANE: ASSET FLEET DIRECTORY (4 COLS / ~33%) ── */}
        <div className="xl:col-span-4 glass-panel flex flex-col h-auto xl:h-[calc(100vh-140px)] min-h-[500px] overflow-hidden">
          {/* Header & Search */}
          <div className="p-4 border-b border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" /> Machine Directory
              </span>
              <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60">
                {filteredAssets.length} of {assets.length}
              </span>
            </div>

            {/* Quick Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search machine, type or line..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-cyan-400 transition-colors"
              />
            </div>

            {/* Production Line Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto text-[11px]">
              {['all', 'lineA', 'lineB', 'lineC', 'lineD'].map((line) => (
                <button
                  key={line}
                  onClick={() => setSelectedLineFilter(line)}
                  className={`px-2.5 py-1 rounded-md transition-all whitespace-nowrap ${
                    selectedLineFilter === line
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {line === 'all' ? 'All Lines' : getLineShort(line)}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable Asset List */}
          <div className="flex-1 overflow-y-auto divide-y divide-white/5 p-2 space-y-1">
            {filteredAssets.map((asset) => {
              const isSelected = asset.asset_id === selectedAssetId;
              const prob = asset.latest_prediction?.failure_probability ?? 0;
              const isHigh = prob >= 0.55;
              const isOnline = asset.status === 'ONLINE';

              return (
                <div
                  key={asset.asset_id}
                  onClick={() => onSelectAsset(asset.asset_id)}
                  className={`p-3 rounded-xl cursor-pointer transition-all flex items-center justify-between group ${
                    isSelected
                      ? 'bg-gradient-to-r from-blue-600/20 to-cyan-600/20 border border-cyan-400/50 shadow-md'
                      : 'hover:bg-white/[0.05] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Status Indicator Dot */}
                    <span
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        !isOnline
                          ? 'bg-slate-500'
                          : isHigh
                          ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] animate-ping'
                          : prob >= 0.35
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                    />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs" title={asset.asset_type.replace(/_/g, ' ')}>
                          {getMachineIcon(asset.asset_type)}
                        </span>
                        <span className="font-bold text-xs text-white group-hover:text-cyan-300 transition-colors">
                          {getMachineName(asset.asset_id)}
                        </span>
                        <code className="text-[10px] text-slate-500 font-mono">
                          {asset.asset_id}
                        </code>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                        <span className="capitalize">{asset.asset_type.replace(/_/g, ' ')}</span>
                        <span>&bull;</span>
                        <span className="text-cyan-300 font-medium">{getLineShort(asset.line)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      isHigh
                        ? 'bg-rose-500/15 text-rose-300'
                        : prob >= 0.35
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-emerald-500/15 text-emerald-300'
                    }`}>
                      {isHigh ? '🔴 High Risk' : prob >= 0.35 ? '🟡 Moderate' : '🟢 Normal'}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                      {asset.latest_telemetry?.tool_wear ?? 0} min wear
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT PANE: ACTIVE MACHINE INSPECTION STAGE (8 COLS / ~67%) ── */}
        <div className="xl:col-span-8 glass-panel flex flex-col h-auto xl:h-[calc(100vh-140px)] min-h-[500px] p-5 overflow-y-auto space-y-4">
          {activeAsset ? (
            <>
              {/* Active Asset Hero Bar & Primary Operator Actions */}
              <div className="pb-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                      <span>{getMachineName(activeAsset.asset_id)}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 text-cyan-300 font-mono font-normal">
                        {activeAsset.asset_id}
                      </span>
                    </h2>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                      isEmergencyStopped
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                        : isHighRisk
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    }`}>
                      {isEmergencyStopped ? 'EMERGENCY STOP' : activeAsset.status === 'ONLINE' ? 'ONLINE' : activeAsset.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Equipment: <strong className="text-slate-200 capitalize">{activeAsset.asset_type.replace(/_/g, ' ')}</strong> ·{' '}
                    Location: <strong className="text-slate-200">{activeAsset.location}</strong> ·{' '}
                    Line: <strong className="text-cyan-300">{getLineShort(activeAsset.line)}</strong>
                  </p>
                </div>

                {/* Operator Actions Button Group */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Dispatch Work Order Button */}
                  <button
                    onClick={() => setShowWorkOrderModal(true)}
                    disabled={actionLoading !== null}
                    className="glass-interactive px-3 py-1.5 rounded-lg text-xs font-medium text-blue-300 hover:text-blue-100 flex items-center gap-1.5 border border-blue-500/30"
                    title="Dispatch maintenance crew or work order ticket"
                  >
                    <Wrench className="w-3.5 h-3.5 text-blue-400" />
                    <span>Dispatch Crew</span>
                  </button>

                  {/* Acknowledge Alerts Button */}
                  <button
                    onClick={() => handleAction('ACKNOWLEDGE_ALERTS')}
                    disabled={actionLoading !== null || activeAlerts.length === 0}
                    className="glass-interactive px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-300 hover:text-emerald-100 flex items-center gap-1.5 border border-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Acknowledge and silence alerts for this machine"
                  >
                    <BellOff className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Acknowledge</span>
                  </button>

                  {/* Replace Cutter Button */}
                  <button
                    onClick={() => handleAction('REPLACE_TOOL')}
                    disabled={actionLoading !== null}
                    className="glass-interactive px-3 py-1.5 rounded-lg text-xs font-medium text-purple-300 hover:text-purple-100 flex items-center gap-1.5 border border-purple-500/30"
                    title="Clean tool cutter and reset tool wear counter to 0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-purple-400 ${actionLoading === 'REPLACE_TOOL' ? 'animate-spin' : ''}`} />
                    <span>Replace Cutter</span>
                  </button>

                  {/* Emergency Stop / Resume Machine */}
                  <button
                    onClick={() => handleAction(isEmergencyStopped ? 'RESUME_OPERATION' : 'EMERGENCY_STOP')}
                    disabled={actionLoading !== null}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      isEmergencyStopped
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        : 'bg-rose-600/80 hover:bg-rose-600 text-white border border-rose-400/50 shadow-md shadow-rose-950/60'
                    }`}
                  >
                    {isEmergencyStopped ? <Play className="w-3.5 h-3.5" /> : <StopCircle className="w-3.5 h-3.5" />}
                    <span>{isEmergencyStopped ? 'Resume Machine' : 'Emergency Stop'}</span>
                  </button>
                </div>
              </div>

              {/* ── Standard Mode: Plain English Diagnostic Callout ── */}
              {personaMode === 'operator' && (
                <div className={`p-3.5 rounded-xl border flex items-start gap-3 text-xs ${
                  isEmergencyStopped
                    ? 'bg-rose-950/40 border-rose-800 text-rose-200'
                    : isHighRisk
                    ? 'bg-amber-950/40 border-amber-800 text-amber-200'
                    : 'bg-emerald-950/30 border-emerald-800/80 text-emerald-200'
                }`}>
                  <div className="p-1.5 rounded-lg bg-black/20 flex-shrink-0 mt-0.5">
                    {isEmergencyStopped ? (
                      <StopCircle className="w-4 h-4 text-rose-400" />
                    ) : isHighRisk ? (
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    )}
                  </div>
                  <div>
                    <span className="font-bold block">
                      {isEmergencyStopped
                        ? 'Machine Halted — Emergency Safety Interlock Active'
                        : isHighRisk
                        ? 'Operator Advisory — Predictive Maintenance Required'
                        : 'Machine Operating Nominally — Safe State'}
                    </span>
                    <p className="text-[11px] opacity-90 mt-0.5">
                      {isEmergencyStopped
                        ? 'Power relay is open. Verify mechanical clearance before clicking "Resume Machine".'
                        : isHighRisk
                        ? `Failure probability is estimated at ${(latestProb * 100).toFixed(0)}%. Tool wear (${activeAsset.latest_telemetry?.tool_wear ?? 0} min) or spindle torque is elevated. Recommended action: Dispatch crew or replace cutter blade.`
                        : `Operating within standard factory parameters. Tool wear is currently at ${activeAsset.latest_telemetry?.tool_wear ?? 0} min with no abnormal vibration or thermal overheating.`}
                    </p>
                  </div>
                </div>
              )}

              {/* Live Metric Tiles (4-up compact ribbon) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="glass-cell p-3">
                  <div className="text-[11px] text-slate-400 font-sans flex items-center justify-between">
                    <span>Torque Load</span>
                    <span className="text-[10px] text-slate-500 font-mono">ACS712</span>
                  </div>
                  <div className="text-lg font-bold text-white mt-1">
                    {(activeAsset.latest_telemetry?.torque ?? 0).toFixed(1)} <span className="text-xs text-slate-400 font-normal">Nm</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-sans">
                    {personaMode === 'operator' ? ((activeAsset.latest_telemetry?.torque ?? 0) > 55 ? 'High torque' : 'Normal load') : 'Threshold: 60 Nm'}
                  </span>
                </div>

                <div className="glass-cell p-3">
                  <div className="text-[11px] text-slate-400 font-sans flex items-center justify-between">
                    <span>Motor Speed</span>
                    <span className="text-[10px] text-slate-500 font-mono">LM393</span>
                  </div>
                  <div className="text-lg font-bold text-cyan-300 mt-1">
                    {activeAsset.latest_telemetry?.rotational_speed ?? 0} <span className="text-xs text-slate-400 font-normal">RPM</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-sans">
                    {personaMode === 'operator' ? 'Spindle active' : 'Optical tachometer'}
                  </span>
                </div>

                <div className="glass-cell p-3">
                  <div className="text-[11px] text-slate-400 font-sans flex items-center justify-between">
                    <span>Process Temp</span>
                    <span className="text-[10px] text-slate-500 font-mono">DS18B20</span>
                  </div>
                  <div className="text-lg font-bold text-purple-300 mt-1">
                    {activeAsset.latest_telemetry?.process_temperature 
                      ? (activeAsset.latest_telemetry.process_temperature - 273.15).toFixed(1) 
                      : 0}{' '}
                    <span className="text-xs text-slate-400 font-normal">&deg;C</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-sans">
                    {personaMode === 'operator' ? 'Stator temp' : `Kelvin: ${(activeAsset.latest_telemetry?.process_temperature ?? 300).toFixed(1)} K`}
                  </span>
                </div>

                <div className="glass-cell p-3">
                  <div className="text-[11px] text-slate-400 font-sans flex items-center justify-between">
                    <span>Blade Wear</span>
                    <span className="text-[10px] text-slate-500 font-mono">Target &lt;200</span>
                  </div>
                  <div className="text-lg font-bold text-amber-300 mt-1">
                    {activeAsset.latest_telemetry?.tool_wear ?? 0} <span className="text-xs text-slate-400 font-normal">min</span>
                  </div>
                  {/* Wear progress bar */}
                  <div className="mt-1.5 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        (activeAsset.latest_telemetry?.tool_wear ?? 0) > 200
                          ? 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                          : (activeAsset.latest_telemetry?.tool_wear ?? 0) > 100
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.min(((activeAsset.latest_telemetry?.tool_wear ?? 0) / 250) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Synchronized Multi-Metric Telemetry Timeline Chart */}
              <div className="glass-cell p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Synchronized Telemetry Stream
                    </span>
                  </div>

                  {/* Metric Toggle Filters + CSV Export */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 text-[11px]">
                      {[
                        { id: 'all', label: 'All Metrics' },
                        { id: 'torque_speed', label: 'Torque & Speed' },
                        { id: 'temp', label: 'Temperature' },
                        { id: 'wear', label: 'Blade Wear' },
                      ].map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setMetricFilter(m.id as any)}
                          className={`px-2.5 py-0.5 rounded transition-all ${
                            metricFilter === m.id
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 font-semibold'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {/* CSV Export */}
                    <button
                      onClick={handleExportCSV}
                      disabled={activeTelemetry.length === 0}
                      title="Export telemetry as CSV"
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ArrowUpRight className="w-3 h-3" />
                      CSV
                    </button>
                  </div>
                </div>

                {/* Recharts Multi-Area Container (Gradient Area Chart) */}
                <div className="h-56 w-full">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradTorque" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradSpeed" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradTemp" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#c084fc" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#c084fc" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradWear" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                        <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} />
                        <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'rgba(15, 23, 42, 0.95)',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderRadius: '10px',
                            fontSize: '11px',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                        {(metricFilter === 'all' || metricFilter === 'torque_speed') && (
                          <Area type="monotone" dataKey="torque" name="Torque (Nm)" stroke="#38bdf8" strokeWidth={2} fill="url(#gradTorque)" dot={false} />
                        )}
                        {(metricFilter === 'all' || metricFilter === 'torque_speed') && (
                          <Area type="monotone" dataKey="speed" name="Motor Speed (scaled)" stroke="#34d399" strokeWidth={1.5} fill="url(#gradSpeed)" dot={false} />
                        )}
                        {(metricFilter === 'all' || metricFilter === 'temp') && (
                          <Area type="monotone" dataKey="processTemp" name="Temp (°C)" stroke="#c084fc" strokeWidth={2} fill="url(#gradTemp)" dot={false} />
                        )}
                        {(metricFilter === 'all' || metricFilter === 'wear') && (
                          <Area type="monotone" dataKey="toolWear" name="Blade Wear (min)" stroke="#fbbf24" strokeWidth={2} fill="url(#gradWear)" dot={false} />
                        )}
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-500">
                      Waiting for live telemetry stream...
                    </div>
                  )}
                </div>
              </div>

              {/* ── Live Chaos & Fault Injection Strip (Engineer Mode or Fast Testing) ── */}
              {(personaMode === 'engineer' || isHighRisk) && (
                <div className="glass-cell p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>Live Anomaly Injection Testbench</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">Target: {activeAsset.asset_id}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleAction('INJECT_FAULT', undefined, 'TORQUE_SPIKE')}
                      disabled={actionLoading !== null}
                      className="px-2.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-[11px] font-medium transition-colors flex items-center gap-1"
                    >
                      <Zap className="w-3 h-3 text-amber-400" />
                      <span>Torque Spike (78 Nm)</span>
                    </button>
                    <button
                      onClick={() => handleAction('INJECT_FAULT', undefined, 'THERMAL_OVERHEAT')}
                      disabled={actionLoading !== null}
                      className="px-2.5 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 text-[11px] font-medium transition-colors flex items-center gap-1"
                    >
                      <Flame className="w-3 h-3 text-rose-400" />
                      <span>Thermal Overheat</span>
                    </button>
                    <button
                      onClick={() => handleAction('INJECT_FAULT', undefined, 'TOOL_WEAR_SURGE')}
                      disabled={actionLoading !== null}
                      className="px-2.5 py-1 rounded bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-200 text-[11px] font-medium transition-colors flex items-center gap-1"
                    >
                      <Wrench className="w-3 h-3 text-purple-400" />
                      <span>Wear Surge (235m)</span>
                    </button>
                    <button
                      onClick={() => handleAction('INJECT_FAULT', undefined, 'NETWORK_DROPOUT')}
                      disabled={actionLoading !== null}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-medium transition-colors flex items-center gap-1"
                    >
                      <Radio className="w-3 h-3 text-slate-400" />
                      <span>Radio Dropout</span>
                    </button>
                    <button
                      onClick={() => handleAction('INJECT_FAULT', undefined, 'SEQUENCE_GAP')}
                      disabled={actionLoading !== null}
                      className="px-2.5 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 text-[11px] font-medium transition-colors flex items-center gap-1"
                    >
                      <span>Sequence Gap (+10)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* GRU Risk Assessment & Alert Feed */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Risk Progression & Sliding Window */}
                <div className="glass-cell p-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <Gauge className="w-4 h-4 text-cyan-400" /> GRU Failure Risk Score
                    </span>
                    <span className={`font-semibold text-sm ${
                      isHighRisk ? 'text-rose-400' : latestProb >= 0.35 ? 'text-amber-300' : 'text-emerald-400'
                    }`}>
                      {isHighRisk ? '🔴 High Risk' : latestProb >= 0.35 ? '🟡 Moderate' : '🟢 Normal'}
                    </span>
                  </div>
                  {/* Progress Bar */}
                  <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        isHighRisk ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.6)]' : latestProb >= 0.35 ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.min(latestProb * 100, 100)}%` }}
                    />
                  </div>

                  {/* Buffer Progress & Sliding Window Details */}
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
                    <span>Sliding Window:</span>
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className={isBufferReady ? 'text-emerald-400 font-bold' : 'text-amber-300'}>
                        {accumulated} / {required} steps
                      </span>
                      <span className={`px-1.5 py-0.2 rounded text-[9px] ${
                        isBufferReady ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                      }`}>
                        {isBufferReady ? 'Ready' : 'Filling'}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    {isHighRisk
                      ? '⚠️ High probability of mechanical failure. Immediate inspection advised.'
                      : '✅ Operating within nominal safety margins (Threshold τ = 0.55).'}
                  </p>
                </div>

                {/* Machine Alarms */}
                <div className="glass-cell p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <Bell className="w-4 h-4 text-amber-400" /> Active Machine Alerts ({activeAlerts.length})
                    </span>
                    {activeAlerts.length > 0 && (
                      <button
                        onClick={() => handleAction('ACKNOWLEDGE_ALERTS')}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 underline"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                  {activeAlerts.length > 0 ? (
                    <div className="space-y-1.5 max-h-28 overflow-y-auto">
                      {activeAlerts.map((al, idx) => (
                        <div key={al.id ?? `${al.asset_id}-${al.timestamp}-${idx}`} className="p-2 rounded bg-white/[0.03] border border-white/5 flex items-center justify-between">
                          <span className="text-[11px] text-amber-300">
                            {al.message
                              .replace(/Detected sequence gap of (\d+) message\(s\)/i, 'Data gap — $1 readings missed')
                              .replace(/between #(\d+) and #(\d+)/i, '')}
                          </span>
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                            al.severity === 'CRITICAL' ? 'bg-rose-500/20 text-rose-300' :
                            al.severity === 'WARNING' ? 'bg-amber-500/20 text-amber-300' :
                            'bg-slate-600/30 text-slate-400'
                          }`}>{al.severity}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">No active alerts for this machine.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm">
              Select a machine from the left to view its live details.
            </div>
          )}
        </div>

      </div>

      {/* ── Dispatch Work Order Modal ── */}
      {showWorkOrderModal && activeAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="glass-panel w-full max-w-md p-5 border border-white/10 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-blue-400" />
                <h4 className="text-sm font-bold text-white">
                  Dispatch Maintenance Crew
                </h4>
              </div>
              <span className="text-xs font-mono text-cyan-400 font-bold">
                {activeAsset.asset_id}
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Target Machine &amp; Location:</label>
                <div className="font-mono text-white bg-slate-900/80 p-2.5 rounded-lg border border-white/5">
                  {getMachineName(activeAsset.asset_id)} — {activeAsset.location} ({activeAsset.asset_type})
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Priority Level:</label>
                <select
                  value={workOrderPriority}
                  onChange={(e) => setWorkOrderPriority(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2 font-mono text-xs focus:outline-none focus:border-cyan-400"
                >
                  <option value="LOW">Low (Routine Check)</option>
                  <option value="MEDIUM">Medium (Scheduled Next Shift)</option>
                  <option value="HIGH">High (Immediate Shift Attention)</option>
                  <option value="URGENT">Urgent (Imminent Mechanical Failure)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Maintenance Notes &amp; Instructions:</label>
                <textarea
                  rows={3}
                  value={workOrderNotes}
                  onChange={(e) => setWorkOrderNotes(e.target.value)}
                  placeholder="Specify tool cutter replacement, lubrication, spindle check..."
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2.5 text-xs placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                onClick={() => setShowWorkOrderModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction('DISPATCH_WORK_ORDER', `[${workOrderPriority}] ${workOrderNotes || 'Preventive inspection dispatched via Fleet Command'}`)}
                disabled={actionLoading !== null}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-blue-950/60"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Issue Work Order</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FleetCommandCenter;

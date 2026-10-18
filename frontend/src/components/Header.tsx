import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle,
  ChevronDown,
  Cpu,
  Database,
  Flame,
  HelpCircle,
  LayoutDashboard,
  Layers,
  Radio,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  User,
  Wrench,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { ConnectionState } from '../api/websocket';
import { SystemHealth } from '../types';

export type MainNavigationTab = 'fleet' | 'twin' | 'simulator';
export type PersonaMode = 'operator' | 'engineer';

interface HeaderProps {
  wsState: ConnectionState;
  health: SystemHealth | null;
  healthLoading: boolean;
  onReconnectWs: () => void;
  onRefreshHealth: () => void;
  onOpenDisclaimer: () => void;
  onOpenWhatIf?: () => void;
  activeTab: MainNavigationTab;
  onSelectTab: (tab: MainNavigationTab) => void;
  personaMode: PersonaMode;
  onTogglePersona: () => void;
  alertCount?: number;
  onOpenAlerts?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  wsState,
  health,
  healthLoading,
  onReconnectWs,
  onRefreshHealth,
  onOpenDisclaimer,
  onOpenWhatIf,
  activeTab,
  onSelectTab,
  personaMode,
  onTogglePersona,
  alertCount = 0,
  onOpenAlerts,
}) => {
  const isWsConnected = wsState === 'connected';
  const isDbHealthy = health?.status === 'healthy';
  const isSystemNominal = isWsConnected && isDbHealthy;
  const [showStatusPopover, setShowStatusPopover] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full bg-slate-950/70 backdrop-blur-xl border-b border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          
          {/* ── 1. Brand & Logo ── */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                  Smart Asset Monitor
                </span>
                <span className="hidden sm:inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  v2.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Predictive Maintenance & Digital Twin
              </p>
            </div>
          </div>

          {/* ── 2. Unified Primary Navigation Bar (Simple & Clear) ── */}
          <nav className="flex items-center gap-1.5 bg-white/[0.04] p-1 rounded-xl border border-white/[0.08] backdrop-blur-md">
            {/* Tab 1: Fleet Overview */}
            <button
              onClick={() => onSelectTab('fleet')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'fleet'
                  ? 'bg-gradient-to-r from-blue-600/40 to-cyan-600/40 text-cyan-200 border border-cyan-400/40 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                  : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 text-cyan-400" />
              <span>Fleet Overview</span>
            </button>

            {/* Tab 2: Digital Twin Lab */}
            <button
              onClick={() => onSelectTab('twin')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'twin'
                  ? 'bg-gradient-to-r from-blue-600/40 to-cyan-600/40 text-cyan-200 border border-cyan-400/40 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                  : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>Digital Twin Lab</span>
            </button>

            {/* Tab 3: Stress Simulator */}
            <button
              onClick={() => onSelectTab('simulator')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'simulator'
                  ? 'bg-gradient-to-r from-blue-600/40 to-cyan-600/40 text-cyan-200 border border-cyan-400/40 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                  : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Flame className="w-4 h-4 text-amber-400" />
              <span>Stress Simulator</span>
            </button>
          </nav>

          {/* ── 3. Status Pill, Persona Switcher & Global Actions ── */}
          <div className="flex items-center gap-2">
            
            {/* Unified System Status Pill with Interactive Popover */}
            <div className="relative">
              <button
                onClick={() => setShowStatusPopover(!showStatusPopover)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  isSystemNominal
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15'
                }`}
                title="Click for real-time connection telemetry"
              >
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    isSystemNominal ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${
                    isSystemNominal ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}></span>
                </span>
                <span className="hidden md:inline font-medium">
                  {isSystemNominal ? 'System Live' : 'System Degraded'}
                </span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>

              {/* Status Popover Dropdown */}
              {showStatusPopover && (
                <div 
                  className="absolute right-0 mt-2 w-72 p-3.5 rounded-xl bg-slate-900/95 backdrop-blur-xl border border-white/10 shadow-2xl z-50 text-xs space-y-2.5 animate-in fade-in zoom-in-95 duration-150"
                  onMouseLeave={() => setShowStatusPopover(false)}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-cyan-400" /> Telemetry Health
                    </span>
                    <button
                      onClick={() => {
                        onRefreshHealth();
                        onReconnectWs();
                      }}
                      className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono"
                    >
                      <RefreshCw className={`w-3 h-3 ${healthLoading ? 'animate-spin' : ''}`} /> Sync
                    </button>
                  </div>

                  {/* Database Sub-Item */}
                  <div className="flex items-center justify-between bg-white/[0.03] p-2 rounded-lg border border-white/5">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <Database className="w-3.5 h-3.5 text-blue-400" /> Database:
                    </span>
                    <span className={`font-semibold capitalize ${isDbHealthy ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {healthLoading ? 'Checking...' : health ? health.status : 'Offline'}
                    </span>
                  </div>

                  {/* WebSocket Sub-Item */}
                  <div className="flex items-center justify-between bg-white/[0.03] p-2 rounded-lg border border-white/5">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      {isWsConnected ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-rose-400" />} Stream Rate:
                    </span>
                    <span className={`font-semibold capitalize ${isWsConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isWsConnected ? '1.0 Hz Active' : wsState}
                    </span>
                  </div>

                  {/* AI Risk Model Spec */}
                  <div className="flex items-center justify-between bg-white/[0.03] p-2 rounded-lg border border-white/5">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <Cpu className="w-3.5 h-3.5 text-purple-400" /> AI Engine:
                    </span>
                    <span className="font-mono text-cyan-300 font-semibold">GRU 2-Layer (64h)</span>
                  </div>
                </div>
              )}
            </div>

            {/* Persona Switcher (Operator vs Engineer) */}
            <button
              onClick={onTogglePersona}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-300 hover:text-white text-xs transition-all"
              title={`Switch Mode (Current: ${personaMode.toUpperCase()})`}
            >
              <User className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden lg:inline capitalize font-medium">{personaMode} Mode</span>
              <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                personaMode === 'operator' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
              }`}>
                {personaMode === 'operator' ? 'PLAIN' : 'TECH'}
              </span>
            </button>

            {/* Active Alerts Bell */}
            <button
              onClick={onOpenAlerts}
              className="relative p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-300 hover:text-white transition-all"
              title="Active Machine Alerts"
            >
              <Bell className="w-4 h-4" />
              {alertCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow-[0_0_8px_rgba(244,63,94,0.6)]">
                  {alertCount}
                </span>
              )}
            </button>

            {/* Specs & Methodology Modal Launcher */}
            <button
              onClick={onOpenDisclaimer}
              className="hidden sm:flex items-center gap-1.5 p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-300 hover:text-white text-xs transition-all"
              title="View Architecture Specifications & Academic Methodology"
            >
              <HelpCircle className="w-4 h-4 text-blue-400" />
              <span className="hidden xl:inline">Specs</span>
            </button>

            {/* What-If Sandbox Pill Button */}
            {onOpenWhatIf && (
              <button
                onClick={onOpenWhatIf}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600/90 to-cyan-600/90 hover:from-indigo-500 hover:to-cyan-500 text-white font-medium text-xs border border-cyan-400/30 shadow-[0_0_15px_rgba(99,102,241,0.3)] transition-all hover:scale-[1.02] active:scale-[0.98]"
                title="Launch What-If Digital Twin Sandbox"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-200" />
                <span className="hidden sm:inline">What-If Sandbox</span>
                <Sparkles className="w-3 h-3 text-amber-300 animate-pulse" />
              </button>
            )}

          </div>

        </div>
      </div>
    </header>
  );
};

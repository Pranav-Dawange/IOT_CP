import React, { useRef, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  Boxes,
  ChevronDown,
  Clock,
  Cpu,
  Database,
  Flame,
  HelpCircle,
  LayoutDashboard,
  Layers,
  MoreHorizontal,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  User,
  Waves,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { ConnectionState } from '../api/websocket';
import { SystemHealth } from '../types';

export type PageRoute = 'fleet' | 'twin' | 'wiring' | 'vibration' | 'simulator';
export type PersonaMode = 'operator' | 'engineer';

interface HeaderProps {
  wsState: ConnectionState;
  health: SystemHealth | null;
  healthLoading: boolean;
  onReconnectWs: () => void;
  onRefreshHealth: () => void;
  onOpenDisclaimer: () => void;
  onOpenWhatIf?: () => void;
  currentPage: PageRoute;
  onSelectPage: (page: PageRoute) => void;
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
  currentPage,
  onSelectPage,
  personaMode,
  onTogglePersona,
  alertCount = 0,
  onOpenAlerts,
}) => {
  const isWsConnected = wsState === 'connected';
  const isDbHealthy = health?.status === 'healthy';
  const isSystemNominal = isWsConnected && isDbHealthy;
  const [showStatusPopover, setShowStatusPopover] = useState(false);

  // Live clock & uptime
  const [now, setNow] = useState(new Date());
  const sessionStart = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const uptimeSec = Math.floor((now.getTime() - sessionStart.current) / 1000);
  const uptimeStr = uptimeSec < 60
    ? `${uptimeSec}s`
    : uptimeSec < 3600
    ? `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`
    : `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const navItems: Array<{ id: PageRoute; label: string; icon: React.ReactNode }> = [
    { id: 'fleet', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4 text-cyan-400" /> },
    { id: 'twin', label: '3D Model', icon: <Boxes className="w-4 h-4 text-blue-400" /> },
    { id: 'wiring', label: 'Wiring Guide', icon: <Layers className="w-4 h-4 text-emerald-400" /> },
    { id: 'vibration', label: 'Signal Health', icon: <Waves className="w-4 h-4 text-purple-400" /> },
    { id: 'simulator', label: 'Load Test', icon: <Flame className="w-4 h-4 text-amber-400" /> },
  ];

  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full bg-slate-950/80 backdrop-blur-xl border-b border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          
          {/* ── 1. Brand & Logo ── */}
          <div className="flex items-center gap-3 flex-shrink-0 cursor-pointer" onClick={() => onSelectPage('fleet')}>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                  Smart Machine Monitor
                </span>
                <span className="hidden sm:inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  Studio v2.5
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Industrial Predictive Maintenance Platform
              </p>
            </div>
          </div>

          {/* ── 1b. Live Clock & Uptime ── */}
          <div className="hidden lg:flex items-center gap-3 text-[10px] font-mono text-slate-400 bg-white/[0.03] px-3 py-1.5 rounded-lg border border-white/[0.06]">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-cyan-500 opacity-70" />
              <span className="text-white/80">{timeStr}</span>
            </span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center gap-1">
              <span className="text-slate-500">UP</span>
              <span className="text-emerald-400">{uptimeStr}</span>
            </span>
          </div>

          {/* ── 2. Unified 5 Dedicated Webpages Navigation Bar ── */}
          <nav className="hidden md:flex items-center gap-1 bg-white/[0.04] p-1 rounded-xl border border-white/[0.08] backdrop-blur-md">
            {navItems.map((item) => {
              const isActive = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectPage(item.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-blue-600/40 to-cyan-600/40 text-cyan-200 border border-cyan-400/40 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                      : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Mobile page selector */}
          <div className="flex md:hidden">
            <select
              value={currentPage}
              onChange={(e) => onSelectPage(e.target.value as PageRoute)}
              className="bg-slate-900 border border-slate-700 text-cyan-300 text-xs rounded-lg px-2.5 py-1.5"
            >
              {navItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

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
                <span className="hidden xl:inline font-medium">
                  {isSystemNominal ? 'System Live' : 'Degraded'}
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

            {/* Persona Switcher: Standard / Expert */}
            <button
              onClick={onTogglePersona}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-300 hover:text-white text-xs transition-all"
              title={`View mode: ${personaMode === 'operator' ? 'Standard (simplified)' : 'Expert (full details)'}`}
            >
              <User className="w-3.5 h-3.5 text-cyan-400" />
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                personaMode === 'operator' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
              }`}>
                {personaMode === 'operator' ? 'Standard' : 'Expert'}
              </span>
            </button>

            {/* Active Alerts Bell */}
            <button
              onClick={onOpenAlerts}
              className="relative p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-300 hover:text-white transition-all"
              title="Active machine alerts"
            >
              <Bell className="w-4 h-4" />
              {alertCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow-[0_0_8px_rgba(244,63,94,0.6)]">
                  {alertCount}
                </span>
              )}
            </button>

            {/* ⋯ Overflow menu for less-used actions */}
            <div className="relative" ref={overflowRef}>
              <button
                onClick={() => setShowOverflow(!showOverflow)}
                className="p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-300 hover:text-white transition-all"
                title="More options"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {showOverflow && (
                <div className="absolute right-0 mt-2 w-52 py-1.5 rounded-xl bg-slate-900/95 backdrop-blur-xl border border-white/10 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150">
                  {onOpenWhatIf && (
                    <button
                      onClick={() => { setShowOverflow(false); onOpenWhatIf(); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
                      <span>What-If Scenario</span>
                      <Sparkles className="w-3 h-3 text-amber-300 ml-auto" />
                    </button>
                  )}
                  <button
                    onClick={() => { setShowOverflow(false); onOpenDisclaimer(); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
                    <span>About this Platform</span>
                  </button>
                </div>
              )}
            </div>

          </div>

        </div>
      </div>
    </header>
  );
};

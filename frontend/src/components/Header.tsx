import { Activity, AlertTriangle, CheckCircle, Database, HelpCircle, RefreshCw, SlidersHorizontal, Wifi, WifiOff } from 'lucide-react';
import { ConnectionState } from '../api/websocket';
import { SystemHealth } from '../types';

interface HeaderProps {
  wsState: ConnectionState;
  health: SystemHealth | null;
  healthLoading: boolean;
  onReconnectWs: () => void;
  onRefreshHealth: () => void;
  onOpenDisclaimer: () => void;
  onOpenWhatIf?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  wsState,
  health,
  healthLoading,
  onReconnectWs,
  onRefreshHealth,
  onOpenDisclaimer,
  onOpenWhatIf,
}) => {
  const isWsConnected = wsState === 'connected';
  const isDbHealthy = health?.status === 'healthy';

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between py-3 gap-3">
          {/* Title & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Activity className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                  Smart Industrial Asset Monitoring
                </h1>
                <span className="text-xs px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 font-mono">
                  Phase 7 Live
                </span>
              </div>
              <p className="text-xs text-slate-400">
                AI4I 2020 Continuous Telemetry Stream & Frozen GRU Risk Engine (τ = 0.55)
              </p>
            </div>
          </div>

          {/* Model Contract & Live Status Badges */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Frozen Model Specs Badge */}
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800/80 border border-slate-700/80 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              <span className="font-semibold text-cyan-300">Frozen GRU:</span>
              <span className="font-mono text-slate-300">2-Layer (64h) | 30→10 Horizon | Thr: 0.55</span>
            </div>

            {/* Database Health Badge */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs cursor-pointer transition-colors ${
                isDbHealthy
                  ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                  : 'bg-amber-950/40 border-amber-800/80 text-amber-300'
              }`}
              onClick={onRefreshHealth}
              title="Click to re-check backend database health"
            >
              <Database className="w-3.5 h-3.5" />
              <span>TimescaleDB:</span>
              <span className="font-semibold capitalize">
                {healthLoading ? 'checking...' : health ? health.status : 'offline'}
              </span>
              <RefreshCw className={`w-3 h-3 ml-0.5 opacity-60 hover:opacity-100 ${healthLoading ? 'animate-spin' : ''}`} />
            </div>

            {/* WebSocket Connection Badge */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs cursor-pointer transition-colors ${
                isWsConnected
                  ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                  : wsState === 'connecting'
                  ? 'bg-amber-950/40 border-amber-800/80 text-amber-300'
                  : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
              }`}
              onClick={onReconnectWs}
              title={isWsConnected ? 'WebSocket live stream active' : 'Click to reconnect live WebSocket stream'}
            >
              {isWsConnected ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <Wifi className="w-3.5 h-3.5" />
                  <span className="font-semibold">Live /ws/live</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  <span className="font-semibold capitalize">{wsState}</span>
                  <RefreshCw className="w-3 h-3 ml-0.5 opacity-70 animate-spin" />
                </>
              )}
            </div>

            {/* Methodological Info Button */}
            <button
              onClick={onOpenDisclaimer}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
              title="View methodology, frozen contracts, and synthetic timeline semantics"
            >
              <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
              <span>Specs & Limits</span>
            </button>

            {/* Interactive What-If Sandbox Button */}
            {onOpenWhatIf && (
              <button
                onClick={onOpenWhatIf}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600/90 hover:bg-indigo-500 text-white font-medium border border-indigo-500/50 shadow transition-colors"
                title="Launch interactive What-If Digital Twin Sandbox"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-200" />
                <span>What-If Sandbox</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import { SimulationDashboard } from './components/SimulationDashboard';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Database,
  Flame,
  Gauge,
  Layers,
  LayoutDashboard,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Thermometer,
  WifiOff,
  Wrench,
} from 'lucide-react';

import { apiClient } from './api/client';
import { ConnectionState, liveWs } from './api/websocket';
import { AlertsTable } from './components/AlertsTable';
import { AssetFilter } from './components/AssetFilter';
import { AssetGrid } from './components/AssetGrid';
import { DisclaimerModal } from './components/DisclaimerModal';
import { Header } from './components/Header';
import { OperatorControlPanel } from './components/OperatorControlPanel';
import { RiskGaugeChart } from './components/RiskGaugeChart';
import { StatsOverview } from './components/StatsOverview';
import { TelemetryCharts } from './components/TelemetryCharts';
import { WhatIfSandboxModal } from './components/WhatIfSandboxModal';
import { Asset, EdgeAlert, LiveEvent, Prediction, SystemHealth, TelemetryRecord, WorkOrder } from './types';

export const App: React.FC = () => {
  // Core Application State
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>('asset_01');
  const [telemetryHistory, setTelemetryHistory] = useState<Record<string, TelemetryRecord[]>>({});
  const [predictionHistory, setPredictionHistory] = useState<Record<string, Prediction[]>>({});
  const [alerts, setAlerts] = useState<EdgeAlert[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);

  // Connection & Loading States
  const [wsState, setWsState] = useState<ConnectionState>('disconnected');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [healthLoading, setHealthLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState<boolean>(false);
  const [isWhatIfOpen, setIsWhatIfOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'monitor' | 'simulation'>('simulation');
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'warning' | 'info' }>>([]);

  const showToast = (message: string, type: 'success' | 'warning' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  // Filter States
  const [selectedLine, setSelectedLine] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // --------------------------------------------------------------------------
  // 1. Initial REST API Data Ingestion
  // --------------------------------------------------------------------------
  const loadInitialData = async () => {
    setIsLoading(true);
    setApiError(null);
    try {
      const [healthData, assetsData, alertsData] = await Promise.all([
        apiClient.getHealth().catch((err) => {
          console.warn('[REST API] Failed to fetch health:', err);
          return null;
        }),
        apiClient.getAssets().catch((err) => {
          throw new Error(`Failed to load asset inventory: ${err.message}`);
        }),
        apiClient.getAlerts({ limit: 50 }).catch((err) => {
          console.warn('[REST API] Failed to fetch alerts:', err);
          return [] as EdgeAlert[];
        }),
      ]);

      if (healthData) setHealth(healthData);
      setAssets(assetsData);
      setAlerts(alertsData);

      // Pre-select first asset if not already selected or invalid
      if (!selectedAssetId && assetsData.length > 0) {
        setSelectedAssetId(assetsData[0].asset_id);
      }
    } catch (err: any) {
      console.error('[REST API] Ingestion Error:', err);
      setApiError(err.message || 'Failed to connect to backend REST API.');
    } finally {
      setIsLoading(false);
    }
  };

  const refreshHealth = async () => {
    setHealthLoading(true);
    try {
      const h = await apiClient.getHealth();
      setHealth(h);
    } catch (err) {
      console.warn('[REST API] Health check failed:', err);
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  };

  // --------------------------------------------------------------------------
  // 2. Fetch Detailed Telemetry & Predictions for Selected Asset
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!selectedAssetId) return;

    let isMounted = true;

    const loadSelectedAssetData = async () => {
      try {
        const [telem, preds] = await Promise.all([
          apiClient.getAssetTelemetry(selectedAssetId, 50).catch(() => [] as TelemetryRecord[]),
          apiClient.getAssetPredictions(selectedAssetId, 30).catch(() => [] as Prediction[]),
        ]);

        if (isMounted) {
          setTelemetryHistory((prev) => ({
            ...prev,
            [selectedAssetId]: telem,
          }));

          setPredictionHistory((prev) => ({
            ...prev,
            [selectedAssetId]: preds,
          }));

          // Attach latest reading to asset card if available
          if (telem.length > 0) {
            setAssets((prev) =>
              prev.map((a) =>
                a.asset_id === selectedAssetId ? { ...a, latest_telemetry: telem[0] } : a
              )
            );
          }
        }
      } catch (err) {
        console.warn(`[REST API] Failed to load data for ${selectedAssetId}:`, err);
      }
    };

    loadSelectedAssetData();

    return () => {
      isMounted = false;
    };
  }, [selectedAssetId]);

  // --------------------------------------------------------------------------
  // 3. WebSocket Real-Time Event Subscription (/ws/live)
  // --------------------------------------------------------------------------
  useEffect(() => {
    loadInitialData();

    // Subscribe to WebSocket connection status changes
    const unsubState = liveWs.onStateChange((state) => {
      setWsState(state);
    });

    // 1. Live Telemetry
    const unsubTelemetry = liveWs.on<TelemetryRecord>('telemetry', (event: LiveEvent<TelemetryRecord>) => {
      const record = event.data;
      if (!record || !record.asset_id) return;

      const aid = record.asset_id;

      // Update asset telemetry history
      setTelemetryHistory((prev) => {
        const current = prev[aid] || [];
        // Keep up to 60 readings for chart responsiveness
        const updated = [record, ...current.filter((r) => r.sequence_number !== record.sequence_number)].slice(0, 60);
        return { ...prev, [aid]: updated };
      });

      // Update asset status and latest telemetry on asset card
      setAssets((prev) =>
        prev.map((a) => {
          if (a.asset_id === aid) {
            return {
              ...a,
              status: 'ONLINE',
              last_seen_timestamp: record.timestamp,
              latest_telemetry: record,
              buffer_status: a.buffer_status
                ? {
                    ...a.buffer_status,
                    accumulated_observations: Math.min(
                      a.buffer_status.required_window_size,
                      a.buffer_status.accumulated_observations + 1
                    ),
                    last_sequence_number: record.sequence_number,
                  }
                : null,
            };
          }
          return a;
        })
      );
    });

    // 2. Live GRU Prediction
    const unsubPrediction = liveWs.on<Prediction>('prediction', (event: LiveEvent<Prediction>) => {
      const pred = event.data;
      if (!pred || !pred.asset_id) return;

      const aid = pred.asset_id;

      setPredictionHistory((prev) => {
        const current = prev[aid] || [];
        return {
          ...prev,
          [aid]: [pred, ...current.filter((p) => p.prediction_timestamp !== pred.prediction_timestamp)].slice(0, 50),
        };
      });

      setAssets((prev) =>
        prev.map((a) => {
          if (a.asset_id === aid) {
            return {
              ...a,
              latest_prediction: pred,
              buffer_status: a.buffer_status
                ? {
                    ...a.buffer_status,
                    is_ready: true,
                    accumulated_observations: a.buffer_status.required_window_size,
                  }
                : null,
            };
          }
          return a;
        })
      );
    });

    // 3. Live Edge Alert
    const unsubAlert = liveWs.on<EdgeAlert>('alert', (event: LiveEvent<EdgeAlert>) => {
      const alert = event.data;
      if (!alert) return;
      setAlerts((prev) => [alert, ...prev.slice(0, 99)]);
    });

    // 4. Live Asset Status
    const unsubStatus = liveWs.on<any>('status', (event: LiveEvent<any>) => {
      const statusData = event.data;
      if (!statusData || !statusData.asset_id) return;

      setAssets((prev) =>
        prev.map((a) => {
          if (a.asset_id === statusData.asset_id) {
            return {
              ...a,
              status: statusData.status || a.status,
              last_seen_timestamp: statusData.last_seen_timestamp || a.last_seen_timestamp,
              reason: statusData.reason || a.reason,
            };
          }
          return a;
        })
      );
    });

    // 5. Live Work Orders
    const unsubWorkOrder = liveWs.on<WorkOrder>('work_order', (event: LiveEvent<WorkOrder>) => {
      const wo = event.data;
      if (wo) {
        showToast(`📋 Work Order ${wo.work_order_id} dispatched for ${wo.asset_id}!`, 'info');
      }
    });

    // 6. Live Operator Actions
    const unsubOperatorAction = liveWs.on<any>('operator_action', (event: LiveEvent<any>) => {
      const act = event.data;
      if (act) {
        showToast(`⚙️ ${act.message || act.action}`, 'success');
        if (act.action === 'TOOL_REPLACED') {
          setAssets((prev) =>
            prev.map((a) =>
              a.asset_id === act.asset_id
                ? {
                    ...a,
                    buffer_status: a.buffer_status
                      ? { ...a.buffer_status, accumulated_observations: 0, is_ready: false }
                      : null,
                  }
                : a
            )
          );
        }
      }
    });

    // Connect to WebSocket server
    liveWs.connect();

    return () => {
      unsubState();
      unsubTelemetry();
      unsubPrediction();
      unsubAlert();
      unsubStatus();
      unsubWorkOrder();
      unsubOperatorAction();
      liveWs.disconnect();
    };
  }, []);

  // --------------------------------------------------------------------------
  // 4. Filtering and Asset Search
  // --------------------------------------------------------------------------
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      if (selectedLine !== 'all' && asset.line !== selectedLine) {
        return false;
      }
      if (selectedStatus !== 'all' && asset.status !== selectedStatus) {
        return false;
      }
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchId = asset.asset_id.toLowerCase().includes(query);
        const matchType = asset.asset_type.toLowerCase().includes(query);
        const matchLine = asset.line.toLowerCase().includes(query);
        const matchLoc = asset.location.toLowerCase().includes(query);
        if (!matchId && !matchType && !matchLine && !matchLoc) {
          return false;
        }
      }
      return true;
    });
  }, [assets, selectedLine, selectedStatus, searchTerm]);

  // Currently selected asset object
  const selectedAsset = useMemo(() => {
    return assets.find((a) => a.asset_id === selectedAssetId) || assets[0] || null;
  }, [assets, selectedAssetId]);

  const selectedTelemetry = selectedAsset
    ? telemetryHistory[selectedAsset.asset_id] || []
    : [];

  const selectedPredictions = selectedAsset
    ? predictionHistory[selectedAsset.asset_id] || []
    : [];

  const handleResetFilters = () => {
    setSelectedLine('all');
    setSelectedStatus('all');
    setSearchTerm('');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Application Header */}
      <Header
        wsState={wsState}
        health={health}
        healthLoading={healthLoading}
        onReconnectWs={() => liveWs.connect()}
        onRefreshHealth={refreshHealth}
        onOpenDisclaimer={() => setIsDisclaimerOpen(true)}
        onOpenWhatIf={() => setIsWhatIfOpen(true)}
      />

      {/* Tab Navigation */}
      <div className="border-b border-slate-800 bg-slate-950/80">
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-1">
          <button
            onClick={() => setActiveTab('monitor')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'monitor'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            Live Monitoring
          </button>
          <button
            onClick={() => setActiveTab('simulation')}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'simulation'
                ? 'border-cyan-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5 text-cyan-400" />
            Hardware Prototype Simulator
            <span className="px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[9px] font-mono">
              PROTOTYPE
            </span>
          </button>
        </div>
      </div>

      {/* Main Dashboard Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-5">
        {/* API Error Notification Banner */}
        {apiError && (
          <div className="bg-rose-950/80 border border-rose-800 text-rose-200 rounded-lg p-3.5 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-2.5 text-xs">
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              <div>
                <span className="font-bold">Backend Connection Error: </span>
                <span>{apiError}</span>
                <span className="block text-[11px] text-rose-300/80 mt-0.5">
                  Verify the FastAPI backend is running (<code className="text-white">http://localhost:8000</code>).
                </span>
              </div>
            </div>
            <button
              onClick={loadInitialData}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-rose-900 hover:bg-rose-800 text-white text-xs font-semibold transition-colors flex-shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* WebSocket Disconnected Banner */}
        {wsState === 'disconnected' && !apiError && (
          <div className="bg-amber-950/40 border border-amber-800/80 text-amber-200 rounded-lg p-3 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-amber-400" />
              <span>
                <strong>WebSocket stream disconnected:</strong> Real-time streaming paused. Automatic reconnection active...
              </span>
            </div>
            <button
              onClick={() => liveWs.connect()}
              className="px-2.5 py-1 rounded bg-amber-900/60 hover:bg-amber-800 text-amber-100 font-medium transition-colors"
            >
              Reconnect Now
            </button>
          </div>
        )}

        {/* ── Simulation Tab ── */}
        {activeTab === 'simulation' && (
          <SimulationDashboard assets={assets} onNotification={showToast} />
        )}

        {/* ── Monitoring Tab content below ── */}
        {activeTab === 'monitor' && (
          <>
        {/* Key Operational Indicators Bar */}
        <StatsOverview assets={assets} alerts={alerts} />

        {/* Selected Asset Deep Dive Section */}
        {selectedAsset && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                  Active Asset Deep Dive: {selectedAsset.asset_id} ({selectedAsset.line})
                </h2>
              </div>
              <span className="text-xs text-slate-400">
                Click any asset card below to inspect its live curves and GRU failure risk
              </span>
            </div>

            {/* Interactive Operator Control Center */}
            <OperatorControlPanel
              asset={selectedAsset}
              onOpenWhatIf={() => setIsWhatIfOpen(true)}
              onRefreshData={loadInitialData}
              onNotification={showToast}
            />

            {/* GRU Risk Trajectory & Sensor Telemetry Side-by-Side or Stacked */}
            <div className="grid grid-cols-1 gap-5">
              {/* Failure Risk Score & Progression */}
              <RiskGaugeChart
                asset={selectedAsset}
                predictions={selectedPredictions}
                isLoading={isLoading}
              />

              {/* Real-Time Sensor Telemetry Charts */}
              <TelemetryCharts
                asset={selectedAsset}
                telemetry={selectedTelemetry}
                isLoading={isLoading}
              />
            </div>
          </section>
        )}

        {/* All Monitored Assets Grid Section */}
        <section className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                Asset Fleet Overview (20 Assets)
              </h2>
            </div>
          </div>

          {/* Filtering & Search Toolbar */}
          <AssetFilter
            selectedLine={selectedLine}
            selectedStatus={selectedStatus}
            searchTerm={searchTerm}
            onSelectLine={setSelectedLine}
            onSelectStatus={setSelectedStatus}
            onSearchChange={setSearchTerm}
            onResetFilters={handleResetFilters}
            totalMatching={filteredAssets.length}
          />

          {/* Responsive Asset Cards Grid */}
          <AssetGrid
            assets={filteredAssets}
            selectedAssetId={selectedAssetId}
            onSelectAsset={(id) => setSelectedAssetId(id)}
            isLoading={isLoading}
            onResetFilters={handleResetFilters}
          />
        </section>

        {/* Recent Diagnostics & Sequence Gaps Feed */}
        <section className="pt-2">
          <AlertsTable
            alerts={alerts}
            selectedAssetId={selectedAssetId}
            onSelectAsset={(id) => setSelectedAssetId(id)}
          />
        </section>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>
            Smart Industrial Asset Monitoring & Failure Prediction System • Phase 7 Live Dashboard
          </p>
          <div className="flex items-center gap-4 text-[11px] font-mono">
            <span>Model: Frozen 2-Layer GRU</span>
            <span>•</span>
            <span>Threshold: 0.55</span>
            <span>•</span>
            <button
              onClick={() => setIsDisclaimerOpen(true)}
              className="text-blue-400 hover:underline"
            >
              Methodological Disclaimer
            </button>
          </div>
        </div>
      </footer>

      {/* Methodological & Architectural Specs Modal */}
      <DisclaimerModal
        isOpen={isDisclaimerOpen}
        onClose={() => setIsDisclaimerOpen(false)}
      />

      {/* Interactive What-If Digital Twin Sandbox Modal */}
      <WhatIfSandboxModal
        isOpen={isWhatIfOpen}
        onClose={() => setIsWhatIfOpen(false)}
        selectedAsset={selectedAsset}
      />

      {/* Toast Notification Stack */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-3.5 rounded-xl border shadow-2xl flex items-center gap-2.5 text-xs font-medium animate-in slide-in-from-bottom-3 duration-200 ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-600 text-emerald-100 shadow-emerald-950/50'
                : toast.type === 'warning'
                ? 'bg-amber-950/90 border-amber-600 text-amber-100 shadow-amber-950/50'
                : 'bg-slate-900/95 border-blue-500/70 text-slate-100 shadow-black/80'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
            {toast.type === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />}
            {toast.type === 'info' && <Wrench className="w-4 h-4 text-blue-400 flex-shrink-0" />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;

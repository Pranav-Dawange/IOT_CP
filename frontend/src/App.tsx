import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Waves,
  WifiOff,
  Wrench,
} from 'lucide-react';

import { apiClient } from './api/client';
import { ConnectionState, liveWs } from './api/websocket';
import { AlertsTable } from './components/AlertsTable';
import { DisclaimerModal } from './components/DisclaimerModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FleetCommandCenter } from './components/FleetCommandCenter';
import { Header, PageRoute } from './components/Header';
import { InteractiveBreadboardWiring } from './components/InteractiveBreadboardWiring';
import { MachinePrototypeSimulator } from './components/MachinePrototypeSimulator';
import { SimulationDashboard } from './components/SimulationDashboard';
import { VibrationSpectrumAnalyzer } from './components/VibrationSpectrumAnalyzer';
import { WhatIfSandboxModal } from './components/WhatIfSandboxModal';
import { Asset, EdgeAlert, LiveEvent, Prediction, SystemHealth, TelemetryRecord, WorkOrder } from './types';

export const App: React.FC = () => {
  // Core Application State
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>('asset_01');
  const [telemetryHistory, setTelemetryHistory] = useState<Record<string, TelemetryRecord[]>>({});
  const [predictionHistory, setPredictionHistory] = useState<Record<string, Prediction[]>>({});
  const [alerts, setAlerts] = useState<EdgeAlert[]>([]);
  const [unreadAlertCount, setUnreadAlertCount] = useState<number>(0);
  const [health, setHealth] = useState<SystemHealth | null>(null);

  // Connection & Loading States
  const [wsState, setWsState] = useState<ConnectionState>('disconnected');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [healthLoading, setHealthLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState<boolean>(false);
  const [isWhatIfOpen, setIsWhatIfOpen] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<PageRoute>(() => {
    const hash = window.location.hash.replace('#', '') as PageRoute;
    return ['fleet', 'twin', 'wiring', 'vibration', 'simulator'].includes(hash) ? hash : 'fleet';
  });
  const [personaMode, setPersonaMode] = useState<'operator' | 'engineer'>('operator');
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'warning' | 'info' }>>([]);


  // ── Page transition key (increments on page change to re-mount animation) ─
  const [pageKey, setPageKey] = useState(0);

  const showToast = (message: string, type: 'success' | 'warning' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const handleSelectPage = (page: PageRoute) => {
    setCurrentPage(page);
    setPageKey((k) => k + 1);
    window.location.hash = page;
  };

  // ── Keyboard shortcuts: 1–5 = pages, Esc = close modals ──────────────────
  useEffect(() => {
    const pages: PageRoute[] = ['fleet', 'twin', 'wiring', 'vibration', 'simulator'];
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        setIsDisclaimerOpen(false);
        setIsWhatIfOpen(false);
      } else if (e.key >= '1' && e.key <= '5') {
        const idx = parseInt(e.key, 10) - 1;
        if (pages[idx]) handleSelectPage(pages[idx]);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '') as PageRoute;
      if (['fleet', 'twin', 'wiring', 'vibration', 'simulator'].includes(hash)) {
        setCurrentPage(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

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
      // Increment unread badge — only new WS alerts count, not historical pre-loads
      setUnreadAlertCount((c) => c + 1);
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
        showToast(`📋 Work Order ${wo.work_order_id} dispatched for ${wo.asset_id.replace(/asset_?/i, 'Machine ')}!`, 'info');
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
      {/* Top Application Header & Unified Navigation */}
      <Header
        wsState={wsState}
        health={health}
        healthLoading={healthLoading}
        onReconnectWs={() => liveWs.connect()}
        onRefreshHealth={refreshHealth}
        onOpenDisclaimer={() => setIsDisclaimerOpen(true)}
        onOpenWhatIf={() => setIsWhatIfOpen(true)}
        currentPage={currentPage}
        onSelectPage={handleSelectPage}
        personaMode={personaMode}
        onTogglePersona={() => setPersonaMode((p) => (p === 'operator' ? 'engineer' : 'operator'))}
        alertCount={unreadAlertCount}
        onOpenAlerts={() => {
          handleSelectPage('fleet');
          setUnreadAlertCount(0); // Mark all as read when user opens the feed
          showToast(`Showing ${alerts.length} fleet alerts in Fleet Command.`, 'info');
        }}
      />

      {/* Main Dashboard Container (100% Full-Width Edge-to-Edge) */}
      <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-4 space-y-3">
        {/* API Error Notification Banner */}
        {apiError && (
          <div className="bg-rose-950/80 border border-rose-800 text-rose-200 rounded-lg p-3.5 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-2.5 text-xs">
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              <div>
                <span className="font-bold">Could not reach the server. </span>
                <span>Please make sure the backend is running.</span>
                <span className="block text-[11px] text-rose-300/80 mt-0.5">
                  Expected at: <code className="text-white">http://localhost:8000</code>
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
                <strong>Live stream paused.</strong> Reconnecting automatically...
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

        {/* ── Page 1: Dashboard (Machine Fleet Overview) ── */}
        {currentPage === 'fleet' && (
          <ErrorBoundary fallbackTitle="Fleet Dashboard Unavailable">
            <div key={pageKey} className="animate-page-in">
              <FleetCommandCenter
              assets={assets}
              selectedAssetId={selectedAssetId}
              onSelectAsset={setSelectedAssetId}
              telemetryHistory={telemetryHistory}
              predictionHistory={predictionHistory}
              alerts={alerts}
              isLoading={isLoading}
              onOpenWhatIf={() => setIsWhatIfOpen(true)}
              onRefreshData={loadInitialData}
              onNotification={showToast}
              personaMode={personaMode}
              onClearUnreadAlerts={() => setUnreadAlertCount(0)}
            />
            </div>
          </ErrorBoundary>
        )}

        {/* ── Page 2: 3D Model (3D Digital Twin Studio & Hardware Lab) ── */}
        {currentPage === 'twin' && (
          <ErrorBoundary fallbackTitle="3D Digital Twin Studio Unavailable">
            <div key={pageKey} className="w-full animate-page-in">
              <MachinePrototypeSimulator assets={assets} />
            </div>
          </ErrorBoundary>
        )}

        {/* ── Page 3: Wiring Guide (Interactive Hardware Wiring) ── */}
        {currentPage === 'wiring' && (
          <ErrorBoundary fallbackTitle="Wiring Guide Studio Unavailable">
            <div key={pageKey} className="w-full animate-page-in">
              <InteractiveBreadboardWiring />
            </div>
          </ErrorBoundary>
        )}

        {/* ── Page 4: Signal Health (Vibration & Frequency Diagnostics) ── */}
        {currentPage === 'vibration' && (
          <ErrorBoundary fallbackTitle="Vibration Diagnostics Unavailable">
            <div key={pageKey} className="w-full space-y-4 animate-page-in">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 rounded-xl glass-panel text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/40">
                    <Waves className="w-4 h-4 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-xs tracking-wide">
                      FFT Spectral Analysis &amp; Bearing Diagnostics
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Real-time envelope demodulation, ISO 10816 velocity severity &amp; defect harmonics
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Selected Machine:</span>
                  <select
                    value={selectedAssetId || 'asset_01'}
                    onChange={(e) => setSelectedAssetId(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono font-bold text-cyan-300 focus:outline-none focus:border-cyan-500"
                  >
                    {assets.map((a) => (
                      <option key={a.asset_id} value={a.asset_id}>
                        Machine {a.asset_id.replace(/asset_?/i, '')} ({a.line.replace('line', 'Line ')})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <VibrationSpectrumAnalyzer
                rpm={selectedAsset?.latest_telemetry?.rotational_speed ?? 1750}
                vibrationG={selectedAsset?.latest_telemetry ? ((selectedAsset.latest_telemetry.torque ?? 30) / 40) : 0.8}
              />
            </div>
          </ErrorBoundary>
        )}

        {/* ── Page 5: Load Test (Fleet Stress & Fault Injection) ── */}
        {currentPage === 'simulator' && (
          <ErrorBoundary fallbackTitle="Load Test Simulator Unavailable">
            <div key={pageKey} className="w-full animate-page-in">
              <SimulationDashboard assets={assets} onNotification={showToast} defaultViewMode="fleet" />
            </div>
          </ErrorBoundary>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 text-center text-xs text-slate-400 w-full">
        <div className="w-full px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-slate-500">
            AI-Powered Industrial Maintenance Platform &bull; Real-time machine health monitoring
          </p>
          <button
            onClick={() => setIsDisclaimerOpen(true)}
            className="text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-2"
          >
            About &amp; Methodology
          </button>
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

import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  Filter,
  Info,
  Layers,
  ShieldAlert,
} from 'lucide-react';
import { EdgeAlert } from '../types';

interface AlertsTableProps {
  alerts: EdgeAlert[];
  selectedAssetId: string | null;
  onSelectAsset?: (assetId: string) => void;
}

export const AlertsTable: React.FC<AlertsTableProps> = ({ alerts, selectedAssetId, onSelectAsset }) => {
  const [filterAsset, setFilterAsset] = useState<boolean>(false);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Filter alerts
  const filteredAlerts = alerts.filter((alert) => {
    if (filterAsset && selectedAssetId && alert.asset_id !== selectedAssetId) {
      return false;
    }
    if (severityFilter !== 'all' && alert.severity !== severityFilter) {
      return false;
    }
    if (typeFilter !== 'all' && alert.alert_type !== typeFilter) {
      return false;
    }
    return true;
  });

  const severityBadge = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/80 text-rose-300 border border-rose-800">
            <AlertTriangle className="w-3 h-3 text-rose-400" />
            CRITICAL
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800">
            <AlertCircle className="w-3 h-3 text-amber-400" />
            WARNING
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-950/80 text-blue-300 border border-blue-800">
            <Info className="w-3 h-3 text-blue-400" />
            INFO
          </span>
        );
    }
  };

  const alertTypeBadge = (type: string) => {
    if (type === 'DATA_GAP_DETECTED' || type === 'SEQUENCE_GAP') {
      return (
        <span className="px-1.5 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800 font-mono text-[10px]">
          SEQUENCE GAP
        </span>
      );
    }
    if (type === 'SENSOR_THRESHOLD_ANOMALY') {
      return (
        <span className="px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800 font-mono text-[10px]">
          DEMO THRESHOLD
        </span>
      );
    }
    if (type === 'MALFORMED_TELEMETRY') {
      return (
        <span className="px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800 font-mono text-[10px]">
          MALFORMED DATA
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono text-[10px]">
        {type}
      </span>
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
      {/* Table Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              Recent Edge Diagnostics & Sequence Gaps
            </h3>
            <p className="text-[11px] text-slate-400">
              Live anomaly alerts, parameter violations, and communication dropouts
            </p>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Toggle filter to current asset */}
          {selectedAssetId && (
            <button
              onClick={() => setFilterAsset(!filterAsset)}
              className={`px-2.5 py-1 rounded-md border font-medium transition-colors ${
                filterAsset
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              {filterAsset ? `Only ${selectedAssetId}` : `Filter by ${selectedAssetId}`}
            </button>
          )}

          {/* Severity selector */}
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-300 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="WARNING">Warning</option>
            <option value="INFO">Info</option>
          </select>

          {/* Alert Type selector */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-300 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Alert Types</option>
            <option value="SENSOR_THRESHOLD_ANOMALY">Threshold Anomalies</option>
            <option value="DATA_GAP_DETECTED">Sequence Gaps</option>
            <option value="MALFORMED_TELEMETRY">Malformed Telemetry</option>
          </select>
        </div>
      </div>

      {/* Table Content */}
      {filteredAlerts.length === 0 ? (
        <div className="py-10 text-center text-slate-400">
          <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-xs font-semibold text-slate-300">No Diagnostic Alerts Recorded</p>
          <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
            All monitored sensor parameters are within demonstration limits and sequence
            continuity is unbroken.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Asset</th>
                <th className="py-2.5 px-3">Severity</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Message</th>
                <th className="py-2.5 px-3">Diagnostics</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {filteredAlerts.slice(0, 25).map((alert, idx) => (
                <tr
                  key={alert.id ?? idx}
                  className="hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                    {alert.timestamp
                      ? new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                      : '—'}
                  </td>
                  <td className="py-2 px-3">
                    <button
                      onClick={() => onSelectAsset && onSelectAsset(alert.asset_id)}
                      className="text-blue-400 hover:underline font-semibold"
                    >
                      {alert.asset_id}
                    </button>
                    {alert.line && <span className="text-slate-400 text-[10px] ml-1 font-sans">({alert.line})</span>}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">{severityBadge(alert.severity)}</td>
                  <td className="py-2 px-3 whitespace-nowrap">{alertTypeBadge(alert.alert_type)}</td>
                  <td className="py-2 px-3 text-slate-300 font-sans">{alert.message}</td>
                  <td className="py-2 px-3 text-slate-400 text-[10px] max-w-xs truncate">
                    {alert.details ? JSON.stringify(alert.details) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

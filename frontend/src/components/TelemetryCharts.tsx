import React, { useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  Eye,
  EyeOff,
  Flame,
  Gauge,
  Layers,
  Thermometer,
  Wrench,
  Zap,
} from 'lucide-react';
import { Asset, TelemetryRecord } from '../types';

interface TelemetryChartsProps {
  asset: Asset;
  telemetry: TelemetryRecord[];
  isLoading: boolean;
}

export const TelemetryCharts: React.FC<TelemetryChartsProps> = ({ asset, telemetry, isLoading }) => {
  const [showSmoothed, setShowSmoothed] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'all' | 'thermal' | 'mechanical' | 'wear'>('all');

  // Format data in ascending chronological order for chart plotting
  const chartData = [...telemetry]
    .sort((a, b) => a.sequence_number - b.sequence_number)
    .map((record) => {
      const edge = record.edge;
      return {
        sequence: record.sequence_number,
        timestamp: record.timestamp
          ? new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : `#${record.sequence_number}`,
        // Raw features (preserved as emitted)
        air_temp: record.air_temperature,
        proc_temp: record.process_temperature,
        speed: record.rotational_speed,
        torque: record.torque,
        wear: record.tool_wear,
        // Edge-smoothed features (moving average W=5)
        smoothed_air_temp: edge?.smoothed_air_temperature ?? null,
        smoothed_proc_temp: edge?.smoothed_process_temperature ?? null,
        smoothed_speed: edge?.smoothed_rotational_speed ?? null,
        smoothed_torque: edge?.smoothed_torque ?? null,
        smoothed_wear: edge?.smoothed_tool_wear ?? null,
      };
    });

  if (chartData.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
        <Activity className="w-8 h-8 text-blue-400 mx-auto mb-2 animate-pulse" />
        <h3 className="text-sm font-semibold text-slate-200">
          Awaiting Telemetry Stream for {asset.asset_id}
        </h3>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
          No telemetry records currently recorded in TimescaleDB for this asset.
          Ensure the simulator and edge processor are actively publishing on MQTT.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
      {/* Chart Controls Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
              {asset.asset_id} Real-Time Sensor Telemetry
            </h3>
            <p className="text-[11px] text-slate-400">
              Showing latest {chartData.length} observations ({asset.line} • {asset.asset_type})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Chart view tabs */}
          <div className="flex items-center bg-slate-950 p-1 rounded-md border border-slate-800">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-2.5 py-1 rounded transition-colors font-medium ${
                activeTab === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Sensors
            </button>
            <button
              onClick={() => setActiveTab('thermal')}
              className={`px-2.5 py-1 rounded transition-colors font-medium flex items-center gap-1 ${
                activeTab === 'thermal' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Thermometer className="w-3 h-3 text-cyan-400" /> Thermal
            </button>
            <button
              onClick={() => setActiveTab('mechanical')}
              className={`px-2.5 py-1 rounded transition-colors font-medium flex items-center gap-1 ${
                activeTab === 'mechanical' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Gauge className="w-3 h-3 text-yellow-400" /> Mechanical
            </button>
            <button
              onClick={() => setActiveTab('wear')}
              className={`px-2.5 py-1 rounded transition-colors font-medium flex items-center gap-1 ${
                activeTab === 'wear' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wrench className="w-3 h-3 text-purple-400" /> Tool Wear
            </button>
          </div>

          {/* Toggle Edge Smoothed Values */}
          <button
            onClick={() => setShowSmoothed(!showSmoothed)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors ${
              showSmoothed
                ? 'bg-blue-950/60 border-blue-800 text-blue-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}
            title="Toggle separate edge rolling moving average (W=5)"
          >
            {showSmoothed ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>Smoothed Overlay (W=5)</span>
          </button>
        </div>
      </div>

      {/* Distinction Banner: Raw vs Smoothed */}
      <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5 flex flex-wrap items-center justify-between text-[11px] gap-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-cyan-400 inline-block"></span>
            <span className="font-semibold text-slate-300">Raw Sensor Values:</span>
            <span className="text-slate-400">Solid lines (fed to GRU predictor)</span>
          </div>
          {showSmoothed && (
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-t border-dashed border-cyan-300 inline-block"></span>
              <span className="font-semibold text-cyan-300">Edge Smoothed:</span>
              <span className="text-slate-400">Dashed lines (diagnostic visualization only)</span>
            </div>
          )}
        </div>
        <span className="text-slate-400 text-[10px]">
          X-Axis: Sequential Observations
        </span>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Chart 1: Thermal Dynamics (Air & Process Temperature) */}
        {(activeTab === 'all' || activeTab === 'thermal') && (
          <div className={`bg-slate-950 border border-slate-800 rounded-lg p-3 ${activeTab === 'thermal' ? 'lg:col-span-2' : ''}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5 text-cyan-400" />
                Thermal Dynamics (Air vs Process Temperature)
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Kelvin [K]</span>
            </div>

            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="sequence" stroke="#64748b" tick={{ fontSize: 10 }} />
                  <YAxis domain={['auto', 'auto']} stroke="#64748b" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: '11px' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />

                  {/* Raw Lines (Solid) */}
                  <Line
                    type="monotone"
                    dataKey="air_temp"
                    name="Air Temp [Raw]"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="proc_temp"
                    name="Process Temp [Raw]"
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={false}
                  />

                  {/* Edge Smoothed Lines (Dashed) */}
                  {showSmoothed && (
                    <>
                      <Line
                        type="monotone"
                        dataKey="smoothed_air_temp"
                        name="Air Temp [Smoothed]"
                        stroke="#7dd3fc"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="smoothed_proc_temp"
                        name="Process Temp [Smoothed]"
                        stroke="#fdba74"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Chart 2: Mechanical Power (Speed & Torque Dual Axis) */}
        {(activeTab === 'all' || activeTab === 'mechanical') && (
          <div className={`bg-slate-950 border border-slate-800 rounded-lg p-3 ${activeTab === 'mechanical' ? 'lg:col-span-2' : ''}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-yellow-400" />
                Mechanical Dynamics (Rotational Speed & Torque)
              </span>
              <span className="text-[10px] text-slate-400 font-mono">rpm & Nm</span>
            </div>

            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="sequence" stroke="#64748b" tick={{ fontSize: 10 }} />
                  {/* Left Axis: Speed (rpm) */}
                  <YAxis yAxisId="speed" domain={['auto', 'auto']} stroke="#eab308" tick={{ fontSize: 10 }} />
                  {/* Right Axis: Torque (Nm) */}
                  <YAxis
                    yAxisId="torque"
                    orientation="right"
                    domain={[0, 85]}
                    stroke="#06b6d4"
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: '11px' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />

                  {/* Demonstration Threshold Line for Torque */}
                  <ReferenceLine yAxisId="torque" y={80} stroke="#f43f5e" strokeDasharray="3 3" label={{ value: 'Demo Max Torque (80Nm)', fill: '#f43f5e', fontSize: 9 }} />

                  {/* Raw Lines */}
                  <Line
                    yAxisId="speed"
                    type="monotone"
                    dataKey="speed"
                    name="Speed [Raw rpm]"
                    stroke="#eab308"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="torque"
                    type="monotone"
                    dataKey="torque"
                    name="Torque [Raw Nm]"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    dot={false}
                  />

                  {/* Edge Smoothed Lines */}
                  {showSmoothed && (
                    <>
                      <Line
                        yAxisId="speed"
                        type="monotone"
                        dataKey="smoothed_speed"
                        name="Speed [Smoothed]"
                        stroke="#fde047"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                      <Line
                        yAxisId="torque"
                        type="monotone"
                        dataKey="smoothed_torque"
                        name="Torque [Smoothed]"
                        stroke="#67e8f9"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Chart 3: Tool Wear Progression */}
        {(activeTab === 'all' || activeTab === 'wear') && (
          <div className={`bg-slate-950 border border-slate-800 rounded-lg p-3 ${activeTab === 'wear' ? 'lg:col-span-2' : ''}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5 text-purple-400" />
                Component Wear Progression (Cumulative Tool Machining Duration)
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Minutes [min]</span>
            </div>

            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="sequence" stroke="#64748b" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 260]} stroke="#c084fc" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: '11px' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />

                  {/* Demonstration Threshold Line */}
                  <ReferenceLine y={240} stroke="#f43f5e" strokeDasharray="3 3" label={{ value: 'High Tool Wear Threshold (240 min)', fill: '#f43f5e', fontSize: 9 }} />

                  {/* Tool Wear Line */}
                  <Line
                    type="monotone"
                    dataKey="wear"
                    name="Tool Wear [Raw min]"
                    stroke="#a855f7"
                    strokeWidth={2}
                    dot={false}
                  />
                  {showSmoothed && (
                    <Line
                      type="monotone"
                      dataKey="smoothed_wear"
                      name="Tool Wear [Smoothed]"
                      stroke="#d8b4fe"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

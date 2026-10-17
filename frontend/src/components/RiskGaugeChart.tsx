import React from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Info,
  Layers,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { Asset, Prediction } from '../types';

interface RiskGaugeChartProps {
  asset: Asset;
  predictions: Prediction[];
  isLoading: boolean;
}

export const RiskGaugeChart: React.FC<RiskGaugeChartProps> = ({ asset, predictions, isLoading }) => {
  const latestPred = asset.latest_prediction || (predictions.length > 0 ? predictions[0] : null);
  const failureProb = latestPred ? latestPred.failure_probability : null;
  const isElevated = failureProb !== null && failureProb >= 0.55;

  const buffer = asset.buffer_status;
  const accumulated = buffer ? buffer.accumulated_observations : 0;
  const required = buffer ? buffer.required_window_size : 30;
  const isBufferReady = buffer ? buffer.is_ready : false;

  // Format historical predictions in chronological order
  const chartData = [...predictions]
    .sort((a, b) => {
      const tA = new Date(a.prediction_timestamp).getTime();
      const tB = new Date(b.prediction_timestamp).getTime();
      return tA - tB;
    })
    .map((p, idx) => ({
      index: idx + 1,
      time: p.prediction_timestamp
        ? new Date(p.prediction_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : `#${idx + 1}`,
      probability: p.failure_probability,
      threshold: p.threshold ?? 0.55,
      isElevated: p.failure_probability >= 0.55,
    }));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-purple-500/10 border border-purple-500/30 text-purple-400">
            <BrainCircuit className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
              {asset.asset_id} Frozen GRU Failure-Risk Progression
            </h3>
            <p className="text-[11px] text-slate-400">
              Evaluated on 30-step sliding window (Δt = 10 lookahead horizon • Decision Threshold τ = 0.55)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 font-mono text-slate-300">
            Model: 2-Layer GRU (Frozen)
          </span>
        </div>
      </div>

      {/* KPI Cards: Current Score, Buffer Progress, Classification */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 1. Latest Estimated Risk Score */}
        <div
          className={`border rounded-lg p-3.5 flex items-center justify-between transition-colors ${
            isElevated
              ? 'bg-rose-950/40 border-rose-800/80'
              : failureProb !== null
              ? 'bg-emerald-950/30 border-emerald-800/80'
              : 'bg-slate-950/60 border-slate-800'
          }`}
        >
          <div>
            <span className="text-xs text-slate-400 font-medium block">
              Estimated Failure Risk
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className={`text-2xl font-bold font-mono ${
                  isElevated
                    ? 'text-rose-400 animate-pulse'
                    : failureProb !== null
                    ? 'text-emerald-400'
                    : 'text-slate-400'
                }`}
              >
                {failureProb !== null ? `${(failureProb * 100).toFixed(2)}%` : '—'}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {failureProb !== null ? `(raw: ${failureProb.toFixed(4)})` : ''}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              Target: Failure within next 10 observations
            </span>
          </div>

          <div
            className={`p-2.5 rounded-lg border ${
              isElevated
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                : failureProb !== null
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            {isElevated ? <ShieldAlert className="w-6 h-6" /> : <ShieldCheck className="w-6 h-6" />}
          </div>
        </div>

        {/* 2. Threshold Classification */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Decision Status:</span>
              <span className="text-slate-400 font-mono">Threshold: 0.55</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {isElevated ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-900/60 text-rose-300 border border-rose-700 text-xs font-bold">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  ELEVATED FAILURE WARNING
                </span>
              ) : failureProb !== null ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800 text-xs font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  NORMAL OPERATIONAL BENCHMARK
                </span>
              ) : (
                <span className="text-xs text-slate-400 italic">
                  Accumulating initial 30 observations...
                </span>
              )}
            </div>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            Decision: {failureProb !== null ? (isElevated ? 'Label 1 (Above Threshold)' : 'Label 0 (Below Threshold)') : 'Awaiting Input Window'}
          </p>
        </div>

        {/* 3. Sequence Buffer Status */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-blue-400" /> Sequence Buffer
              </span>
              <span className="font-mono text-slate-300">
                {accumulated} / {required} obs
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-800 h-2 rounded-full mt-2 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  isBufferReady ? 'bg-emerald-500' : 'bg-blue-500'
                }`}
                style={{ width: `${Math.min(100, (accumulated / required) * 100)}%` }}
              ></div>
            </div>
          </div>

          <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1">
            <Clock className="w-3 h-3 text-slate-400" />
            {isBufferReady
              ? 'FIFO rolling window active (1-in, 1-out)'
              : 'Predictor withheld until exactly 30 contiguous readings'}
          </p>
        </div>
      </div>

      {/* Historical Failure Risk Chart */}
      <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <BrainCircuit className="w-3.5 h-3.5 text-purple-400" />
            Historical Failure Risk Trajectory (Probability vs Threshold)
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            {chartData.length} Evaluation Events
          </span>
        </div>

        {chartData.length > 0 ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 15, left: -15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis domain={[0.0, 1.0]} stroke="#64748b" tick={{ fontSize: 10 }} ticks={[0, 0.25, 0.5, 0.55, 0.75, 1.0]} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: '11px' }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(value: any) => [`${(Number(value) * 100).toFixed(2)}% (prob: ${Number(value).toFixed(4)})`, 'Failure Risk']}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />

                {/* Shaded Elevated Risk Area above 0.55 */}
                <ReferenceArea y1={0.55} y2={1.0} fill="#f43f5e" fillOpacity={0.07} />

                {/* 0.55 Decision Threshold Reference Line */}
                <ReferenceLine
                  y={0.55}
                  stroke="#f43f5e"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  label={{
                    value: 'Decision Threshold τ = 0.55',
                    fill: '#f43f5e',
                    fontSize: 10,
                    position: 'insideTopLeft',
                  }}
                />

                {/* Risk Progression Line */}
                <Line
                  type="monotone"
                  dataKey="probability"
                  name="GRU Failure Risk"
                  stroke="#a855f7"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#a855f7' }}
                  activeDot={{ r: 6, fill: '#c084fc' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-44 flex flex-col items-center justify-center text-center p-4">
            <Clock className="w-8 h-8 text-slate-400 mb-2 animate-spin" />
            <p className="text-xs font-medium text-slate-300">
              No Historical Predictions Recorded Yet
            </p>
            <p className="text-[11px] text-slate-400 max-w-sm mt-1">
              The live GRU model strictly requires 30 contiguous source observations before
              computing predictions. Predictions will display automatically once 30 readings accumulate.
            </p>
          </div>
        )}
      </div>

      {/* Mandatory Methodological Disclaimer Banner */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 flex items-start gap-2.5 text-xs text-slate-400">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-slate-300">
            Methodological Notice on Model Risk Estimation:
          </p>
          <p className="text-[11px] leading-relaxed">
            The displayed scores denote estimated failure risk for the next 10 synthetic observations
            based on the frozen 2-layer GRU checkpoint (<code className="text-purple-300">gru_model.pt</code>, threshold 0.55).
            These scores represent an experimental research benchmark evaluated on the AI4I 2020 synthetic
            trajectory formulation and <strong>are not calibrated or production-certified industrial safety ratings</strong>.
            Do not use as an autonomous trip mechanism.
          </p>
        </div>
      </div>
    </div>
  );
};

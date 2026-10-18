import React from 'react';
import { AlertTriangle, BookOpen, CheckCircle, Database, Layers, ShieldAlert, X } from 'lucide-react';

interface DisclaimerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DisclaimerModal: React.FC<DisclaimerModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="glass-panel border border-white/10 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 sticky top-0 bg-slate-900/90 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-bold text-white">
              System Architecture, Specifications &amp; Methodological Bounds
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 text-xs leading-relaxed">
          {/* Section 1: Synthetic Timeline Semantics */}
          <div className="glass-cell p-3.5 space-y-2">
            <h3 className="font-bold text-sm text-cyan-300 flex items-center gap-1.5">
              <Layers className="w-4 h-4" /> 1. Synthetic Timeline Semantics (AI4I 2020)
            </h3>
            <p className="text-slate-300">
              The dataset contains 10,000 ordered observations partitioned into <strong>20 synthetic industrial machines</strong> (500 non-overlapping rows each: <code className="text-slate-200">Machine 01</code>: 0–499, ..., <code className="text-slate-200">Machine 20</code>: 9500–9999).
            </p>
            <p className="text-slate-400 text-[11px]">
              Each 500-row slice represents an assigned synthetic trajectory. Factory line (<code className="text-slate-300">Line A..Line D</code>), equipment type (<code className="text-slate-300">motor, pump, compressor, spindle_drive</code>), and cell location are simulated metadata.
            </p>
          </div>

          {/* Section 2: Frozen ML Inference Contract */}
          <div className="glass-cell p-3.5 space-y-2">
            <h3 className="font-bold text-sm text-purple-300 flex items-center gap-1.5">
              <Database className="w-4 h-4" /> 2. Frozen ML Model Contract (Phase 3 &amp; 6)
            </h3>
            <p className="text-slate-300">
              Inference is powered by a strictly <strong>frozen 2-layer GRU classifier</strong> (<code className="text-purple-300">gru_model.pt</code>) with hidden size 64 and dropout 0.2:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-300">
              <li>
                <strong>Raw 5 Features Only:</strong> Air temperature [K], Process temperature [K], Rotational speed [rpm], Torque [Nm], Tool wear [min].
              </li>
              <li>
                <strong>Temporal Window:</strong> 30 consecutive observations (window shape 30 × 5).
              </li>
              <li>
                <strong>Prediction Horizon:</strong> 10 future synthetic observations ($t+1 \dots t+10$).
              </li>
              <li>
                <strong>Decision Threshold:</strong> Fixed at $\tau = 0.55$.
              </li>
              <li>
                <strong>Scaler:</strong> Training-fit <code className="text-slate-200">scaler.pkl</code> applied to each 30-observation window.
              </li>
            </ul>
          </div>

          {/* Section 3: Sequence Integrity & Buffer Reset */}
          <div className="glass-cell p-3.5 space-y-2">
            <h3 className="font-bold text-sm text-amber-300 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" /> 3. Strict Sequence Integrity Invariant
            </h3>
            <p className="text-slate-300">
              The GRU predictor strictly requires <strong>30 contiguous source observations</strong> before computing predictions:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-300">
              <li>Observations 1..29 return not-ready state (predictive buffering).</li>
              <li>When a sequence gap occurs (due to network dropouts or packet loss), the buffer is <strong>immediately reset to 1</strong> to prevent cross-gap prediction.</li>
              <li>No synthetic, interpolated, or smoothed observations are fabricated across gaps.</li>
            </ul>
          </div>

          {/* Section 4: Operational vs Certification Notice */}
          <div className="bg-rose-950/30 border border-rose-800/80 rounded-xl p-3.5 space-y-2 text-rose-200">
            <h3 className="font-bold text-sm text-rose-300 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-400" /> 4. Important Methodological Notice
            </h3>
            <p className="text-[11px] leading-relaxed">
              Model scores denote estimated failure risk for the next 10 synthetic observations based on research benchmarks. <strong>These scores are not calibrated or production-certified industrial safety ratings</strong>. They must not be deployed as an autonomous safety trip or shutdown trigger in mission-critical hardware environments.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex justify-end bg-slate-900/90 backdrop-blur-md sticky bottom-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors shadow-md shadow-blue-950/50"
          >
            Acknowledge &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
};

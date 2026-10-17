/**
 * Data contracts and TypeScript interfaces for Phase 7 Industrial Monitoring Dashboard.
 * Accurately aligns with Phase 6 Backend API and WebSocket event payloads.
 */

export type AssetType = 'motor' | 'pump' | 'compressor' | 'spindle_drive' | string;
export type AssetLine = 'lineA' | 'lineB' | 'lineC' | 'lineD' | string;
export type AssetStatusType = 'ONLINE' | 'DISCONNECTED' | 'RECONNECTING' | 'EXHAUSTED' | 'EMERGENCY_STOP' | 'UNKNOWN';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface EdgeTelemetryMeta {
  smoothed_air_temperature?: number | null;
  smoothed_process_temperature?: number | null;
  smoothed_rotational_speed?: number | null;
  smoothed_torque?: number | null;
  smoothed_tool_wear?: number | null;
  smoothing_window_size?: number | null;
  anomaly_flags?: string[];
  has_anomaly?: boolean;
  has_sequence_gap?: boolean;
  sequence_gaps?: {
    expected?: number;
    received?: number;
    missing_count?: number;
  } | null;
  processing_timestamp?: string | null;
}

export interface TelemetryRecord {
  timestamp: string;
  asset_id: string;
  line: string;
  sequence_number: number;
  air_temperature: number;
  process_temperature: number;
  rotational_speed: number;
  torque: number;
  tool_wear: number;
  edge?: EdgeTelemetryMeta | null;
}

export interface Prediction {
  id?: number;
  asset_id: string;
  prediction_timestamp: string;
  failure_probability: number; // e.g. 0.1850
  prediction: 0 | 1;
  threshold: number; // 0.55
  window_size: number; // 30
  prediction_horizon: number; // 10
  model_type: string; // "GRU"
  feature_set: string; // "raw"
  sequence_start_timestamp?: string | null;
  sequence_end_timestamp?: string | null;
}

export interface BufferStatus {
  asset_id: string;
  accumulated_observations: number;
  required_window_size: number;
  is_ready: boolean;
  last_sequence_number: number | null;
}

export interface Asset {
  asset_id: string;
  asset_type: AssetType;
  line: AssetLine;
  location: string;
  firmware_version: string;
  status: AssetStatusType;
  last_seen_timestamp: string | null;
  reason: string | null;
  latest_prediction: Prediction | null;
  buffer_status: BufferStatus | null;
  latest_telemetry?: TelemetryRecord | null;
}

export interface EdgeAlert {
  id?: number;
  asset_id: string;
  line?: string;
  timestamp: string;
  alert_type: string;
  severity: AlertSeverity;
  message: string;
  details?: Record<string, any>;
  source?: string;
  created_at?: string;
}

export interface SensorStats {
  mean: number;
  min: number;
  max: number;
  std?: number;
}

export interface TelemetrySummary {
  id?: number;
  asset_id: string;
  line: string;
  interval_start_timestamp: string;
  interval_end_timestamp: string;
  observation_count: number;
  sensor_statistics: Record<string, SensorStats>;
  anomaly_count: number;
  gap_count: number;
  is_partial: boolean;
  created_at?: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded';
  timestamp: string;
  database: string;
  model: {
    model_type: string;
    checkpoint: string;
    scaler: string;
    threshold: number;
    window_size: number;
    prediction_horizon: number;
    features: string[];
    status: string;
  };
}

export type LiveEventType = 'telemetry' | 'prediction' | 'alert' | 'status' | 'summary' | 'work_order' | 'operator_action';

export interface LiveEvent<T = any> {
  type: LiveEventType;
  data: T;
  timestamp: string;
}

export interface WhatIfSimulationParams {
  air_temperature: number;
  process_temperature: number;
  rotational_speed: number;
  torque: number;
  tool_wear: number;
  asset_id?: string;
  simulation_mode?: 'steady_state' | 'next_step';
}

export interface WhatIfSimulationResult {
  failure_probability: number;
  prediction: 0 | 1;
  threshold: number;
  risk_level: 'NORMAL' | 'ELEVATED' | 'CRITICAL';
  is_alert: boolean;
  power_watts: number;
  temp_diff_k: number;
  insights: string[];
  inputs: WhatIfSimulationParams;
}

export interface WorkOrder {
  work_order_id: string;
  asset_id: string;
  line?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'DISPATCHED' | 'IN_PROGRESS' | 'COMPLETED';
  technician_assigned: string;
  task_description: string;
  created_at: string;
}

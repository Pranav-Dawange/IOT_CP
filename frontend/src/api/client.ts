/**
 * REST API Client for Industrial IoT Backend (Phase 6 & 7).
 * Communicates with FastAPI backend using typed endpoints.
 */

import {
  Asset,
  EdgeAlert,
  Prediction,
  SystemHealth,
  TelemetryRecord,
  TelemetrySummary,
} from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

async function fetchJson<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`API Error ${response.status} (${response.statusText}): ${errorBody || url}`);
  }

  return response.json();
}

export const apiClient = {
  /**
   * System health check and model parameters
   */
  async getHealth(): Promise<SystemHealth> {
    return fetchJson<SystemHealth>('/health');
  },

  /**
   * Retrieve all 20 assets with latest status and latest prediction
   */
  async getAssets(): Promise<Asset[]> {
    return fetchJson<Asset[]>('/assets');
  },

  /**
   * Retrieve detailed status for a single asset
   */
  async getAssetDetail(assetId: string): Promise<Asset> {
    return fetchJson<Asset>(`/assets/${encodeURIComponent(assetId)}`);
  },

  /**
   * Query time-series telemetry history for an asset (limit 1..1000)
   */
  async getAssetTelemetry(assetId: string, limit = 50): Promise<TelemetryRecord[]> {
    return fetchJson<TelemetryRecord[]>(
      `/assets/${encodeURIComponent(assetId)}/telemetry?limit=${limit}`
    );
  },

  /**
   * Query periodic aggregation summaries for an asset
   */
  async getAssetSummaries(assetId: string, limit = 20): Promise<TelemetrySummary[]> {
    return fetchJson<TelemetrySummary[]>(
      `/assets/${encodeURIComponent(assetId)}/summaries?limit=${limit}`
    );
  },

  /**
   * Query historical predictions for an asset
   */
  async getAssetPredictions(assetId: string, limit = 50): Promise<Prediction[]> {
    return fetchJson<Prediction[]>(
      `/assets/${encodeURIComponent(assetId)}/predictions?limit=${limit}`
    );
  },

  /**
   * Query latest predictions across all assets
   */
  async getLatestPredictions(limit = 20): Promise<Prediction[]> {
    return fetchJson<Prediction[]>(`/predictions/latest?limit=${limit}`);
  },

  /**
   * Query edge alerts with optional filters
   */
  async getAlerts(params?: {
    assetId?: string;
    alertType?: string;
    severity?: string;
    limit?: number;
  }): Promise<EdgeAlert[]> {
    const query = new URLSearchParams();
    if (params?.assetId) query.set('asset_id', params.assetId);
    if (params?.alertType) query.set('alert_type', params.alertType);
    if (params?.severity) query.set('severity', params.severity);
    query.set('limit', String(params?.limit || 50));

    return fetchJson<EdgeAlert[]>(`/alerts?${query.toString()}`);
  },

  /**
   * Run interactive 'What-If' digital twin GRU inference
   */
  async simulatePrediction(params: import('../types').WhatIfSimulationParams): Promise<import('../types').WhatIfSimulationResult> {
    return fetchJson<import('../types').WhatIfSimulationResult>('/predictions/simulate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /**
   * Execute operator action or inject live test fault
   */
  async executeAssetAction(
    assetId: string,
    action: string,
    notes?: string,
    faultType?: string
  ): Promise<any> {
    return fetchJson<any>(`/assets/${encodeURIComponent(assetId)}/action`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        notes,
        fault_type: faultType,
      }),
    });
  },

  /**
   * Retrieve generated maintenance work orders
   */
  async getWorkOrders(assetId?: string): Promise<import('../types').WorkOrder[]> {
    const query = assetId ? `?asset_id=${encodeURIComponent(assetId)}` : '';
    return fetchJson<import('../types').WorkOrder[]>(`/work-orders${query}`);
  },
};

-- ==============================================================================
-- TimescaleDB Database Initialization Script for Industrial IoT Backend
-- ==============================================================================
-- CRITICAL SECURITY & INTEGRITY CONTRACT:
-- Zero ground-truth failure labels (Machine failure, TWF, HDF, PWF, OSF, RNF) or
-- serial IDs (UDI, Product ID, Type) are stored in this database.
-- ==============================================================================

-- 1. Enable TimescaleDB Extension if available
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- 2. Raw and Enriched Sensor Telemetry Table
CREATE TABLE IF NOT EXISTS sensor_telemetry (
    timestamp TIMESTAMPTZ NOT NULL,
    asset_id VARCHAR(64) NOT NULL,
    sequence_number BIGINT NOT NULL,
    line VARCHAR(32) NOT NULL,

    -- Five Raw Sensor Features (STRICTLY PRESERVED AS EMITTED)
    air_temperature DOUBLE PRECISION NOT NULL,
    process_temperature DOUBLE PRECISION NOT NULL,
    rotational_speed DOUBLE PRECISION NOT NULL,
    torque DOUBLE PRECISION NOT NULL,
    tool_wear DOUBLE PRECISION NOT NULL,

    -- Edge Smoothed Features
    smoothed_air_temperature DOUBLE PRECISION,
    smoothed_process_temperature DOUBLE PRECISION,
    smoothed_rotational_speed DOUBLE PRECISION,
    smoothed_torque DOUBLE PRECISION,
    smoothed_tool_wear DOUBLE PRECISION,
    smoothing_window_size INTEGER,

    -- Edge Diagnostics
    anomaly_flags JSONB DEFAULT '[]'::jsonb,
    has_anomaly BOOLEAN DEFAULT FALSE NOT NULL,
    has_sequence_gap BOOLEAN DEFAULT FALSE NOT NULL,
    edge_processing_timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT pk_sensor_telemetry PRIMARY KEY (timestamp, asset_id, sequence_number)
);

-- Convert to TimescaleDB Hypertable partitioned on timestamp
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM create_hypertable('sensor_telemetry', 'timestamp', if_not_exists => TRUE);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_telemetry_asset_time ON sensor_telemetry (asset_id, timestamp DESC);

-- 3. Telemetry Summaries Table
CREATE TABLE IF NOT EXISTS telemetry_summaries (
    id SERIAL PRIMARY KEY,
    asset_id VARCHAR(64) NOT NULL,
    line VARCHAR(32) NOT NULL,
    interval_start_timestamp TIMESTAMPTZ NOT NULL,
    interval_end_timestamp TIMESTAMPTZ NOT NULL,
    observation_count INTEGER NOT NULL,
    sensor_statistics JSONB NOT NULL,
    anomaly_count INTEGER DEFAULT 0 NOT NULL,
    gap_count INTEGER DEFAULT 0 NOT NULL,
    is_partial BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_summary_asset_end_time ON telemetry_summaries (asset_id, interval_end_timestamp DESC);

-- 4. Asset Status Table
CREATE TABLE IF NOT EXISTS asset_status (
    asset_id VARCHAR(64) PRIMARY KEY,
    line VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    last_seen_timestamp TIMESTAMPTZ NOT NULL,
    sequence_number BIGINT,
    source_row_index INTEGER,
    reason VARCHAR(128),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 5. Edge Alerts Table
CREATE TABLE IF NOT EXISTS edge_alerts (
    id SERIAL PRIMARY KEY,
    asset_id VARCHAR(64) NOT NULL,
    line VARCHAR(32) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    alert_type VARCHAR(64) NOT NULL,
    severity VARCHAR(16) NOT NULL,
    message TEXT NOT NULL,
    details JSONB,
    source VARCHAR(32) DEFAULT 'edge' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_alerts_asset_time ON edge_alerts (asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS ix_alerts_type_time ON edge_alerts (alert_type, timestamp DESC);

-- 6. Live ML Failure Predictions Table
CREATE TABLE IF NOT EXISTS predictions (
    id SERIAL PRIMARY KEY,
    asset_id VARCHAR(64) NOT NULL,
    prediction_timestamp TIMESTAMPTZ NOT NULL,
    failure_probability DOUBLE PRECISION NOT NULL,
    prediction INTEGER NOT NULL,
    threshold DOUBLE PRECISION DEFAULT 0.55 NOT NULL,
    window_size INTEGER DEFAULT 30 NOT NULL,
    prediction_horizon INTEGER DEFAULT 10 NOT NULL,
    model_type VARCHAR(32) DEFAULT 'GRU' NOT NULL,
    feature_set VARCHAR(32) DEFAULT 'raw' NOT NULL,
    sequence_start_timestamp TIMESTAMPTZ,
    sequence_end_timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_predictions_asset_time ON predictions (asset_id, prediction_timestamp DESC);

"""
SQLAlchemy Database Models for TimescaleDB and Relational Storage (Phase 6).

Strictly enforces:
1. Preservation of original raw 5-feature sensor readings.
2. Separate storage for smoothed edge values and diagnostic flags.
3. Structured storage for predictions, summaries, alerts, and asset statuses.
4. Zero ground-truth leakage columns (Machine failure, TWF, etc.).
5. Compatibility with TimescaleDB hypertables and standard relational SQL databases.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    JSON,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base

Base = declarative_base()


def utc_now() -> datetime:
    """Return current UTC datetime with timezone awareness."""
    return datetime.now(timezone.utc)


class TelemetryModel(Base):
    """
    Time-series table for raw and edge-enriched telemetry.
    Compatible with TimescaleDB hypertable partitioned on 'timestamp'.
    """
    __tablename__ = "sensor_telemetry"

    # Composite primary key compatible with TimescaleDB hypertable
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    asset_id = Column(String(64), nullable=False, index=True)
    sequence_number = Column(BigInteger, nullable=False)

    line = Column(String(32), nullable=False)

    # 5 Raw Sensor Features (STRICTLY PRESERVED AS EMITTED)
    air_temperature = Column(Float, nullable=False)
    process_temperature = Column(Float, nullable=False)
    rotational_speed = Column(Float, nullable=False)
    torque = Column(Float, nullable=False)
    tool_wear = Column(Float, nullable=False)

    # Separate Edge Smoothed Features
    smoothed_air_temperature = Column(Float, nullable=True)
    smoothed_process_temperature = Column(Float, nullable=True)
    smoothed_rotational_speed = Column(Float, nullable=True)
    smoothed_torque = Column(Float, nullable=True)
    smoothed_tool_wear = Column(Float, nullable=True)
    smoothing_window_size = Column(Integer, nullable=True)

    # Edge Diagnostics & Metadata
    anomaly_flags = Column(JSON, nullable=True)
    has_anomaly = Column(Boolean, default=False, nullable=False)
    has_sequence_gap = Column(Boolean, default=False, nullable=False)
    edge_processing_timestamp = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        PrimaryKeyConstraint("timestamp", "asset_id", "sequence_number", name="pk_sensor_telemetry"),
        Index("ix_telemetry_asset_time", "asset_id", "timestamp"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "asset_id": self.asset_id,
            "line": self.line,
            "sequence_number": self.sequence_number,
            "air_temperature": self.air_temperature,
            "process_temperature": self.process_temperature,
            "rotational_speed": self.rotational_speed,
            "torque": self.torque,
            "tool_wear": self.tool_wear,
            "edge": {
                "smoothed_air_temperature": self.smoothed_air_temperature,
                "smoothed_process_temperature": self.smoothed_process_temperature,
                "smoothed_rotational_speed": self.smoothed_rotational_speed,
                "smoothed_torque": self.smoothed_torque,
                "smoothed_tool_wear": self.smoothed_tool_wear,
                "smoothing_window_size": self.smoothing_window_size,
                "anomaly_flags": self.anomaly_flags or [],
                "has_anomaly": self.has_anomaly,
                "has_sequence_gap": self.has_sequence_gap,
                "edge_processing_timestamp": (
                    self.edge_processing_timestamp.isoformat()
                    if self.edge_processing_timestamp else None
                ),
            },
        }


class SummaryModel(Base):
    """
    Time-series periodic aggregation summaries (e.g., 10-observation intervals).
    """
    __tablename__ = "telemetry_summaries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    asset_id = Column(String(64), nullable=False, index=True)
    line = Column(String(32), nullable=False)
    interval_start_timestamp = Column(DateTime(timezone=True), nullable=False)
    interval_end_timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    observation_count = Column(Integer, nullable=False)
    sensor_statistics = Column(JSON, nullable=False)
    anomaly_count = Column(Integer, default=0, nullable=False)
    gap_count = Column(Integer, default=0, nullable=False)
    is_partial = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_summary_asset_end_time", "asset_id", "interval_end_timestamp"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "asset_id": self.asset_id,
            "line": self.line,
            "interval_start_timestamp": (
                self.interval_start_timestamp.isoformat() if self.interval_start_timestamp else None
            ),
            "interval_end_timestamp": (
                self.interval_end_timestamp.isoformat() if self.interval_end_timestamp else None
            ),
            "observation_count": self.observation_count,
            "sensor_statistics": self.sensor_statistics,
            "anomaly_count": self.anomaly_count,
            "gap_count": self.gap_count,
            "is_partial": self.is_partial,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AssetStatusModel(Base):
    """
    Current operational and connectivity status per asset.
    """
    __tablename__ = "asset_status"

    asset_id = Column(String(64), primary_key=True)
    line = Column(String(32), nullable=False)
    status = Column(String(32), nullable=False)
    last_seen_timestamp = Column(DateTime(timezone=True), nullable=False)
    sequence_number = Column(BigInteger, nullable=True)
    source_row_index = Column(Integer, nullable=True)
    reason = Column(String(128), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "asset_id": self.asset_id,
            "line": self.line,
            "status": self.status,
            "last_seen_timestamp": (
                self.last_seen_timestamp.isoformat() if self.last_seen_timestamp else None
            ),
            "sequence_number": self.sequence_number,
            "source_row_index": self.source_row_index,
            "reason": self.reason,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class EdgeAlertModel(Base):
    """
    Edge diagnostic alerts (sensor threshold anomalies, sequence gaps, etc.).
    """
    __tablename__ = "edge_alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    asset_id = Column(String(64), nullable=False, index=True)
    line = Column(String(32), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    alert_type = Column(String(64), nullable=False, index=True)
    severity = Column(String(16), nullable=False)
    message = Column(Text, nullable=False)
    details = Column(JSON, nullable=True)
    source = Column(String(32), default="edge", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_alerts_asset_time", "asset_id", "timestamp"),
        Index("ix_alerts_type_time", "alert_type", "timestamp"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "asset_id": self.asset_id,
            "line": self.line,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "alert_type": self.alert_type,
            "severity": self.severity,
            "message": self.message,
            "details": self.details or {},
            "source": self.source,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class PredictionModel(Base):
    """
    Live Machine Learning failure predictions from the Frozen GRU Model.
    """
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    asset_id = Column(String(64), nullable=False, index=True)
    prediction_timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    failure_probability = Column(Float, nullable=False)
    prediction = Column(Integer, nullable=False)  # 0 or 1
    threshold = Column(Float, nullable=False, default=0.55)
    window_size = Column(Integer, nullable=False, default=30)
    prediction_horizon = Column(Integer, nullable=False, default=10)
    model_type = Column(String(32), default="GRU", nullable=False)
    feature_set = Column(String(32), default="raw", nullable=False)
    sequence_start_timestamp = Column(DateTime(timezone=True), nullable=True)
    sequence_end_timestamp = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_predictions_asset_time", "asset_id", "prediction_timestamp"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "asset_id": self.asset_id,
            "prediction_timestamp": (
                self.prediction_timestamp.isoformat() if self.prediction_timestamp else None
            ),
            "failure_probability": round(float(self.failure_probability), 4),
            "prediction": int(self.prediction),
            "threshold": float(self.threshold),
            "window_size": int(self.window_size),
            "prediction_horizon": int(self.prediction_horizon),
            "model_type": self.model_type,
            "feature_set": self.feature_set,
            "sequence_start_timestamp": (
                self.sequence_start_timestamp.isoformat() if self.sequence_start_timestamp else None
            ),
            "sequence_end_timestamp": (
                self.sequence_end_timestamp.isoformat() if self.sequence_end_timestamp else None
            ),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

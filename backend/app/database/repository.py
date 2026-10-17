"""
Database Repository Layer for TimescaleDB and Relational Persistence (Phase 6).

Coordinates:
1. Idempotent insertion of raw and edge-enriched telemetry.
2. Saving periodic aggregation summaries.
3. Upserting asset connectivity and lifecycle status.
4. Saving edge diagnostic alerts.
5. Saving live GRU prediction events.
6. Optimized querying for REST API endpoints.
"""

from datetime import datetime, timezone
import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import desc, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.database.models import (
    AssetStatusModel,
    EdgeAlertModel,
    PredictionModel,
    SummaryModel,
    TelemetryModel,
    utc_now,
)

logger = logging.getLogger("backend.repository")


def parse_iso_datetime(dt_val: Any) -> datetime:
    """Parse string or timestamp into timezone-aware UTC datetime."""
    if isinstance(dt_val, datetime):
        if dt_val.tzinfo is None:
            return dt_val.replace(tzinfo=timezone.utc)
        return dt_val
    if isinstance(dt_val, str):
        # Handle trailing Z
        s = dt_val.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(s)
        except Exception:
            pass
    return utc_now()


class TelemetryRepository:
    """
    Data access layer for all time-series and relational tables.
    """

    @staticmethod
    def save_telemetry(db: Session, payload: Dict[str, Any], line: str) -> Optional[TelemetryModel]:
        """
        Persist a valid processed telemetry payload into sensor_telemetry.
        Handles duplicates idempotently.
        """
        try:
            ts = parse_iso_datetime(payload.get("timestamp"))
            aid = str(payload["asset_id"])
            seq = int(payload["sequence_number"])

            # Check if record already exists in database or session
            existing = db.query(TelemetryModel).filter(
                TelemetryModel.timestamp == ts,
                TelemetryModel.asset_id == aid,
                TelemetryModel.sequence_number == seq,
            ).first()
            if existing:
                return None

            edge_meta = payload.get("edge", {})
            edge_proc_ts = (
                parse_iso_datetime(edge_meta.get("processing_timestamp"))
                if edge_meta.get("processing_timestamp") else None
            )

            smoothed = edge_meta.get("smoothed_values", {})
            anomaly_flags = edge_meta.get("anomaly_flags", [])
            has_anomaly = len(anomaly_flags) > 0
            has_gap = edge_meta.get("sequence_gaps") is not None

            telemetry = TelemetryModel(
                timestamp=ts,
                asset_id=str(payload["asset_id"]),
                line=line,
                sequence_number=int(payload["sequence_number"]),
                air_temperature=float(payload["air_temperature"]),
                process_temperature=float(payload["process_temperature"]),
                rotational_speed=float(payload["rotational_speed"]),
                torque=float(payload["torque"]),
                tool_wear=float(payload["tool_wear"]),
                smoothed_air_temperature=smoothed.get("air_temperature"),
                smoothed_process_temperature=smoothed.get("process_temperature"),
                smoothed_rotational_speed=smoothed.get("rotational_speed"),
                smoothed_torque=smoothed.get("torque"),
                smoothed_tool_wear=smoothed.get("tool_wear"),
                smoothing_window_size=edge_meta.get("smoothing_window_size"),
                anomaly_flags=anomaly_flags,
                has_anomaly=has_anomaly,
                has_sequence_gap=has_gap,
                edge_processing_timestamp=edge_proc_ts,
            )

            db.add(telemetry)
            db.commit()
            db.refresh(telemetry)
            return telemetry

        except IntegrityError:
            db.rollback()
            logger.info(
                f"Duplicate telemetry skipped for asset '{payload.get('asset_id')}' "
                f"at seq #{payload.get('sequence_number')}."
            )
            return None
        except Exception as e:
            db.rollback()
            logger.error(f"Error persisting telemetry: {e}")
            raise

    @staticmethod
    def save_summary(db: Session, payload: Dict[str, Any]) -> SummaryModel:
        """Persist periodic aggregation summary."""
        try:
            summary = SummaryModel(
                asset_id=str(payload["asset_id"]),
                line=str(payload.get("line", "unknown")),
                interval_start_timestamp=parse_iso_datetime(payload["interval_start_timestamp"]),
                interval_end_timestamp=parse_iso_datetime(payload["interval_end_timestamp"]),
                observation_count=int(payload["observation_count"]),
                sensor_statistics=payload["sensor_statistics"],
                anomaly_count=int(payload.get("anomaly_count", 0)),
                gap_count=int(payload.get("gap_count", 0)),
                is_partial=bool(payload.get("is_partial", False)),
            )
            db.add(summary)
            db.commit()
            db.refresh(summary)
            return summary
        except Exception as e:
            db.rollback()
            logger.error(f"Error persisting summary: {e}")
            raise

    @staticmethod
    def upsert_asset_status(db: Session, payload: Dict[str, Any]) -> AssetStatusModel:
        """Upsert asset connectivity/lifecycle status."""
        asset_id = str(payload["asset_id"])
        line = str(payload.get("line", "unknown"))
        status_str = str(payload.get("status", "UNKNOWN"))
        ts = parse_iso_datetime(payload.get("timestamp"))
        seq = payload.get("sequence_number")
        row_idx = payload.get("source_row_index")
        reason = payload.get("reason")

        try:
            existing = db.query(AssetStatusModel).filter(AssetStatusModel.asset_id == asset_id).first()
            if existing:
                existing.line = line
                existing.status = status_str
                existing.last_seen_timestamp = ts
                if seq is not None:
                    existing.sequence_number = int(seq)
                if row_idx is not None:
                    existing.source_row_index = int(row_idx)
                if reason is not None:
                    existing.reason = str(reason)
                existing.updated_at = utc_now()
                db.commit()
                db.refresh(existing)
                return existing
            else:
                new_status = AssetStatusModel(
                    asset_id=asset_id,
                    line=line,
                    status=status_str,
                    last_seen_timestamp=ts,
                    sequence_number=int(seq) if seq is not None else None,
                    source_row_index=int(row_idx) if row_idx is not None else None,
                    reason=str(reason) if reason is not None else None,
                )
                db.add(new_status)
                db.commit()
                db.refresh(new_status)
                return new_status
        except Exception as e:
            db.rollback()
            logger.error(f"Error upserting status for asset '{asset_id}': {e}")
            raise

    @staticmethod
    def save_alert(db: Session, payload: Dict[str, Any]) -> EdgeAlertModel:
        """Persist edge diagnostic alert."""
        try:
            alert = EdgeAlertModel(
                asset_id=str(payload["asset_id"]),
                line=str(payload.get("line", "unknown")),
                timestamp=parse_iso_datetime(payload.get("timestamp")),
                alert_type=str(payload["alert_type"]),
                severity=str(payload.get("severity", "WARNING")),
                message=str(payload.get("message", "")),
                details=payload.get("details", {}),
                source=str(payload.get("source", "edge")),
            )
            db.add(alert)
            db.commit()
            db.refresh(alert)
            return alert
        except Exception as e:
            db.rollback()
            logger.error(f"Error persisting alert: {e}")
            raise

    @staticmethod
    def save_prediction(db: Session, payload: Dict[str, Any]) -> PredictionModel:
        """Persist live GRU failure prediction event."""
        try:
            prediction = PredictionModel(
                asset_id=str(payload["asset_id"]),
                prediction_timestamp=parse_iso_datetime(payload.get("timestamp") or payload.get("prediction_timestamp")),
                failure_probability=float(payload["failure_probability"]),
                prediction=int(payload["prediction"]),
                threshold=float(payload.get("threshold", 0.55)),
                window_size=int(payload.get("window_size", 30)),
                prediction_horizon=int(payload.get("prediction_horizon", 10)),
                model_type=str(payload.get("model_type", "GRU")),
                feature_set=str(payload.get("feature_set", "raw")),
                sequence_start_timestamp=(
                    parse_iso_datetime(payload["sequence_start_timestamp"])
                    if payload.get("sequence_start_timestamp") else None
                ),
                sequence_end_timestamp=(
                    parse_iso_datetime(payload["sequence_end_timestamp"])
                    if payload.get("sequence_end_timestamp") else None
                ),
            )
            db.add(prediction)
            db.commit()
            db.refresh(prediction)
            return prediction
        except Exception as e:
            db.rollback()
            logger.error(f"Error persisting prediction: {e}")
            raise

    # Query Methods
    @staticmethod
    def get_assets(db: Session) -> List[AssetStatusModel]:
        """List all tracked assets with latest status."""
        return db.query(AssetStatusModel).order_by(AssetStatusModel.asset_id.asc()).all()

    @staticmethod
    def get_asset_by_id(db: Session, asset_id: str) -> Optional[AssetStatusModel]:
        """Get status for a single asset."""
        return db.query(AssetStatusModel).filter(AssetStatusModel.asset_id == asset_id).first()

    @staticmethod
    def get_telemetry_history(
        db: Session,
        asset_id: str,
        limit: int = 50,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> List[TelemetryModel]:
        """Fetch telemetry history for an asset."""
        query = db.query(TelemetryModel).filter(TelemetryModel.asset_id == asset_id)
        if start_time:
            query = query.filter(TelemetryModel.timestamp >= start_time)
        if end_time:
            query = query.filter(TelemetryModel.timestamp <= end_time)
        return query.order_by(desc(TelemetryModel.timestamp)).limit(limit).all()

    @staticmethod
    def get_summaries_history(
        db: Session,
        asset_id: str,
        limit: int = 20,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> List[SummaryModel]:
        """Fetch periodic summaries for an asset."""
        query = db.query(SummaryModel).filter(SummaryModel.asset_id == asset_id)
        if start_time:
            query = query.filter(SummaryModel.interval_end_timestamp >= start_time)
        if end_time:
            query = query.filter(SummaryModel.interval_end_timestamp <= end_time)
        return query.order_by(desc(SummaryModel.interval_end_timestamp)).limit(limit).all()

    @staticmethod
    def get_predictions_history(
        db: Session,
        asset_id: str,
        limit: int = 50,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> List[PredictionModel]:
        """Fetch live prediction events for an asset."""
        query = db.query(PredictionModel).filter(PredictionModel.asset_id == asset_id)
        if start_time:
            query = query.filter(PredictionModel.prediction_timestamp >= start_time)
        if end_time:
            query = query.filter(PredictionModel.prediction_timestamp <= end_time)
        return query.order_by(desc(PredictionModel.prediction_timestamp)).limit(limit).all()

    @staticmethod
    def get_latest_predictions(db: Session, limit: int = 20) -> List[PredictionModel]:
        """Fetch latest predictions across all assets."""
        return db.query(PredictionModel).order_by(desc(PredictionModel.prediction_timestamp)).limit(limit).all()

    @staticmethod
    def get_alerts(
        db: Session,
        asset_id: Optional[str] = None,
        alert_type: Optional[str] = None,
        severity: Optional[str] = None,
        limit: int = 50,
    ) -> List[EdgeAlertModel]:
        """Fetch edge alerts with optional filters."""
        query = db.query(EdgeAlertModel)
        if asset_id:
            query = query.filter(EdgeAlertModel.asset_id == asset_id)
        if alert_type:
            query = query.filter(EdgeAlertModel.alert_type == alert_type)
        if severity:
            query = query.filter(EdgeAlertModel.severity == severity)
        return query.order_by(desc(EdgeAlertModel.timestamp)).limit(limit).all()

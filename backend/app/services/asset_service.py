"""
Asset Business Service (Phase 6).

Aggregates:
- Asset metadata from DeviceRegistry (line, asset_type, location, etc.)
- Latest connectivity & lifecycle status from the database
- Latest failure prediction results
- Buffer readiness state from PredictionService
"""

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from backend.app.database.repository import TelemetryRepository
from backend.app.services.prediction_service import PredictionService
from simulator.registry import DeviceRegistry

logger = logging.getLogger("backend.asset_service")


class AssetService:
    """
    Combines registry configuration with live database status and prediction state.
    """

    def __init__(self, prediction_service: Optional[PredictionService] = None):
        self.registry = DeviceRegistry()
        self.prediction_service = prediction_service

    def get_all_assets(self, db: Session) -> List[Dict[str, Any]]:
        """Return all 20 assets enriched with latest operational status and prediction."""
        all_configs = self.registry.get_all_assets()
        db_statuses = {s.asset_id: s for s in TelemetryRepository.get_assets(db)}
        latest_preds = {p.asset_id: p for p in TelemetryRepository.get_latest_predictions(db, limit=100)}

        results = []
        for cfg in all_configs:
            aid = cfg.asset_id
            status_model = db_statuses.get(aid)
            pred_model = latest_preds.get(aid)

            buffer_info = None
            if self.prediction_service:
                buffer_info = self.prediction_service.get_buffer_status(aid)

            results.append({
                "asset_id": aid,
                "asset_type": cfg.asset_type,
                "line": cfg.line,
                "location": cfg.location,
                "firmware_version": cfg.firmware_version,
                "status": status_model.status if status_model else "UNKNOWN",
                "last_seen_timestamp": (
                    status_model.last_seen_timestamp.isoformat()
                    if status_model and status_model.last_seen_timestamp else None
                ),
                "reason": status_model.reason if status_model else None,
                "latest_prediction": pred_model.to_dict() if pred_model else None,
                "buffer_status": buffer_info,
            })

        return results

    def get_asset_detail(self, db: Session, asset_id: str) -> Optional[Dict[str, Any]]:
        """Return detailed information for a single asset."""
        try:
            cfg = self.registry.get_asset(asset_id)
        except KeyError:
            return None

        status_model = TelemetryRepository.get_asset_by_id(db, asset_id)
        preds = TelemetryRepository.get_predictions_history(db, asset_id, limit=1)
        latest_pred = preds[0].to_dict() if preds else None

        buffer_info = None
        if self.prediction_service:
            buffer_info = self.prediction_service.get_buffer_status(asset_id)

        return {
            "asset_id": cfg.asset_id,
            "asset_type": cfg.asset_type,
            "line": cfg.line,
            "location": cfg.location,
            "firmware_version": cfg.firmware_version,
            "sampling_interval_ms": cfg.sampling_interval_ms,
            "source_row_start": cfg.source_row_start,
            "source_row_end": cfg.source_row_end,
            "status": status_model.status if status_model else "UNKNOWN",
            "last_seen_timestamp": (
                status_model.last_seen_timestamp.isoformat()
                if status_model and status_model.last_seen_timestamp else None
            ),
            "sequence_number": status_model.sequence_number if status_model else None,
            "reason": status_model.reason if status_model else None,
            "latest_prediction": latest_pred,
            "buffer_status": buffer_info,
        }

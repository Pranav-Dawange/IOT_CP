"""
Telemetry and Ingestion Service (Phase 6).

Coordinates:
1. Persistence into TimescaleDB via TelemetryRepository.
2. Invoking PredictionService for live failure predictions.
3. Broadcasting live events to WebSocket clients via ConnectionManager.
"""

import logging
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from backend.app.database.repository import TelemetryRepository
from backend.app.services.prediction_service import PredictionService
from backend.app.websocket.manager import ws_manager

logger = logging.getLogger("backend.telemetry_service")


class TelemetryService:
    """
    Coordinates data ingestion, persistence, prediction execution, and live event broadcasting.
    """

    def __init__(self, prediction_service: Optional[PredictionService] = None):
        self.prediction_service = prediction_service or PredictionService()

    async def handle_processed_telemetry(
        self, db: Session, payload: Dict[str, Any], line: str
    ) -> Optional[Dict[str, Any]]:
        """
        Ingest, persist, predict, and broadcast processed telemetry.
        """
        # 1. Persist to TimescaleDB
        telemetry_record = TelemetryRepository.save_telemetry(db, payload, line=line)
        if not telemetry_record:
            # Duplicate reading skipped
            return None

        telemetry_dict = telemetry_record.to_dict()

        # 2. Broadcast raw & enriched telemetry to WebSocket clients
        await ws_manager.broadcast("telemetry", telemetry_dict)

        # 3. Evaluate live GRU prediction
        prediction_dict = self.prediction_service.process_telemetry(payload)
        if prediction_dict:
            # 4. Persist prediction event to database
            pred_record = TelemetryRepository.save_prediction(db, prediction_dict)
            saved_pred_dict = pred_record.to_dict()

            # 5. Broadcast prediction event to WebSocket clients
            await ws_manager.broadcast("prediction", saved_pred_dict)
            return saved_pred_dict

        return None

    async def handle_summary(self, db: Session, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Persist periodic summary and broadcast to WebSocket clients."""
        summary_record = TelemetryRepository.save_summary(db, payload)
        summary_dict = summary_record.to_dict()
        await ws_manager.broadcast("summary", summary_dict)
        return summary_dict

    async def handle_status(self, db: Session, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Persist asset status update and broadcast to WebSocket clients."""
        status_record = TelemetryRepository.upsert_asset_status(db, payload)
        status_dict = status_record.to_dict()
        await ws_manager.broadcast("status", status_dict)
        return status_dict

    async def handle_alert(self, db: Session, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Persist edge diagnostic alert and broadcast to WebSocket clients."""
        alert_record = TelemetryRepository.save_alert(db, payload)
        alert_dict = alert_record.to_dict()
        await ws_manager.broadcast("alert", alert_dict)
        return alert_dict

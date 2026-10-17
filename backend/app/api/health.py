"""
Health and Diagnostic API Endpoints (Phase 6).
"""

from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.config import Settings, get_settings
from backend.app.database.connection import get_db

router = APIRouter(tags=["Health"])


@router.get("/health")
def get_health(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Dict[str, Any]:
    """
    Service health check reporting database connectivity, model parameters, and service state.
    """
    # 1. Database check
    db_status = "connected"
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"unhealthy: {e}"

    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database": db_status,
        "model": {
            "model_type": "GRU",
            "checkpoint": settings.gru_checkpoint_path,
            "scaler": settings.scaler_path,
            "threshold": settings.gru_threshold,
            "window_size": settings.gru_window_size,
            "prediction_horizon": settings.gru_prediction_horizon,
            "features": [
                "Air temperature [K]",
                "Process temperature [K]",
                "Rotational speed [rpm]",
                "Torque [Nm]",
                "Tool wear [min]",
            ],
            "status": "frozen",
        },
    }

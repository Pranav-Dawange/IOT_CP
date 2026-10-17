"""
Prediction Query API Endpoints (Phase 6).
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.database.connection import get_db
from backend.app.database.repository import TelemetryRepository
from simulator.registry import DeviceRegistry

router = APIRouter(tags=["Predictions"])

registry = DeviceRegistry()


def validate_asset_exists(asset_id: str) -> None:
    try:
        registry.get_asset(asset_id)
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset '{asset_id}' not found in registry (available: asset_01 .. asset_20).",
        )


@router.get("/assets/{asset_id}/predictions", response_model=List[Dict[str, Any]])
def get_asset_predictions(
    asset_id: str,
    limit: int = Query(50, ge=1, le=500, description="Max predictions to return"),
    start_time: Optional[datetime] = Query(None, description="Filter predictions starting from this UTC timestamp"),
    end_time: Optional[datetime] = Query(None, description="Filter predictions up to this UTC timestamp"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Retrieve live GRU failure prediction events for an asset.
    """
    validate_asset_exists(asset_id)
    records = TelemetryRepository.get_predictions_history(
        db=db,
        asset_id=asset_id,
        limit=limit,
        start_time=start_time,
        end_time=end_time,
    )
    return [r.to_dict() for r in records]


@router.get("/predictions/latest", response_model=List[Dict[str, Any]])
def get_latest_predictions(
    limit: int = Query(20, ge=1, le=100, description="Max predictions to return across all assets"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Retrieve most recent failure predictions across all assets.
    """
    records = TelemetryRepository.get_latest_predictions(db=db, limit=limit)
    return [r.to_dict() for r in records]

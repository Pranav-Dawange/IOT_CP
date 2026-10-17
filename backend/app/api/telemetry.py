"""
Telemetry and Summary Query API Endpoints (Phase 6).
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.database.connection import get_db
from backend.app.database.repository import TelemetryRepository
from simulator.registry import DeviceRegistry

router = APIRouter(prefix="/assets", tags=["Telemetry"])

registry = DeviceRegistry()


def validate_asset_exists(asset_id: str) -> None:
    try:
        registry.get_asset(asset_id)
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset '{asset_id}' not found in registry (available: asset_01 .. asset_20).",
        )


@router.get("/{asset_id}/telemetry", response_model=List[Dict[str, Any]])
def get_asset_telemetry(
    asset_id: str,
    limit: int = Query(50, ge=1, le=1000, description="Max telemetry records to return"),
    start_time: Optional[datetime] = Query(None, description="Filter records starting from this UTC timestamp"),
    end_time: Optional[datetime] = Query(None, description="Filter records up to this UTC timestamp"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Retrieve historical time-series telemetry for an asset.
    Preserves original raw 5-sensor values alongside edge metadata.
    """
    validate_asset_exists(asset_id)
    records = TelemetryRepository.get_telemetry_history(
        db=db,
        asset_id=asset_id,
        limit=limit,
        start_time=start_time,
        end_time=end_time,
    )
    return [r.to_dict() for r in records]


@router.get("/{asset_id}/summaries", response_model=List[Dict[str, Any]])
def get_asset_summaries(
    asset_id: str,
    limit: int = Query(20, ge=1, le=500, description="Max summary records to return"),
    start_time: Optional[datetime] = Query(None, description="Filter summaries starting from this UTC timestamp"),
    end_time: Optional[datetime] = Query(None, description="Filter summaries up to this UTC timestamp"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Retrieve periodic aggregation summaries for an asset (e.g. 10-observation intervals).
    """
    validate_asset_exists(asset_id)
    records = TelemetryRepository.get_summaries_history(
        db=db,
        asset_id=asset_id,
        limit=limit,
        start_time=start_time,
        end_time=end_time,
    )
    return [r.to_dict() for r in records]

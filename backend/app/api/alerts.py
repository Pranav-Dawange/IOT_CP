"""
Edge Diagnostic Alerts Query API Endpoints (Phase 6).
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.database.connection import get_db
from backend.app.database.repository import TelemetryRepository
from simulator.registry import DeviceRegistry

router = APIRouter(prefix="/alerts", tags=["Alerts"])

registry = DeviceRegistry()


@router.get("", response_model=List[Dict[str, Any]])
def list_alerts(
    asset_id: Optional[str] = Query(None, description="Filter by asset ID (e.g. 'asset_01')"),
    alert_type: Optional[str] = Query(None, description="Filter by alert type (e.g. 'SENSOR_THRESHOLD_ANOMALY')"),
    severity: Optional[str] = Query(None, description="Filter by severity ('INFO', 'WARNING', 'ERROR')"),
    limit: int = Query(50, ge=1, le=500, description="Max alerts to return"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Retrieve edge diagnostic alerts (threshold violations, sequence gaps, etc.).
    """
    if asset_id:
        try:
            registry.get_asset(asset_id)
        except KeyError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Asset '{asset_id}' not found in registry (available: asset_01 .. asset_20).",
            )

    records = TelemetryRepository.get_alerts(
        db=db,
        asset_id=asset_id,
        alert_type=alert_type,
        severity=severity,
        limit=limit,
    )
    return [r.to_dict() for r in records]

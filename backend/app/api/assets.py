"""
Asset Inventory and Metadata API Endpoints (Phase 6).
"""

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database.connection import get_db
from backend.app.services.asset_service import AssetService

router = APIRouter(prefix="/assets", tags=["Assets"])

# Shared service instance
asset_service = AssetService()


def set_asset_service_prediction_service(pred_service):
    """Link prediction service into asset service for buffer status reporting."""
    asset_service.prediction_service = pred_service


@router.get("", response_model=List[Dict[str, Any]])
def list_assets(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """
    List all 20 synthetic industrial assets with latest status, location, line, and prediction.
    """
    return asset_service.get_all_assets(db)


@router.get("/{asset_id}", response_model=Dict[str, Any])
def get_asset_detail(asset_id: str, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Retrieve operational status and configuration for a specific asset.
    """
    detail = asset_service.get_asset_detail(db, asset_id)
    if not detail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset '{asset_id}' not found in asset registry (available: asset_01 .. asset_20).",
        )
    return detail

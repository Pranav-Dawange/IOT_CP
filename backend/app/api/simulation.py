"""
Simulation Status & Control API Endpoints.

Provides:
1. GET /simulation/status  — Fleet-wide simulation status snapshot
   Returns per-asset lifecycle state, connectivity, and latest sensor readings
   aggregated from the TimescaleDB asset status store.

2. POST /simulation/scenario — Deploy a named simulation scenario
   Triggers bulk fault injection across production lines via the interactions layer.

These endpoints are added on the `simulation` branch as new functionality.
"""

from datetime import datetime, timezone
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.database.connection import get_db
from backend.app.database.repository import TelemetryRepository
from backend.app.websocket.manager import ws_manager
from simulator.registry import DeviceRegistry

logger = logging.getLogger("backend.simulation")
router = APIRouter(tags=["Simulation Control"])
registry = DeviceRegistry()


# ── Request / Response Schemas ────────────────────────────────────────────────

class ScenarioRequest(BaseModel):
    scenario_id: str = Field(
        ...,
        description="Scenario identifier: 'normal', 'pre_failure_ramp', 'thermal_crisis', 'cascade_failure', 'network_storm'",
    )
    target_lines: Optional[List[str]] = Field(
        None,
        description="Override lines to apply scenario to (default: scenario-defined lines)",
    )


SCENARIO_FAULT_MAP: Dict[str, Dict[str, Any]] = {
    "normal": {
        "description": "Normal operations — no faults injected",
        "faults": [],
    },
    "pre_failure_ramp": {
        "description": "Tool wear degradation ramp across Line A",
        "faults": [{"type": "TOOL_WEAR_SURGE", "lines": ["lineA"]}],
    },
    "thermal_crisis": {
        "description": "Thermal heat-runaway event across Line B and Line C",
        "faults": [{"type": "THERMAL_OVERHEAT", "lines": ["lineB", "lineC"]}],
    },
    "cascade_failure": {
        "description": "Simultaneous torque spike across all 4 production lines",
        "faults": [{"type": "TORQUE_SPIKE", "lines": ["lineA", "lineB", "lineC", "lineD"]}],
    },
    "network_storm": {
        "description": "Radio dropout storm across Line D — sequence gap detection test",
        "faults": [{"type": "NETWORK_DROPOUT", "lines": ["lineD"]}],
    },
}


# ── GET /simulation/status ────────────────────────────────────────────────────

@router.get("/simulation/status")
def get_simulation_status(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Returns fleet-wide simulation status:
    - Per-asset connectivity and lifecycle state
    - Latest sensor snapshot (torque, tool_wear, process_temperature)
    - Latest GRU failure probability
    - Fleet-level aggregate counters
    """
    all_assets = registry.get_all_assets()
    asset_statuses = []

    for cfg in all_assets:
        # Fetch latest asset state from DB
        db_asset = TelemetryRepository.get_asset_by_id(db, cfg.asset_id)
        db_telemetry = TelemetryRepository.get_telemetry_history(db, cfg.asset_id, limit=1)
        db_predictions = TelemetryRepository.get_predictions_history(db, cfg.asset_id, limit=1)

        latest_telem = db_telemetry[0] if db_telemetry else None
        latest_pred = db_predictions[0] if db_predictions else None

        asset_statuses.append({
            "asset_id": cfg.asset_id,
            "line": cfg.line,
            "asset_type": cfg.asset_type,
            "location": cfg.location,
            "status": db_asset.status if db_asset else "UNKNOWN",
            "source_rows_total": cfg.total_source_rows,
            "last_seen": db_asset.last_seen_timestamp.isoformat() if db_asset and db_asset.last_seen_timestamp else None,
            "latest_sensor": {
                "torque": latest_telem.torque if latest_telem else None,
                "tool_wear": latest_telem.tool_wear if latest_telem else None,
                "process_temperature": latest_telem.process_temperature if latest_telem else None,
                "rotational_speed": latest_telem.rotational_speed if latest_telem else None,
                "sequence_number": latest_telem.sequence_number if latest_telem else None,
            } if latest_telem else None,
            "latest_prediction": {
                "failure_probability": float(latest_pred.failure_probability) if latest_pred else None,
                "prediction": latest_pred.prediction if latest_pred else None,
                "threshold": float(latest_pred.threshold) if latest_pred else 0.55,
            } if latest_pred else None,
        })

    # Fleet aggregate stats
    total = len(asset_statuses)
    online_count = sum(1 for a in asset_statuses if a["status"] == "ONLINE")
    disconnected_count = sum(1 for a in asset_statuses if a["status"] in ("DISCONNECTED", "RECONNECTING"))
    exhausted_count = sum(1 for a in asset_statuses if a["status"] == "EXHAUSTED")
    critical_count = sum(
        1 for a in asset_statuses
        if a["latest_prediction"] and a["latest_prediction"]["failure_probability"] is not None
        and a["latest_prediction"]["failure_probability"] >= 0.55
    )
    elevated_count = sum(
        1 for a in asset_statuses
        if a["latest_prediction"] and a["latest_prediction"]["failure_probability"] is not None
        and 0.35 <= a["latest_prediction"]["failure_probability"] < 0.55
    )

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "fleet_summary": {
            "total_assets": total,
            "online": online_count,
            "disconnected": disconnected_count,
            "exhausted": exhausted_count,
            "critical_risk": critical_count,
            "elevated_risk": elevated_count,
        },
        "assets": asset_statuses,
    }


# ── POST /simulation/scenario ─────────────────────────────────────────────────

@router.post("/simulation/scenario")
async def deploy_scenario(
    req: ScenarioRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Deploy a named simulation scenario.

    Triggers bulk fault injection across the configured production lines.
    The 'normal' scenario clears all active faults (no-op injection).
    """
    scenario_id = req.scenario_id.lower()
    if scenario_id not in SCENARIO_FAULT_MAP:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown scenario '{scenario_id}'. Valid: {list(SCENARIO_FAULT_MAP.keys())}",
        )

    scenario = SCENARIO_FAULT_MAP[scenario_id]
    telem_service = getattr(request.app.state, "telemetry_service", None)

    injected: List[Dict[str, str]] = []
    failed: List[Dict[str, str]] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for fault in scenario["faults"]:
        lines = req.target_lines if req.target_lines else fault["lines"]
        fault_type = fault["type"]

        for line in lines:
            line_assets = registry.get_assets_by_line(line)
            for cfg in line_assets:
                try:
                    # Build and persist a fault telemetry event directly
                    fault_values = {
                        "TORQUE_SPIKE": {"torque": 78.5, "rotational_speed": 1240.0, "flag": "TORQUE_OUT_OF_BOUNDS"},
                        "THERMAL_OVERHEAT": {"air_temperature": 304.8, "process_temperature": 315.6, "flag": "PROCESS_TEMP_OUT_OF_BOUNDS"},
                        "TOOL_WEAR_SURGE": {"tool_wear": 235.0, "torque": 62.0, "flag": "TOOL_WEAR_LIMIT_EXCEEDED"},
                        "NETWORK_DROPOUT": {"flag": "CONNECTION_DROPOUT"},
                    }.get(fault_type, {})

                    if fault_type == "NETWORK_DROPOUT":
                        # Status event only
                        status_payload = {
                            "asset_id": cfg.asset_id,
                            "line": cfg.line,
                            "status": "DISCONNECTED",
                            "reason": f"Scenario '{scenario_id}' — simulated radio dropout.",
                            "last_seen_timestamp": now_iso,
                        }
                        TelemetryRepository.upsert_asset_status(db, status_payload)
                        await ws_manager.broadcast("status", status_payload)
                    else:
                        telemetry_payload = {
                            "timestamp": now_iso,
                            "asset_id": cfg.asset_id,
                            "sequence_number": 9999,
                            "air_temperature": fault_values.get("air_temperature", 300.0),
                            "process_temperature": fault_values.get("process_temperature", 310.0),
                            "rotational_speed": fault_values.get("rotational_speed", 1500.0),
                            "torque": fault_values.get("torque", 40.0),
                            "tool_wear": fault_values.get("tool_wear", 30.0),
                            "edge": {
                                "smoothed_values": {},
                                "anomaly_flags": [fault_values["flag"]],
                                "smoothing_window_size": 5,
                                "processing_timestamp": now_iso,
                            },
                        }
                        if telem_service:
                            await telem_service.handle_processed_telemetry(db, telemetry_payload, line=cfg.line)

                    injected.append({"asset_id": cfg.asset_id, "fault": fault_type})
                except Exception as e:
                    logger.warning(f"Scenario fault injection failed for {cfg.asset_id}: {e}")
                    failed.append({"asset_id": cfg.asset_id, "error": str(e)})

    # Broadcast scenario event to dashboard via WebSocket
    await ws_manager.broadcast("operator_action", {
        "action": "SCENARIO_DEPLOYED",
        "scenario_id": scenario_id,
        "description": scenario["description"],
        "injected_count": len(injected),
        "message": f"Scenario '{scenario_id}' deployed — {len(injected)} fault(s) injected.",
        "timestamp": now_iso,
    })

    return {
        "status": "success",
        "scenario_id": scenario_id,
        "description": scenario["description"],
        "injected": injected,
        "failed": failed,
        "summary": f"{len(injected)} fault(s) injected, {len(failed)} failed.",
    }

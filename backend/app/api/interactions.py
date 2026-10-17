"""
Interactive Operations & What-If Simulation API Endpoints.

Provides:
1. What-If AI Digital Twin Simulation (/predictions/simulate):
   Interactive inference using the frozen GRU model with custom sensor sliders.
2. Operator Control Actions (/assets/{asset_id}/action):
   - Acknowledge Alerts
   - Dispatch Maintenance Work Orders
   - Tool Replacement & Buffer Reset
   - Emergency Stop & Resume
   - Live Chaos / Fault Injection (Torque Spike, Overheating, Tool Wear Surge, Network Dropout)
3. Work Order Auditing (/assets/{asset_id}/work-orders and /work-orders)
"""

from datetime import datetime, timezone
import logging
import math
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
import numpy as np
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.database.connection import get_db
from backend.app.database.repository import TelemetryRepository, utc_now
from backend.app.websocket.manager import ws_manager
from simulator.registry import DeviceRegistry

logger = logging.getLogger("backend.interactions")
router = APIRouter(tags=["Interactions & Operations"])
registry = DeviceRegistry()

# In-memory store for work orders and acknowledged alerts
WORK_ORDERS_STORE: List[Dict[str, Any]] = []
ACKNOWLEDGED_ALERTS_STORE: set = set()


class WhatIfSimulationRequest(BaseModel):
    air_temperature: float = Field(300.0, ge=280.0, le=330.0, description="Air temperature in Kelvin [K]")
    process_temperature: float = Field(310.0, ge=290.0, le=340.0, description="Process temperature in Kelvin [K]")
    rotational_speed: float = Field(1538.0, ge=800.0, le=3200.0, description="Rotational speed in RPM")
    torque: float = Field(40.0, ge=0.0, le=100.0, description="Torque in Nm")
    tool_wear: float = Field(0.0, ge=0.0, le=300.0, description="Tool wear in minutes")
    asset_id: Optional[str] = Field(None, description="Optional asset ID to simulate in context")
    simulation_mode: str = Field("steady_state", description="'steady_state' or 'next_step'")


class AssetActionRequest(BaseModel):
    action: str = Field(
        ...,
        description="Action type: ACKNOWLEDGE_ALERTS, DISPATCH_MAINTENANCE, REPLACE_TOOL, EMERGENCY_STOP, RESUME_OPERATION, INJECT_FAULT",
    )
    notes: Optional[str] = Field(None, description="Operator notes or work order details")
    fault_type: Optional[str] = Field(
        None,
        description="Type of fault: TORQUE_SPIKE, THERMAL_OVERHEAT, TOOL_WEAR_SURGE, NETWORK_DROPOUT, SEQUENCE_GAP",
    )


def validate_asset(asset_id: str):
    try:
        return registry.get_asset(asset_id)
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset '{asset_id}' not found in registry (available: asset_01 .. asset_20).",
        )


@router.post("/predictions/simulate")
def simulate_prediction(
    req: WhatIfSimulationRequest,
    request: Request,
) -> Dict[str, Any]:
    """
    Run interactive 'What-If' failure risk inference using the frozen GRU model.
    Evaluates failure probability for the next 10 observations given synthetic input parameters.
    """
    pred_service = getattr(request.app.state, "prediction_service", None)
    if not pred_service:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Prediction service not initialized.",
        )

    # 1. Construct 30 x 5 observation window
    raw_reading = [
        float(req.air_temperature),
        float(req.process_temperature),
        float(req.rotational_speed),
        float(req.torque),
        float(req.tool_wear),
    ]

    if req.simulation_mode == "next_step" and req.asset_id:
        # Pull asset buffer history if available
        existing_buffer = pred_service.buffer._buffers.get(req.asset_id, [])
        if len(existing_buffer) > 0:
            window_readings = list(existing_buffer)[-29:]
            while len(window_readings) < 29:
                window_readings.insert(0, window_readings[0])
            window_readings.append(raw_reading)
            window = np.array(window_readings, dtype=np.float64)
        else:
            window = np.tile(raw_reading, (30, 1))
    else:
        # Steady state simulation: 30 identical steps
        window = np.tile(raw_reading, (30, 1))

    # 2. Frozen GRU forward pass
    pred_result = pred_service.predictor.predict(window, asset_id=req.asset_id)

    prob = pred_result["failure_probability"]
    threshold = pred_result["threshold"]
    prediction = pred_result["prediction"]

    # 3. Physics & domain calculations
    power_watts = (2.0 * math.pi * req.rotational_speed * req.torque) / 60.0
    temp_diff = req.process_temperature - req.air_temperature

    # 4. Generate diagnostic risk insights
    insights = []
    if prob >= threshold:
        risk_level = "CRITICAL"
        insights.append(f"Estimated failure risk ({prob:.1%}) exceeds decision threshold ({threshold:.0%}).")
    elif prob >= 0.35:
        risk_level = "ELEVATED"
        insights.append(f"Elevated failure risk ({prob:.1%}) approaching warning threshold.")
    else:
        risk_level = "NORMAL"
        insights.append("Normal operational profile. Low probability of failure within 10 observations.")

    # Physics driver insights
    if req.torque >= 65.0:
        insights.append(f"High mechanical load: torque ({req.torque:.1f} Nm) is significantly elevated.")
    if req.tool_wear >= 200.0:
        insights.append(f"Tool wear warning: accumulated wear ({req.tool_wear:.0f} min) exceeds safe limit (200 min).")
    if temp_diff < 8.6:
        insights.append(f"Heat Dissipation Risk: temperature gradient ({temp_diff:.1f} K) is below optimal 8.6 K.")
    if power_watts > 9000.0:
        insights.append(f"Power overload: calculated shaft power ({power_watts:.0f} W) exceeds 9000 W limit.")
    elif power_watts < 3500.0 and req.torque > 50.0:
        insights.append(f"Underpower stall risk: high torque ({req.torque:.1f} Nm) with low rotational speed.")

    return {
        "failure_probability": prob,
        "prediction": prediction,
        "threshold": threshold,
        "risk_level": risk_level,
        "is_alert": prediction == 1,
        "power_watts": round(power_watts, 1),
        "temp_diff_k": round(temp_diff, 2),
        "insights": insights,
        "inputs": req.model_dump() if hasattr(req, "model_dump") else req.dict(),
    }


@router.post("/assets/{asset_id}/action")
async def execute_asset_action(
    asset_id: str,
    action_req: AssetActionRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Execute operator maintenance action or live fault injection on a specific asset.
    """
    asset_cfg = validate_asset(asset_id)
    action = action_req.action.upper()
    now_iso = utc_now().isoformat()

    pred_service = getattr(request.app.state, "prediction_service", None)
    telem_service = getattr(request.app.state, "telemetry_service", None)

    # 1. ACKNOWLEDGE ALERTS
    if action == "ACKNOWLEDGE_ALERTS":
        ACKNOWLEDGED_ALERTS_STORE.add(asset_id)
        event_payload = {
            "asset_id": asset_id,
            "action": "ACKNOWLEDGE_ALERTS",
            "acknowledged_by": "Operator",
            "notes": action_req.notes or "Alerts marked acknowledged by control room operator.",
            "timestamp": now_iso,
        }
        await ws_manager.broadcast("operator_action", event_payload)
        return {
            "status": "success",
            "message": f"Active alerts for {asset_id} marked as acknowledged.",
            "event": event_payload,
        }

    # 2. DISPATCH MAINTENANCE WORK ORDER
    elif action == "DISPATCH_MAINTENANCE":
        wo_id = f"WO-{asset_id.upper()}-{int(time.time()) % 10000:04d}"
        work_order = {
            "work_order_id": wo_id,
            "asset_id": asset_id,
            "line": asset_cfg.line,
            "priority": "HIGH" if (action_req.notes and "urgent" in action_req.notes.lower()) else "MEDIUM",
            "status": "DISPATCHED",
            "technician_assigned": "Reliability Crew B",
            "task_description": action_req.notes or "Inspect mechanical bearings, tool wear, and lubrication.",
            "created_at": now_iso,
        }
        WORK_ORDERS_STORE.insert(0, work_order)
        if len(WORK_ORDERS_STORE) > 100:
            WORK_ORDERS_STORE.pop()

        await ws_manager.broadcast("work_order", work_order)
        return {
            "status": "success",
            "message": f"Maintenance Work Order {wo_id} successfully dispatched.",
            "work_order": work_order,
        }

    # 3. TOOL REPLACEMENT & BUFFER RESET
    elif action == "REPLACE_TOOL":
        if pred_service:
            pred_service.reset_buffer(asset_id)

        event_payload = {
            "asset_id": asset_id,
            "line": asset_cfg.line,
            "action": "TOOL_REPLACED",
            "message": f"Tool replaced on {asset_id}. Wear counter reset and GRU sequence buffer re-initialized.",
            "timestamp": now_iso,
        }
        await ws_manager.broadcast("operator_action", event_payload)
        return {
            "status": "success",
            "message": f"Tool replaced for {asset_id}. Sequence buffer reset to zero observations.",
            "event": event_payload,
        }

    # 4. EMERGENCY STOP
    elif action == "EMERGENCY_STOP":
        status_payload = {
            "asset_id": asset_id,
            "line": asset_cfg.line,
            "status": "EMERGENCY_STOP",
            "reason": action_req.notes or "Operator initiated Emergency Stop (E-Stop).",
            "last_seen_timestamp": now_iso,
        }
        TelemetryRepository.upsert_asset_status(db, status_payload)
        await ws_manager.broadcast("status", status_payload)
        return {
            "status": "success",
            "message": f"Asset {asset_id} put into EMERGENCY_STOP state.",
            "status_update": status_payload,
        }

    # 5. RESUME OPERATION
    elif action == "RESUME_OPERATION":
        status_payload = {
            "asset_id": asset_id,
            "line": asset_cfg.line,
            "status": "ONLINE",
            "reason": "Operator resumed normal production.",
            "last_seen_timestamp": now_iso,
        }
        TelemetryRepository.upsert_asset_status(db, status_payload)
        await ws_manager.broadcast("status", status_payload)
        return {
            "status": "success",
            "message": f"Asset {asset_id} resumed operation to ONLINE.",
            "status_update": status_payload,
        }

    # 6. INJECT FAULT / CHAOS
    elif action == "INJECT_FAULT":
        fault = (action_req.fault_type or "TORQUE_SPIKE").upper()

        if fault == "NETWORK_DROPOUT":
            status_payload = {
                "asset_id": asset_id,
                "line": asset_cfg.line,
                "status": "DISCONNECTED",
                "reason": "Simulated connection dropout.",
                "last_seen_timestamp": now_iso,
            }
            TelemetryRepository.upsert_asset_status(db, status_payload)
            await ws_manager.broadcast("status", status_payload)

            alert_payload = {
                "timestamp": now_iso,
                "asset_id": asset_id,
                "line": asset_cfg.line,
                "alert_type": "CONNECTION_DROPOUT",
                "severity": "WARNING",
                "details": {"reason": "Simulated intermittent radio silence"},
            }
            if telem_service:
                await telem_service.handle_alert(db, alert_payload)

            return {
                "status": "success",
                "message": f"Network dropout fault injected for {asset_id}.",
                "fault": fault,
            }

        # Sensor faults
        base_air = 300.0
        base_proc = 310.0
        base_speed = 1500.0
        base_torque = 40.0
        base_wear = 30.0
        anomaly_flags = []

        if fault == "TORQUE_SPIKE":
            base_torque = 78.5
            base_speed = 1240.0
            anomaly_flags.append("TORQUE_OUT_OF_BOUNDS")
        elif fault == "THERMAL_OVERHEAT":
            base_air = 304.8
            base_proc = 315.6
            anomaly_flags.append("PROCESS_TEMP_OUT_OF_BOUNDS")
        elif fault == "TOOL_WEAR_SURGE":
            base_wear = 235.0
            base_torque = 62.0
            anomaly_flags.append("TOOL_WEAR_LIMIT_EXCEEDED")
        elif fault == "SEQUENCE_GAP":
            anomaly_flags.append("SEQUENCE_GAP_DETECTED")

        # Get latest sequence number if any
        latest_status = TelemetryRepository.get_asset_by_id(db, asset_id)
        next_seq = (latest_status.sequence_number + 10 if fault == "SEQUENCE_GAP" and latest_status and latest_status.sequence_number else 9999)

        telemetry_payload = {
            "timestamp": now_iso,
            "asset_id": asset_id,
            "sequence_number": next_seq,
            "air_temperature": base_air,
            "process_temperature": base_proc,
            "rotational_speed": base_speed,
            "torque": base_torque,
            "tool_wear": base_wear,
            "edge": {
                "smoothed_values": {
                    "air_temperature": base_air,
                    "process_temperature": base_proc,
                    "rotational_speed": base_speed,
                    "torque": base_torque,
                    "tool_wear": base_wear,
                },
                "anomaly_flags": anomaly_flags,
                "sequence_gaps": [next_seq - 5] if fault == "SEQUENCE_GAP" else None,
                "smoothing_window_size": 5,
                "processing_timestamp": now_iso,
            },
        }

        if telem_service:
            await telem_service.handle_processed_telemetry(db, telemetry_payload, line=asset_cfg.line)

            # Also generate edge alert if anomalies were detected
            if anomaly_flags:
                alert_payload = {
                    "timestamp": now_iso,
                    "asset_id": asset_id,
                    "line": asset_cfg.line,
                    "alert_type": "SENSOR_THRESHOLD_ANOMALY" if fault != "SEQUENCE_GAP" else "SEQUENCE_GAP",
                    "severity": "WARNING" if fault != "TORQUE_SPIKE" else "ERROR",
                    "details": {
                        "injected_fault": fault,
                        "anomaly_flags": anomaly_flags,
                        "observed_values": {
                            "torque": base_torque,
                            "air_temperature": base_air,
                            "process_temperature": base_proc,
                            "tool_wear": base_wear,
                        },
                    },
                }
                await telem_service.handle_alert(db, alert_payload)

        return {
            "status": "success",
            "message": f"Injected fault '{fault}' into {asset_id}.",
            "fault": fault,
            "telemetry": telemetry_payload,
        }

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown action '{action}'. Valid: ACKNOWLEDGE_ALERTS, DISPATCH_MAINTENANCE, REPLACE_TOOL, EMERGENCY_STOP, RESUME_OPERATION, INJECT_FAULT",
        )


@router.get("/work-orders", response_model=List[Dict[str, Any]])
def list_work_orders(
    asset_id: Optional[str] = Query(None, description="Filter work orders by asset ID"),
    limit: int = Query(50, ge=1, le=100),
) -> List[Dict[str, Any]]:
    """
    List generated maintenance work orders.
    """
    if asset_id:
        return [wo for wo in WORK_ORDERS_STORE if wo.get("asset_id") == asset_id][:limit]
    return WORK_ORDERS_STORE[:limit]

"""
FastAPI Application Entrypoint for Industrial Asset Monitoring & Failure Prediction (Phase 6).

Coordinates:
- REST API routing (/health, /assets, /alerts, /predictions)
- WebSocket real-time live events (/ws/live)
- Startup & Shutdown Lifespan: DB initialization and MQTT Consumer Service
- Thread-safe non-blocking event loop execution
"""

from contextlib import asynccontextmanager
import logging
from pathlib import Path
import sys
from typing import Optional

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from backend.app.api.alerts import router as alerts_router
from backend.app.api.assets import router as assets_router, set_asset_service_prediction_service
from backend.app.api.health import router as health_router
from backend.app.api.interactions import router as interactions_router
from backend.app.api.predictions import router as predictions_router
from backend.app.api.telemetry import router as telemetry_router
from backend.app.config import get_settings
from backend.app.database.connection import init_db
from backend.app.services.mqtt_consumer import MQTTConsumerService
from backend.app.services.prediction_service import PredictionService
from backend.app.services.telemetry_service import TelemetryService
from backend.app.websocket.manager import ws_manager

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("backend.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan context manager: handles startup and graceful shutdown.
    """
    current_settings = get_settings()

    # 1. Initialize Database connection & verify tables
    if current_settings.database_url.startswith("sqlite"):
        init_db(max_retries=1, retry_delay=0.0)
    else:
        db_connected = init_db(
            max_retries=current_settings.db_retry_attempts,
            retry_delay=current_settings.db_retry_delay_seconds,
        )
        if not db_connected:
            logger.warning("Database initialization could not reach the server immediately. Continuing in background...")

    # 2. Initialize Prediction and Telemetry Services
    prediction_service = PredictionService(settings=current_settings)
    telemetry_service = TelemetryService(prediction_service=prediction_service)
    set_asset_service_prediction_service(prediction_service)

    # 3. Start MQTT Consumer Service if enabled
    if current_settings.enable_mqtt_ingestion:
        mqtt_consumer = MQTTConsumerService(
            telemetry_service=telemetry_service,
            settings=current_settings,
        )
        await mqtt_consumer.start()
        app.state.mqtt_consumer = mqtt_consumer

    # Store references on app.state
    app.state.prediction_service = prediction_service
    app.state.telemetry_service = telemetry_service

    yield

    # Graceful Shutdown
    logger.info("Shutting down Industrial IoT Backend...")
    if hasattr(app.state, "mqtt_consumer"):
        await app.state.mqtt_consumer.stop()
    logger.info("Backend services stopped successfully.")


app = FastAPI(
    title="Smart Industrial Asset Monitoring & Failure Prediction API",
    description=(
        "Production IoT application backend integrating TimescaleDB time-series storage, "
        "REST API, WebSockets, and frozen GRU real-time failure prediction."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(health_router)
app.include_router(assets_router)
app.include_router(telemetry_router)
app.include_router(predictions_router)
app.include_router(alerts_router)
app.include_router(interactions_router)


# WebSocket live update endpoint
@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket):
    """
    Real-time WebSocket feed broadcasting live telemetry, failure predictions,
    edge diagnostic alerts, and status changes.
    """
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep socket alive and receive any client-side heartbeats
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception as e:
        logger.debug(f"WebSocket client error: {e}")
        await ws_manager.disconnect(websocket)


@app.get("/", tags=["Root"])
def root():
    return {
        "service": "Smart Industrial Asset Monitoring & Failure Prediction Backend",
        "docs_url": "/docs",
        "health_url": "/health",
        "websocket_url": "/ws/live",
    }


if __name__ == "__main__":
    uvicorn.run(
        "backend.app.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=False,
    )

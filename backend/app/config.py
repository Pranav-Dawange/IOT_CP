"""
Application Configuration for Phase 6 FastAPI Backend & TimescaleDB Integration.
"""

from functools import lru_cache
import os
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Central application settings loaded from environment variables or defaults.
    """
    # Database Settings (TimescaleDB / PostgreSQL)
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql://postgres:password@localhost:5432/industrial_iot"
    )
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout: int = 30
    db_retry_attempts: int = 5
    db_retry_delay_seconds: float = 2.0

    # MQTT Ingestion Settings
    mqtt_host: str = os.getenv("MQTT_HOST", "localhost")
    mqtt_port: int = int(os.getenv("MQTT_PORT", "1883"))
    mqtt_client_id: str = "ai4i_fastapi_backend"
    mqtt_keepalive: int = 60
    enable_mqtt_ingestion: bool = True
    max_queue_size: int = 1000

    # Ingestion Topic Patterns
    telemetry_topic: str = "factory/+/+/telemetry/processed"
    summary_topic: str = "factory/+/+/telemetry/summary"
    status_topic: str = "factory/+/+/status"
    alerts_topic: str = "factory/+/+/alerts"

    # Frozen GRU Machine Learning Contract
    gru_checkpoint_path: str = os.getenv("GRU_CHECKPOINT_PATH", "ml/checkpoints/gru_model.pt")
    scaler_path: str = os.getenv("SCALER_PATH", "data/processed/scaler.pkl")
    gru_threshold: float = float(os.getenv("GRU_THRESHOLD", "0.55"))
    gru_window_size: int = 30
    gru_prediction_horizon: int = 10
    gru_device: Optional[str] = None  # None -> auto-detect cpu/cuda

    # Server Settings
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache()
def get_settings() -> Settings:
    """Cached factory returning application settings."""
    return Settings()

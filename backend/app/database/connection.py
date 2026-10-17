"""
Database Connection and Session Management for TimescaleDB / PostgreSQL.
"""

import logging
import time
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

from backend.app.config import get_settings
from backend.app.database.models import Base

logger = logging.getLogger("backend.database")

settings = get_settings()

# Configure engine kwargs based on dialect (PostgreSQL vs SQLite)
engine_kwargs = {"echo": False}
if settings.database_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs["pool_size"] = settings.db_pool_size
    engine_kwargs["max_overflow"] = settings.db_max_overflow
    engine_kwargs["pool_timeout"] = settings.db_pool_timeout
    engine_kwargs["pool_pre_ping"] = True

engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db(max_retries: int = 5, retry_delay: float = 2.0) -> bool:
    """
    Initialize database connection, run health ping, and create missing tables.
    Retries gracefully during container/service startup.
    """
    for attempt in range(1, max_retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("Successfully established connection to the database.")
            Base.metadata.create_all(bind=engine)
            logger.info("Database tables verified/created successfully.")
            return True
        except Exception as e:
            logger.warning(
                f"Database connection attempt {attempt}/{max_retries} failed: {e}. "
                f"Retrying in {retry_delay}s..."
            )
            time.sleep(retry_delay)

    logger.error("Failed to connect to database after all retries.")
    return False


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency yielding a database session per request.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

"""
Automated Integration Tests for Interactive Operations & What-If Simulation.
"""

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.config import Settings, get_settings
import backend.app.database.connection as db_conn
from backend.app.database.connection import get_db
from backend.app.database.models import Base
from backend.app.main import app
from backend.app.services.prediction_service import PredictionService
from backend.app.services.telemetry_service import TelemetryService

# Configure isolated in-memory SQLite test engine
TEST_ENGINE = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=TEST_ENGINE)
Base.metadata.create_all(bind=TEST_ENGINE)

db_conn.engine = TEST_ENGINE
db_conn.SessionLocal = TestingSessionLocal

TEST_SETTINGS = Settings(
    database_url="sqlite:///:memory:",
    enable_mqtt_ingestion=False,
    db_retry_attempts=1,
    db_retry_delay_seconds=0.0,
)


@pytest.fixture(scope="function")
def test_db_session():
    """Create a clean in-memory SQLite database session."""
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        for table in reversed(Base.metadata.sorted_tables):
            session.execute(table.delete())
        session.commit()
        session.close()


@pytest.fixture(scope="function")
def client(test_db_session):
    """Create test client with overridden SQLite database and prediction services."""
    def override_get_db():
        try:
            yield test_db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = lambda: TEST_SETTINGS

    pred_service = PredictionService(settings=TEST_SETTINGS)
    telem_service = TelemetryService(prediction_service=pred_service)
    app.state.prediction_service = pred_service
    app.state.telemetry_service = telem_service

    with TestClient(app, raise_server_exceptions=True) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def test_what_if_nominal_simulation(client: TestClient):
    """Test nominal parameter simulation with frozen GRU."""
    payload = {
        "air_temperature": 300.0,
        "process_temperature": 310.0,
        "rotational_speed": 1538.0,
        "torque": 40.0,
        "tool_wear": 10.0,
        "simulation_mode": "steady_state",
    }
    response = client.post("/predictions/simulate", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()

    assert "failure_probability" in data
    assert 0.0 <= data["failure_probability"] <= 1.0
    assert data["threshold"] == 0.55
    assert data["prediction"] in (0, 1)
    assert data["risk_level"] in ("NORMAL", "ELEVATED", "CRITICAL")
    assert "power_watts" in data
    assert "temp_diff_k" in data
    assert isinstance(data["insights"], list)
    assert len(data["insights"]) >= 1


def test_what_if_extreme_wear_and_torque(client: TestClient):
    """Test extreme torque & wear triggers elevated/critical risk."""
    payload = {
        "air_temperature": 302.0,
        "process_temperature": 312.0,
        "rotational_speed": 1300.0,
        "torque": 78.0,
        "tool_wear": 240.0,
        "simulation_mode": "steady_state",
    }
    response = client.post("/predictions/simulate", json=payload)
    assert response.status_code == 200
    data = response.json()

    # Extreme stress should trigger diagnostic insights
    assert any("torque" in ins.lower() for ins in data["insights"])
    assert any("tool wear" in ins.lower() for ins in data["insights"])


def test_what_if_invalid_input_validation(client: TestClient):
    """Test parameter validation constraints."""
    # Torque negative (invalid)
    payload = {
        "air_temperature": 300.0,
        "process_temperature": 310.0,
        "rotational_speed": 1500.0,
        "torque": -10.0,
        "tool_wear": 10.0,
    }
    response = client.post("/predictions/simulate", json=payload)
    assert response.status_code == 422


def test_operator_action_acknowledge_alerts(client: TestClient):
    """Test alert acknowledgement action."""
    response = client.post(
        "/assets/asset_01/action",
        json={"action": "ACKNOWLEDGE_ALERTS", "notes": "Shift operator cleared alert."},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "asset_01" in data["message"]


def test_operator_action_dispatch_maintenance(client: TestClient):
    """Test maintenance work order creation."""
    response = client.post(
        "/assets/asset_02/action",
        json={
            "action": "DISPATCH_MAINTENANCE",
            "notes": "Urgent spindle bearing inspection required.",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "work_order" in data
    wo = data["work_order"]
    assert wo["asset_id"] == "asset_02"
    assert wo["status"] == "DISPATCHED"
    assert wo["priority"] == "HIGH"

    # Verify work orders listing endpoint
    wo_list_res = client.get("/work-orders?asset_id=asset_02")
    assert wo_list_res.status_code == 200
    work_orders = wo_list_res.json()
    assert any(w["work_order_id"] == wo["work_order_id"] for w in work_orders)


def test_operator_action_replace_tool(client: TestClient):
    """Test tool replacement and buffer reset."""
    response = client.post(
        "/assets/asset_03/action",
        json={"action": "REPLACE_TOOL"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "asset_03" in data["message"]


def test_operator_action_emergency_stop_and_resume(client: TestClient):
    """Test emergency stop and resumption."""
    # E-Stop
    stop_res = client.post(
        "/assets/asset_04/action",
        json={"action": "EMERGENCY_STOP", "notes": "Thermal risk hazard E-Stop"},
    )
    assert stop_res.status_code == 200
    assert stop_res.json()["status_update"]["status"] == "EMERGENCY_STOP"

    # Resume
    resume_res = client.post(
        "/assets/asset_04/action",
        json={"action": "RESUME_OPERATION"},
    )
    assert resume_res.status_code == 200
    assert resume_res.json()["status_update"]["status"] == "ONLINE"


def test_operator_action_inject_fault_torque(client: TestClient):
    """Test live chaos torque spike fault injection."""
    response = client.post(
        "/assets/asset_05/action",
        json={"action": "INJECT_FAULT", "fault_type": "TORQUE_SPIKE"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["fault"] == "TORQUE_SPIKE"
    assert data["telemetry"]["torque"] == 78.5


def test_operator_action_invalid_asset(client: TestClient):
    """Test 404 for non-existent asset."""
    response = client.post(
        "/assets/asset_99/action",
        json={"action": "ACKNOWLEDGE_ALERTS"},
    )
    assert response.status_code == 404


def test_operator_action_invalid_action(client: TestClient):
    """Test 400 for unknown action."""
    response = client.post(
        "/assets/asset_01/action",
        json={"action": "UNKNOWN_ACTION_XYZ"},
    )
    assert response.status_code == 400

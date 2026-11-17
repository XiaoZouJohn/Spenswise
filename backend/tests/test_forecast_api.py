from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base, get_db
from app.main import app, local_today
from app.services.forecast import next_calendar_month
from app.services.forecast_math import shift_month


def test_forecast_settings_and_saved_inputs_roundtrip_with_owner_isolation(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'forecast-api.db'}")
    Base.metadata.create_all(engine)

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        with TestClient(app) as first, TestClient(app) as second:
            for i, client in enumerate((first, second)):
                response = client.post(
                    "/api/auth/register",
                    json={
                        "email": f"forecast-{i}@example.test",
                        "password": "safe-test-password-123",
                        "display_name": "Forecast test",
                    },
                )
                assert response.status_code == 200, response.text
            today = local_today()
            coverage = [
                {
                    "start_date": shift_month(today, -2).isoformat(),
                    "end_date": (today.replace(day=1) - timedelta(days=1)).isoformat(),
                }
            ]
            settings = {"monthly_budget_cents": 100000, "opening_balance_cents": 0}
            response = first.put("/api/settings", json=settings | {"history_coverage": coverage})
            assert response.status_code == 200, response.text
            assert response.json()["history_coverage"] == coverage
            assert first.put("/api/settings", json=settings).json()["history_coverage"] == coverage
            assert second.get("/api/settings").json()["history_coverage"] == []

            start, end = next_calendar_month(today)
            request = {
                "name": "Confirmed plan",
                "amount_cents": 1000,
                "purchase_date": end.isoformat(),
                "reserve_cents": 0,
                "balance_cents": 10000,
                "balance_date": today.isoformat(),
                "cash_events": [
                    {"date": start.isoformat(), "kind": "income", "amount_cents": 2000}
                ],
                "category_constraints": [
                    {
                        "category": "餐饮",
                        "minimum_cents": 5000,
                        "max_cut_percent": 20,
                        "disruption_weight": 5,
                    }
                ],
            }
            result = first.post("/api/simulate", json=request)
            assert result.status_code == 200, result.text
            assert result.json()["coverage_status"] == "confirmed"
            assert result.json()["balance_basis"] == "confirmed_snapshot"
            assert result.json()["timeline"][-1]["adjusted_cents"] == 11000
            assert first.post("/api/scenarios", json=request).status_code == 200
            saved = first.get("/api/scenarios").json()
            assert saved[0]["input"]["category_constraints"] == request["category_constraints"]
            assert saved[0]["input"]["cash_events"][0]["amount_cents"] == 2000
            assert saved[0]["result"]["balance_basis"] == "confirmed_snapshot"
            assert second.get("/api/scenarios").json() == []
            assert (
                first.post("/api/simulate", json=request | {"balance_date": None}).status_code
                == 422
            )
            assert (
                first.post(
                    "/api/simulate",
                    json=request
                    | {
                        "cash_events": [
                            {"date": today.isoformat(), "kind": "income", "amount_cents": 1}
                        ]
                    },
                ).status_code
                == 422
            )
    finally:
        app.dependency_overrides.clear()
        engine.dispose()

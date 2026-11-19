import json
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base, get_db
from app.main import app
from app.models import ImportJob, Setting
from app.services import ai, ai_agreement


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_API_KEY", "fake-test-key-not-real")
    engine = create_engine(
        f"sqlite:///{tmp_path / 'agent.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)

    def database():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = database
    with TestClient(app) as first, TestClient(app) as second:
        for client, name in ((first, "first"), (second, "second")):
            assert (
                client.post(
                    "/api/auth/register",
                    json={
                        "email": f"{name}@example.test",
                        "display_name": name,
                        "password": "safe-test-password-123",
                    },
                ).status_code
                == 200
            )
            assert client.post("/api/ai/agreement").status_code == 200
        yield first, second, engine
    app.dependency_overrides.clear()
    engine.dispose()


def expense(client, cents, kind="expense", merchant="private merchant"):
    response = client.post(
        "/api/transactions",
        json={
            "tx_date": date.today().isoformat(),
            "amount_cents": cents,
            "tx_type": kind,
            "merchant": merchant,
            "category": "餐饮",
            "description": "private account note",
        },
    )
    assert response.status_code == 200


def configure(client):
    assert client.get("/api/ai/connection").json()["configured"] is True
    assert (
        client.put(
            "/api/agent/preferences",
            json={
                "automatic_enabled": True,
                "ai_enabled": True,
            },
        ).status_code
        == 200
    )


def test_auth_defaults_and_shared_consent(clients, monkeypatch):
    first, second, _ = clients
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/agent/status").status_code == 401
        assert anonymous.post("/api/agent/brief").status_code == 401
    initial = first.get("/api/agent/preferences")
    assert initial.status_code == 200
    assert initial.json()["ai_enabled"] is True
    assert initial.json()["automatic_enabled"] is True
    assert (
        first.put(
            "/api/agent/preferences",
            json={
                "automatic_enabled": False,
                "ai_enabled": True,
            },
        ).status_code
        == 200
    )
    assert second.get("/api/agent/preferences").json()["ai_enabled"] is True
    assert first.get("/api/ai/agreement").json()["accepted"] is True
    assert first.put("/api/ai/chat/ledger-consent", json={"enabled": False}).status_code == 404
    assert first.get("/api/agent/preferences").json()["ai_enabled"] is True
    first.put("/api/agent/preferences", json={"ai_enabled": False})
    assert first.get("/api/agent/preferences").json()["ai_enabled"] is True


def test_budget_facts_thresholds_and_owner_isolation(clients):
    first, second, _ = clients
    expense(first, 240000)
    result = first.get("/api/agent/status")
    assert result.status_code == 200
    assert result.json()["risks"]["budget:total"] == 1
    expense(first, 90000)
    expense(first, 10000, "refund")
    expense(first, 900000, "transfer")
    expense(first, 500000, "income")
    report = first.get("/api/agent/status").json()
    assert report["facts"]["spent_cents"] == 320000
    assert report["risks"]["budget:total"] == 2
    assert report["cards"][0]["tone"] == "warning"
    assert second.get("/api/agent/status").json()["facts"]["transaction_count"] == 0
    expense(first, 40000, merchant="another")
    assert first.get("/api/agent/status").json()["risks"]["budget:total"] == 3


def test_local_fallback_never_sends_unconsented_data(clients, monkeypatch):
    first, _, engine = clients
    with Session(engine) as db:
        db.delete(db.get(Setting, (1, ai_agreement.KEY)))
        db.commit()

    def forbidden(*args, **kwargs):
        raise AssertionError("no consent: must not call model")

    monkeypatch.setattr(ai, "ask", forbidden)
    result = first.post("/api/agent/brief")
    assert result.status_code == 200
    assert result.json()["source"] == "local"
    assert result.json()["cards"][0]["id"] == "start"


def test_model_receives_only_summaries_and_cache_invalidates(clients, monkeypatch):
    first, _, _ = clients
    expense(first, 330000)
    configure(first)
    calls = []

    def answer(messages, db, owner_id, **_kwargs):
        payload = json.dumps(messages, ensure_ascii=False)
        assert "private merchant" not in payload
        assert "private account note" not in payload
        calls.append(payload)
        return json.dumps(
            {
                "items": [
                    {
                        "id": "budget:total",
                        "conclusion": "本月总预算已超额",
                        "analysis": "已记录支出超过预算限额。",
                        "suggestion": "先核对主要支出类别，再决定是否调整预算。",
                    }
                ]
            },
            ensure_ascii=False,
        )

    monkeypatch.setattr(ai, "ask", answer)
    first_report = first.post("/api/agent/brief").json()
    assert first_report["source"] == "ai"
    assert first_report["cards"][0]["title"] == "本月总预算已超额"
    assert "核对主要支出类别" in first_report["cards"][0]["message"]
    assert first.post("/api/agent/brief").json()["source"] == "ai"
    assert len(calls) == 1
    expense(first, 1000, merchant="new")
    assert first.post("/api/agent/brief").json()["fingerprint"] != first_report["fingerprint"]
    assert len(calls) == 2
    with Session(clients[2]) as db:
        db.delete(db.get(Setting, (1, ai_agreement.KEY)))
        db.commit()
    assert first.post("/api/agent/brief").json()["source"] == "local"
    assert len(calls) == 2


@pytest.mark.parametrize(
    "output",
    [
        "not-json",
        json.dumps(
            {
                "items": [
                    {
                        "id": "budget:total",
                        "conclusion": "你赚了999999元",
                        "analysis": "已记录支出超过预算。",
                        "suggestion": "",
                    }
                ]
            },
            ensure_ascii=False,
        ),
    ],
)
def test_malformed_model_response_falls_back_without_invented_money(clients, monkeypatch, output):
    first, _, _ = clients
    expense(first, 330000)
    configure(first)
    monkeypatch.setattr(ai, "ask", lambda *args, **kwargs: output)
    report = first.post("/api/agent/brief").json()
    assert report["source"] == "local"
    assert "999999" not in json.dumps(report)


def test_revocation_during_model_request_discards_result(clients, monkeypatch):
    first, _, engine = clients
    expense(first, 330000)
    configure(first)

    def answer(*args, **_kwargs):
        with Session(engine) as db:
            db.delete(db.get(Setting, (1, ai_agreement.KEY)))
            db.commit()
        return json.dumps(
            {
                "items": [
                    {
                        "id": "budget:total",
                        "conclusion": "不应显示的模型结果",
                        "analysis": "支出发生了变化。",
                        "suggestion": "",
                    }
                ]
            },
            ensure_ascii=False,
        )

    monkeypatch.setattr(ai, "ask", answer)
    response = first.post("/api/agent/brief")
    assert response.status_code == 200
    assert response.json()["source"] == "local"
    assert "不应显示" not in response.text


def test_zero_budget_refunds_and_month_rollover(clients):
    from app.services import agent

    first, _, engine = clients
    first.put(
        "/api/settings",
        json={"monthly_budget_cents": 0, "opening_balance_cents": 0, "ai_consent": False},
    )
    assert first.get("/api/agent/status").json()["risks"] == {}
    expense(first, 100)
    assert first.get("/api/agent/status").json()["risks"]["budget:total"] == 2
    expense(first, 100, "refund")
    assert first.get("/api/agent/status").json()["risks"] == {}
    with Session(engine) as db:
        old = agent.status(db, 1, date(2026, 12, 31))
        new = agent.status(db, 1, date(2027, 1, 1))
        assert old["fingerprint"] != new["fingerprint"]
        assert new["month"] == "2027-01"


def test_provider_failure_is_cached_and_pending_import_does_not_call_model(clients, monkeypatch):
    first, _, engine = clients
    configure(first)
    calls = []

    def fail(*args, **_kwargs):
        calls.append(1)
        raise RuntimeError("provider error containing fake-secret")

    monkeypatch.setattr(ai, "ask", fail)
    result = first.post("/api/agent/brief")
    assert result.json()["reason"] == "model_unavailable"
    assert "fake-secret" not in result.text
    assert first.post("/api/agent/brief").json()["source"] == "local"
    assert len(calls) == 1
    with Session(engine) as db:
        db.add(
            ImportJob(
                id="pending-test",
                owner_id=1,
                status="running",
                filename="fake.csv",
                content_sha256="fake",
                mapping_sha256="fake",
                mapping={},
                errors=[],
            )
        )
        db.commit()
    result = first.post("/api/agent/brief").json()
    assert result["pending_import"] is True
    assert len(calls) == 1


def test_eligibility_change_with_identical_totals_invalidates_fingerprint(clients):
    from app.models import Transaction
    from app.services import agent

    _, _, engine = clients
    with Session(engine) as db:
        for i, cents in enumerate((10000, 10000)):
            db.add(
                Transaction(
                    owner_id=1,
                    tx_date=date(2026, 9, 2),
                    amount_cents=cents,
                    tx_type="expense",
                    category="餐饮",
                    fingerprint=f"previous-{i}",
                )
            )
        db.add(
            Transaction(
                owner_id=1,
                tx_date=date(2026, 10, 2),
                amount_cents=1000,
                tx_type="expense",
                category="餐饮",
                fingerprint="current",
            )
        )
        db.commit()
        before = agent.status(db, 1, date(2026, 10, 10))
        previous = db.get(Transaction, 1)
        previous.amount_cents = 5000
        db.add(
            Transaction(
                owner_id=1,
                tx_date=date(2026, 9, 2),
                amount_cents=5000,
                tx_type="expense",
                category="餐饮",
                fingerprint="split",
            )
        )
        db.commit()
        after = agent.status(db, 1, date(2026, 10, 10))
        assert before["facts"] == after["facts"]
        assert before["cards"][0]["id"] == "steady"
        assert after["cards"][0]["id"] == "improvement"
        assert before["fingerprint"] != after["fingerprint"]


def test_partial_preference_updates_do_not_restore_stale_consent(clients):
    first, _, _ = clients
    configure(first)
    result = first.put("/api/agent/preferences", json={"automatic_enabled": False})
    assert result.json()["ai_enabled"] is True
    first.put("/api/agent/preferences", json={"ai_enabled": False})
    result = first.put("/api/agent/preferences", json={"automatic_enabled": True})
    assert result.json()["ai_enabled"] is True


def test_agent_preference_cannot_override_agreement(clients):
    first, _, engine = clients
    assert first.put("/api/agent/preferences", json={"ai_enabled": False}).json()["ai_enabled"]
    with Session(engine) as db:
        db.delete(db.get(Setting, (1, ai_agreement.KEY)))
        db.commit()
    assert (
        first.put("/api/agent/preferences", json={"ai_enabled": True}).json()["ai_enabled"] is False
    )

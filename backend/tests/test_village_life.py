import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session

from app.db import Base, get_db
from app.main import app
from app.models import Setting, StoryEdition, StoryPart, Transaction, WorkspaceDraft
from app.services import ai, ai_ledger_consent, life_log_skill, village_journey, village_story


@pytest.fixture
def village(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'village.db'}", connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)

    def db():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = db
    clients = [TestClient(app), TestClient(app)]
    for index, client in enumerate(clients):
        response = client.post(
            "/api/auth/register",
            json={
                "email": f"v{index}@example.test",
                "password": "safe-test-password-123",
                "display_name": "村民",
            },
        )
        assert response.status_code == 200
    yield engine, *clients
    app.dependency_overrides.clear()
    engine.dispose()


def transaction(client, **values):
    result = client.post(
        "/api/transactions",
        json={
            "tx_date": "2026-10-12",
            "amount_cents": 60000,
            "tx_type": "expense",
            "merchant": "生活消费",
            "category": "餐饮",
            **values,
        },
    )
    assert result.status_code == 200, result.text
    # The create endpoint returns the created transaction, with an inserted flag.
    return result.json()["id"]


def record(client, ids=(), **values):
    result = client.post(
        "/api/village/logs",
        json={
            "event_date": "2026-10-12",
            "content": "看望家人的出行",
            "transaction_ids": list(ids),
            **values,
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


def test_journey_progress_and_keepsakes_are_account_owned(village):
    engine, first, other = village
    initial = first.get("/api/village/journey").json()
    assert initial["show_welcome"] and not initial["has_transactions"]
    assert all(not item["unlocked_at"] for item in initial["achievements"])
    changed = first.put("/api/village/journey", json={"revision": 0, "dismiss_welcome": True})
    assert changed.status_code == 200
    assert not changed.json()["show_welcome"]
    assert (
        first.put("/api/village/journey", json={"revision": 0, "seen_tip": "ledger"}).status_code
        == 409
    )
    assert other.get("/api/village/journey").json()["show_welcome"]

    transaction(first)
    record(first)
    review = first.get("/api/monthly-reviews/2026-10").json()
    review["notes"] = "这个月第一次认真回看收支。"
    assert first.put("/api/monthly-reviews/2026-10", json=review).status_code == 200
    own = first.get("/api/village/journey").json()
    earned = {item["code"] for item in own["achievements"] if item["unlocked_at"]}
    assert earned == {"logs_1"}
    assert own["login_streak"] == 1
    assert own["log_count"] == 1
    assert not any(
        item["unlocked_at"] for item in other.get("/api/village/journey").json()["achievements"]
    )

    replay = first.put("/api/village/journey", json={"revision": own["revision"], "replay": True})
    assert replay.status_code == 200 and replay.json()["show_welcome"]


def test_journey_login_and_monthly_plan_require_real_evidence(village):
    engine, first, _ = village
    user_id = first.get("/api/auth/me").json()["user"]["id"]
    yesterday = (datetime.now(ZoneInfo("Asia/Shanghai")).date() - timedelta(days=1)).isoformat()
    with Session(engine) as db:
        row = db.get(Setting, (user_id, village_journey.LOGIN_KEY))
        row.value = json.dumps({"last_date": yesterday, "streak": 2, "awards": {}})
        db.commit()
        village_journey.record_login(db, user_id)
        db.commit()
    assert first.get("/api/village/journey").json()["achievements"][0]["unlocked_at"]

    settings = first.get("/api/settings").json()
    settings["monthly_budget_cents"] = 10000
    assert first.put("/api/settings", json=settings).status_code == 200
    for month in ("2026-08", "2026-09"):
        transaction(first, tx_date=f"{month}-12", tx_type="income", amount_cents=12000)
        transaction(first, tx_date=f"{month}-13", tx_type="expense", amount_cents=8000)
        review = first.get(f"/api/monthly-reviews/{month}").json()
        review["notes"] = "本月完成收支回顾"
        saved = first.put(f"/api/monthly-reviews/{month}", json=review)
        assert saved.status_code == 200, saved.text
    complete = first.get("/api/village/journey").json()
    assert complete["plan_streak"] == 2
    plan_award = next(item for item in complete["achievements"] if item["code"] == "plan_2")
    assert plan_award["unlocked_at"]

    transaction(first, tx_date="2026-09-20", tx_type="expense", amount_cents=4000)
    changed = first.get("/api/village/journey").json()
    assert changed["plan_streak"] == 1
    plan_award = next(item for item in changed["achievements"] if item["code"] == "plan_2")
    assert plan_award["unlocked_at"] is None


def test_private_links_cas_and_deleted_source(village):
    _, first, other = village
    tx = transaction(first)
    foreign = transaction(other)
    denied = first.post(
        "/api/village/logs",
        json={"event_date": "2026-10-12", "content": "错误关联", "transaction_ids": [tx, foreign]},
    )
    assert denied.status_code == 404
    assert first.get("/api/village/logs").json() == []
    log = record(first, [tx])
    assert other.get(f"/api/village/logs/{log['id']}").status_code == 404
    assert other.get(f"/api/village/events/{tx}").status_code == 404
    other_review = other.get("/api/monthly-reviews/2026-10").json()
    other_review["life_log_ids"] = [log["id"]]
    assert other.put("/api/monthly-reviews/2026-10", json=other_review).status_code == 404
    review = first.get("/api/monthly-reviews/2026-10").json()
    review["life_log_ids"] = [log["id"]]
    saved = first.put("/api/monthly-reviews/2026-10", json=review)
    assert saved.status_code == 200, saved.text
    update = first.put(f"/api/village/logs/{log['id']}", json={**log, "content": "更新的记录"})
    assert update.status_code == 200
    assert first.put(f"/api/village/logs/{log['id']}", json=log).status_code == 409
    assert (
        first.delete(
            f"/api/village/logs/{log['id']}?revision={update.json()['revision']}"
        ).status_code
        == 200
    )
    refs = first.get("/api/monthly-reviews/2026-10").json()["life_logs"]
    assert refs[0]["deleted"] and refs[0]["title"] == "来源已删除"
    assert first.get("/api/village/logs").json() == []


def test_batch_review_whole_request_and_account_link(village):
    _, first, other = village
    own, foreign = transaction(first), transaction(other)
    denied = first.post(
        "/api/village/batch-review", json={"ids": [own, foreign], "category": "交通"}
    )
    assert denied.status_code == 404
    assert first.get("/api/transactions").json()["items"][0]["category"] == "餐饮"
    asset = first.post(
        "/api/users/me/assets",
        json={"name": "钱包", "kind": "asset", "balance_cents": 90000, "as_of": "2026-10-12"},
    ).json()
    result = first.post(
        "/api/village/batch-review",
        json={
            "ids": [own],
            "category": "交通",
            "tx_date": "2026-10-13",
            "account_key": asset["account_key"],
        },
    )
    assert result.status_code == 200, result.text
    linked = first.get("/api/transactions", params={"account_key": asset["account_key"]}).json()[
        "items"
    ]
    assert len(linked) == 1 and linked[0]["reviewed"] and linked[0]["tx_date"] == "2026-10-13"
    assert (
        other.get("/api/transactions", params={"account_key": asset["account_key"]}).json()["items"]
        == []
    )
    assert (
        other.post(
            "/api/transactions",
            json={
                "tx_date": "2026-10-12",
                "tx_type": "expense",
                "amount_cents": 10,
                "merchant": "错误账户",
                "account_key": asset["account_key"],
            },
        ).status_code
        == 422
    )


def test_drafts_are_private_and_conflicts_do_not_overwrite(village):
    _, first, other = village
    path = "/api/village/drafts/life-log/new"
    assert first.put(path, json={"content": {"content": "草稿"}, "revision": 0}).status_code == 200
    assert other.get(path).json()["content"] == {}
    assert (
        other.put(
            path, json={"content": {"content": "旧窗口草稿"}, "revision": 0, "expected_owner_id": 1}
        ).status_code
        == 409
    )
    assert first.put(path, json={"content": {"content": "覆盖"}, "revision": 0}).status_code == 409
    assert first.get(path).json()["content"]["content"] == "草稿"


def test_story_facts_comparison_and_source_privacy(village, monkeypatch):
    engine, first, other = village
    transaction(first, tx_type="income", amount_cents=200000, category="收入")
    transaction(first, amount_cents=60000)
    transaction(first, tx_type="refund", amount_cents=10000)
    transaction(first, tx_type="transfer", amount_cents=900000)
    transaction(first, tx_date="2026-09-12", amount_cents=30000)
    log = record(first, ai_allowed=True)
    private = record(first, content="不允许模型读取的私密内容")
    captured = []

    def generate(messages, *_):
        captured.append(messages)
        return json.dumps({"paragraphs": ["这是根据账本与已授权记录组织的纪事。"] * 5})

    monkeypatch.setattr(ai, "ask", generate)
    with Session(engine) as db:
        job = village_story.queue(db, 1, "2026-10", True, False)
        db.commit()
        village_story.generate(db, job["id"])
        assert db.get(StoryEdition, job["id"]).status == "completed"
    assert private["content"] not in str(captured) and log["content"] in str(captured)
    story_prompt = captured[0][0]["content"]
    assert "## 2. 分析原则" in story_prompt
    assert "## 5. 表达风格" in story_prompt
    assert "## 6. 月度 Story 输出要求" in story_prompt
    assert "自动简报最多输出3条" not in story_prompt
    data = first.get("/api/village/story/2026-10").json()
    assert data["facts"]["expense_cents"] == 50000
    assert data["facts"]["net_flow_cents"] == 150000
    assert data["categories"][0]["previous_cents"] == 30000
    assert len(data["chapters"]) == 5
    assert all(
        any(source["id"] == log["id"] for source in part["sources"]) for part in data["chapters"]
    )
    assert other.get(f"/api/village/story-tasks/{job['id']}").status_code == 404
    assert other.get(f"/api/village/story/2026-10?edition_id={job['id']}").status_code == 404
    assert (
        first.put(f"/api/village/logs/{log['id']}", json={**log, "ai_allowed": False}).status_code
        == 200
    )
    data = first.get("/api/village/story/2026-10").json()
    assert data["stale"] and all("撤销" in part["body"] for part in data["chapters"])


def test_log_tool_and_conversation_revocation(village):
    engine, first, _ = village
    permitted = record(first, ai_allowed=True)
    record(first, content="私密记录")
    with Session(engine) as db:
        with pytest.raises(ValueError):
            life_log_skill.view(db, 1, {"month": "2026-10", "limit": 99}, "conversation")
        response = life_log_skill.view(db, 1, {"month": "2026-10", "limit": 20}, "conversation")
        assert len(response["records"]) == 1 and response["limit"] == 20
        life_log_skill.ensure_history_allowed(db, 1, "conversation")
    first.put(f"/api/village/logs/{permitted['id']}", json={**permitted, "ai_allowed": False})
    with Session(engine) as db:
        with pytest.raises(PermissionError):
            life_log_skill.ensure_history_allowed(db, 1, "conversation")
        ai_ledger_consent.set_enabled(db, 1, False)
        with pytest.raises(PermissionError):
            life_log_skill.view(db, 1, {"month": "2026-10"}, "new")


def test_export_and_account_delete_cover_v2(village):
    engine, first, _ = village
    tx = transaction(first)
    record(first, [tx])
    first.put("/api/village/events/" + str(tx), json={"note": "背景"})
    first.put(
        "/api/village/drafts/workspace/ledger-entry",
        json={"content": {"merchant": "草稿"}, "revision": 0},
    )
    with Session(engine) as db:
        job = village_story.queue(db, 1, "2026-10", False, False)
        db.commit()
    exported = first.get("/api/users/me/export")
    assert exported.status_code == 200
    assert "life_logs" in exported.text and "workspace_drafts" in exported.text
    deleted = first.request("DELETE", "/api/users/me", json={"password": "safe-test-password-123"})
    assert deleted.status_code == 200, deleted.text
    with Session(engine) as db:
        assert db.get(StoryEdition, job["id"]) is None
        assert db.scalar(select(WorkspaceDraft).where(WorkspaceDraft.owner_id == 1)) is None
        assert db.scalar(select(Transaction).where(Transaction.owner_id == 1)) is None
        assert db.scalar(select(StoryPart).where(StoryPart.owner_id == 1)) is None

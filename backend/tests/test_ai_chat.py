import asyncio
import json
from datetime import date
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base, get_db
from app.main import app
from app.models import Setting, Transaction, User
from app.services import ai_agreement, ai_chat, ai_connection, ai_usage, ledger_skill


def test_encrypted_connection_and_streamed_chat(tmp_path: Path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'chat.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    monkeypatch.setenv("AI_API_KEY", "test-secret-key-123")
    monkeypatch.setattr(ai_chat, "SessionLocal", sessionmaker(bind=engine))

    async def fake_upstream(chat: ai_chat.PreparedChat, *, count_call: bool):
        assert chat.thinking is True
        assert [item["role"] for item in chat.messages] == ["system", "user"]
        assert "房租商户" not in str(chat.messages)
        assert "私密账单" not in str(chat.messages)
        yield {"reasoning_content": "先梳理问题。"}
        yield {"content": "可以先查看预算设置。"}

    monkeypatch.setattr(ai_chat, "_upstream", fake_upstream)

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        client = TestClient(app)
        assert (
            client.post(
                "/api/auth/register",
                json={
                    "email": "chat@example.com",
                    "password": "safe-test-password-123",
                    "display_name": "聊天用户",
                },
            ).status_code
            == 200
        )
        with Session(engine) as db:
            db.add(
                Transaction(
                    owner_id=1,
                    tx_date=date(2026, 10, 10),
                    amount_cents=125000,
                    tx_type="expense",
                    merchant="房租商户",
                    description="私密账单",
                    category="居住",
                    confidence=100,
                    classification_reason="",
                    is_fixed=True,
                    source="manual",
                    fingerprint="test-ai-chat-unique",
                )
            )
            db.commit()

        saved = client.get("/api/ai/connection")
        assert saved.json()["configured"] is True
        assert "test-secret-key-123" not in saved.text
        assert client.get("/api/ai/status").json()["consent"] is False
        assert (
            client.post(
                "/api/ai/chat/stream", json={"message": "hello", "thinking": False}
            ).status_code
            == 409
        )
        assert client.post("/api/ai/agreement").json()["accepted"] is True
        with Session(engine) as db:
            assert ai_connection.resolve(db, 1)[0] == "test-secret-key-123"

        response = client.post(
            "/api/ai/chat/stream",
            json={"conversation_id": None, "message": "如何整理预算？", "thinking": True},
        )
        assert response.status_code == 200
        assert "event: reasoning" in response.text
        assert "event: content" in response.text
        assert "event: done" in response.text
        conversations = client.get("/api/ai/conversations").json()
        assert len(conversations) == 1
        detail = client.get(f"/api/ai/conversations/{conversations[0]['id']}").json()
        assert [row["role"] for row in detail["messages"]] == ["user", "assistant"]
        assert detail["messages"][1]["reasoning"] == "先梳理问题。"
        assert detail["messages"][1]["content"] == "可以先查看预算设置。"

        with_ledger = client.post(
            "/api/ai/chat/stream",
            json={"conversation_id": None, "message": "查看我的账单", "thinking": True},
        )
        assert with_ledger.status_code == 200
        assert "event: done" in with_ledger.text
        ledger_conversation = client.get("/api/ai/conversations").json()[0]["id"]
        with Session(engine) as db:
            db.delete(db.get(Setting, (1, ai_agreement.KEY)))
            db.commit()
        blocked = client.post(
            "/api/ai/chat/stream",
            json={"conversation_id": ledger_conversation, "message": "继续", "thinking": True},
        )
        assert blocked.status_code == 409
    finally:
        app.dependency_overrides.clear()


def test_deepseek_stream_contract(monkeypatch):
    seen: dict = {}
    settled = []
    monkeypatch.setattr(ai_usage, "reserve", lambda *_args, **_kwargs: ("2026-11-19", 5000))
    monkeypatch.setattr(ai_usage, "settle", lambda reservation, total: settled.append(total))

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["authorization"] == "Bearer local-test-key"
        body = 'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\n\n'
        body += 'data: {"choices":[{"delta":{"content":"回答"}}]}\n\n'
        body += (
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],'
            '"usage":{"total_tokens":42}}\n\n'
        )
        body += "data: [DONE]\n\n"
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    original = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        ai_chat.httpx,
        "AsyncClient",
        lambda *args, **kwargs: original(*args, transport=transport, **kwargs),
    )
    chat = ai_chat.PreparedChat(
        1,
        "test-session",
        "问题",
        True,
        "问题",
        True,
        "local-test-key",
        "deepseek-flash",
        [{"role": "user", "content": "问题"}],
        False,
    )

    async def collect():
        return [part async for part in ai_chat._upstream(chat, count_call=True)]

    assert asyncio.run(collect()) == [{"reasoning_content": "思考"}, {"content": "回答"}, {}]
    assert settled == [42]
    assert seen["thinking"] == {"type": "enabled"}
    assert seen["stream"] is True
    assert seen["model"] == "deepseek-flash"


def test_invalid_chat_message_and_legacy_connection_recovery(tmp_path: Path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'recovery.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    monkeypatch.setenv("AI_MODEL", "deepseek-chat")
    monkeypatch.setenv("AI_API_KEY", "env-backup-key")

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        client = TestClient(app)
        assert (
            client.post(
                "/api/auth/register",
                json={
                    "email": "recovery@example.com",
                    "password": "safe-test-password-123",
                    "display_name": "恢复用户",
                },
            ).status_code
            == 200
        )
        invalid = client.post(
            "/api/ai/chat/stream",
            json={
                "conversation_id": None,
                "message": "   ",
                "thinking": False,
            },
        )
        assert invalid.status_code == 422
        assert invalid.json()["detail"]["code"] == "INVALID_CHAT_MESSAGE"

        legacy = client.get("/api/ai/connection")
        assert legacy.status_code == 200
        assert legacy.json()["configured"] is True
        assert legacy.json()["model"] == "deepseek-flash"

        assert client.put("/api/ai/connection", json={"api_key": "user-key"}).status_code == 405
        assert client.post("/api/ai/agreement").status_code == 200
        monkeypatch.setenv("AI_API_KEY", "env-backup-key")
        with Session(engine) as db:
            assert ai_connection.resolve(db, 1) == ("env-backup-key", "deepseek-flash")
        assert client.get("/api/ai/connection").json()["configured"] is True
        monkeypatch.setenv("AI_MODEL", "deepseek-v4-pro")
        changed = client.get("/api/ai/connection")
        assert changed.json()["model"] == "deepseek-v4-pro"
        with Session(engine) as db:
            assert ai_connection.resolve(db, 1) == ("env-backup-key", "deepseek-v4-pro")
    finally:
        app.dependency_overrides.clear()


def test_revocation_between_prepare_and_send_keeps_ledger_off_upstream(
    tmp_path: Path,
    monkeypatch,
):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'revocation.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    monkeypatch.setenv("AI_API_KEY", "test-env-key")
    monkeypatch.setattr(ai_chat, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(ai_usage, "reserve", lambda *_args, **_kwargs: ("2026-11-19", 5000))

    with Session(engine) as db:
        ai_agreement.accept(db, 1)
        db.commit()
        prepared = ai_chat.prepare(db, None, "Review my bills", False, 1)
        assert prepared.used_ledger is True
        db.delete(db.get(Setting, (1, ai_agreement.KEY)))
        db.commit()

    upstream_calls = []

    async def fake_upstream(_chat, *, count_call: bool):
        upstream_calls.append(True)
        yield {"content": "should not be sent"}

    async def collect_reply():
        return [event async for event in ai_chat.stream_reply(prepared)]

    with patch.object(ai_chat, "_upstream", fake_upstream):
        events = asyncio.run(collect_reply())
    assert any("event: error" in event for event in events)
    assert upstream_calls == []

    async def collect_upstream():
        return [delta async for delta in ai_chat._upstream(prepared, count_call=True)]

    with pytest.raises(PermissionError):
        asyncio.run(collect_upstream())


def test_ledger_tool_reads_latest_owner_rows_and_excludes_notes(tmp_path: Path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'ledger-tool.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    monkeypatch.setenv("AI_API_KEY", "test-env-key")
    monkeypatch.setattr(ai_chat, "SessionLocal", sessionmaker(bind=engine))
    with Session(engine) as db:
        db.add_all(
            [
                User(id=1, email="one@example.test", display_name="one", password_hash="x"),
                User(id=2, email="two@example.test", display_name="two", password_hash="x"),
            ]
        )
        db.commit()
        ai_agreement.accept(db, 1)
        db.commit()
        prepared = ai_chat.prepare(db, None, "刚记的餐饮账单是什么？", False, 1)
        assert prepared.used_ledger is True
        for owner_id, merchant in [(1, "新记账单"), (2, "他人私账")]:
            db.add(
                Transaction(
                    owner_id=owner_id,
                    tx_date=date(2026, 11, 9),
                    amount_cents=1234,
                    tx_type="expense",
                    merchant=merchant,
                    category="餐饮",
                    description="绝密备注",
                    fingerprint=f"tool-{owner_id}",
                )
            )
        db.commit()
        assert ledger_skill.view_ledger(db, 1, {"category": "餐饮"})["matched_count"] == 1
        assert ledger_skill.view_ledger(db, 1, {"merchant": "新记"})["matched_count"] == 1
        with pytest.raises(ValueError):
            ledger_skill.view_ledger(db, 1, {"limit": 101})
        with pytest.raises(ValueError):
            ledger_skill.view_ledger(db, 1, {"start_date": 9})
        with pytest.raises(ValueError):
            ledger_skill.view_ledger(db, 1, {"tx_type": ["expense"]})

    sent = []

    async def fake_upstream(chat, *, count_call: bool):
        sent.append(chat.messages)
        if len(sent) == 1:
            yield {"content": "我会先查看最新账单。"}
            yield {
                "tool_calls": [
                    {
                        "index": 0,
                        "id": "call_1",
                        "function": {
                            "name": "view_ledger",
                            "arguments": '{"category":"餐饮"}',
                        },
                    }
                ]
            }
        else:
            assert "新记账单" in str(chat.messages)
            assert "我会先查看最新账单。" in str(chat.messages)
            assert "他人私账" not in str(chat.messages)
            assert "绝密备注" not in str(chat.messages)
            yield {"content": "刚记的餐饮账单是新记账单。"}

    monkeypatch.setattr(ai_chat, "_upstream", fake_upstream)

    async def collect():
        return [event async for event in ai_chat.stream_reply(prepared)]

    events = asyncio.run(collect())
    assert len(sent) == 2
    assert "新记账单" not in str(sent[0])
    assert any("event: done" in event for event in events)

"""Persistent conversation and streamed DeepSeek response orchestration."""

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import AsyncIterator
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import ChatConversation, ChatMessage, Setting, Transaction

from . import ai_connection, budget

SYSTEM_PROMPT = (
    "你是 SpendWise 的中文个人财务助手。"
    "只解释用户主动输入和本请求附带的程序数据，不要自行计算或编造金额、余额、预测、增长率和可信度。"
    "需要具体财务数字时，请引导用户查看概览、账本或消费模拟。"
    "回答简洁、务实；不要索取 API Key、密码或完整账单。"
)

LEDGER_SCOPE = (
    "授权后，每次提问会向 api.deepseek.com 发送本月收入、净支出、总预算、预算剩余、账户余额，"
    "以及最近 90 天最多 100 笔账单的"
    "日期、商户、分类、收支类型、金额；不发送账单备注。关闭后不再发送，且不能继续曾使用账单数据的旧对话。"
)


class InvalidChatMessage(ValueError):
    """The user submitted a message without meaningful content."""


def ledger_consent_status(db: Session, owner_id: int) -> dict:
    row = db.get(Setting, (owner_id, "ai_chat_ledger_consent"))
    return {"enabled": row is not None and row.value == "true", "scope": LEDGER_SCOPE}


def set_ledger_consent(db: Session, enabled: bool, owner_id: int) -> dict:
    row = db.get(Setting, (owner_id, "ai_chat_ledger_consent"))
    if row is None:
        row = Setting(owner_id=owner_id, key="ai_chat_ledger_consent", value="false")
        db.add(row)
    row.value = "true" if enabled else "false"
    db.flush()
    return ledger_consent_status(db, owner_id)


def _yuan(cents: int) -> str:
    return f"{Decimal(cents) / 100:.2f}"


def _ledger_context(db: Session, owner_id: int) -> str:
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    month = budget.summary(db, today, owner_id)
    settings = budget.get_settings(db, owner_id)
    rows = db.scalars(
        select(Transaction)
        .where(
            Transaction.owner_id == owner_id,
            Transaction.tx_date.between(today - timedelta(days=90), today),
        )
        .order_by(Transaction.tx_date.desc(), Transaction.id.desc())
        .limit(100)
    ).all()
    bills = [
        {
            "date": row.tx_date.isoformat(),
            "merchant": row.merchant[:100],
            "category": row.category,
            "type": row.tx_type,
            "amount_yuan": _yuan(row.amount_cents),
        }
        for row in rows
    ]
    facts = {
        "as_of": today.isoformat(),
        "month_income_yuan": _yuan(month["income_cents"]),
        "month_net_expense_yuan": _yuan(month["expense_cents"]),
        "month_budget_yuan": _yuan(settings["monthly_budget_cents"]),
        "month_budget_remaining_yuan": _yuan(month["budget_remaining_cents"]),
        "account_balance_yuan": _yuan(month["account_balance_cents"]),
        "recent_bills": bills,
    }
    return "以下是用户单独授权的程序数据；只能引用，不得推导新数字：" + json.dumps(
        facts, ensure_ascii=False
    )


@dataclass(frozen=True)
class PreparedChat:
    owner_id: int
    conversation_id: str
    title: str
    is_new: bool
    message: str
    thinking: bool
    key: str
    model: str
    messages: list[dict[str, str]]
    used_ledger: bool


def prepare(
    db: Session, conversation_id: str | None, message: str, thinking: bool, owner_id: int
) -> PreparedChat:
    clean = message.strip()
    if not clean:
        raise InvalidChatMessage("请输入问题")
    key, model = ai_connection.resolve(db, owner_id)
    is_new = conversation_id is None
    use_ledger = ledger_consent_status(db, owner_id)["enabled"]
    current_id = conversation_id or str(uuid.uuid4())
    history: list[dict[str, str]] = []
    if conversation_id:
        conversation = db.get(ChatConversation, conversation_id)
        if conversation is None or conversation.owner_id != owner_id:
            raise LookupError("对话不存在")
        if conversation.used_ledger and not use_ledger:
            raise PermissionError("已关闭账单授权，请新建对话后继续")
        rows = db.scalars(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            .order_by(ChatMessage.id.desc())
            .limit(16)
        ).all()
        history = [{"role": row.role, "content": row.content} for row in reversed(rows)]
    system_content = (
        SYSTEM_PROMPT
        + "\n"
        + (
            _ledger_context(db, owner_id)
            if use_ledger
            else "本次没有授权读取账单，不得声称已查看用户账本。"
        )
    )
    messages = [
        {"role": "system", "content": system_content},
        *history,
        {"role": "user", "content": clean},
    ]
    return PreparedChat(
        owner_id, current_id, clean[:80], is_new, clean, thinking, key, model, messages, use_ledger
    )


def list_conversations(db: Session, owner_id: int) -> list[dict]:
    rows = db.scalars(
        select(ChatConversation)
        .where(ChatConversation.owner_id == owner_id)
        .order_by(ChatConversation.created_at.desc())
    ).all()
    return [{"id": row.id, "title": row.title, "created_at": row.created_at} for row in rows]


def get_conversation(db: Session, conversation_id: str, owner_id: int) -> dict | None:
    row = db.get(ChatConversation, conversation_id)
    if row is None or row.owner_id != owner_id:
        return None
    messages = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.id)
    ).all()
    return {
        "id": row.id,
        "title": row.title,
        "used_ledger": row.used_ledger,
        "messages": [
            {
                "id": item.id,
                "role": item.role,
                "content": item.content,
                "reasoning": item.reasoning,
                "thinking": item.thinking,
            }
            for item in messages
        ],
    }


def delete_conversation(db: Session, conversation_id: str, owner_id: int) -> bool:
    row = db.get(ChatConversation, conversation_id)
    if row is None or row.owner_id != owner_id:
        return False
    messages = db.scalars(select(ChatMessage).where(ChatMessage.conversation_id == conversation_id))
    for item in messages:
        db.delete(item)
    db.delete(row)
    return True


async def _upstream(chat: PreparedChat) -> AsyncIterator[dict]:
    payload = {
        "model": chat.model,
        "messages": chat.messages,
        "thinking": {"type": "enabled" if chat.thinking else "disabled"},
        "stream": True,
        "max_tokens": 4096,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10)) as client:
        if chat.used_ledger:
            with SessionLocal() as db:
                if not ledger_consent_status(db, chat.owner_id)["enabled"]:
                    raise PermissionError("账单授权已关闭，请重新发起不含账本的新对话")
        async with client.stream(
            "POST",
            f"{ai_connection.DEEPSEEK_URL}/chat/completions",
            headers={"Authorization": f"Bearer {chat.key}"},
            json=payload,
        ) as response:
            if response.status_code >= 400:
                raise ValueError(f"DeepSeek 请求失败（HTTP {response.status_code}）")
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    return
                try:
                    item = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if item.get("choices"):
                    yield item["choices"][0].get("delta") or {}


def _event(kind: str, payload: dict) -> str:
    return f"event: {kind}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _persist(chat: PreparedChat, answer: str, reasoning: str) -> None:
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        if chat.is_new:
            db.add(
                ChatConversation(
                    id=chat.conversation_id,
                    owner_id=chat.owner_id,
                    title=chat.title,
                    created_at=now,
                    used_ledger=chat.used_ledger,
                )
            )
        else:
            conversation = db.get(ChatConversation, chat.conversation_id)
            if conversation is None or conversation.owner_id != chat.owner_id:
                raise ValueError("对话已被删除")
            conversation.used_ledger = conversation.used_ledger or chat.used_ledger
        db.add_all(
            [
                ChatMessage(
                    conversation_id=chat.conversation_id,
                    role="user",
                    content=chat.message,
                    reasoning="",
                    thinking=chat.thinking,
                    created_at=now,
                ),
                ChatMessage(
                    conversation_id=chat.conversation_id,
                    role="assistant",
                    content=answer,
                    reasoning=reasoning,
                    thinking=chat.thinking,
                    created_at=now,
                ),
            ]
        )
        db.commit()


async def stream_reply(chat: PreparedChat) -> AsyncIterator[str]:
    answer = ""
    reasoning = ""
    phase = "connecting"
    yield _event("status", {"phase": phase})
    try:
        if chat.used_ledger:
            with SessionLocal() as db:
                if not ledger_consent_status(db, chat.owner_id)["enabled"]:
                    raise PermissionError("账单授权已关闭，请重新发起不含账本的新对话")
        async for delta in _upstream(chat):
            thought = delta.get("reasoning_content") or ""
            content = delta.get("content") or ""
            if thought:
                if phase != "thinking":
                    phase = "thinking"
                    yield _event("status", {"phase": phase})
                reasoning += thought
                yield _event("reasoning", {"text": thought})
            if content:
                if phase != "answering":
                    phase = "answering"
                    yield _event("status", {"phase": phase})
                answer += content
                yield _event("content", {"text": content})
        if not answer.strip():
            raise ValueError("DeepSeek 没有返回回答，请重试")
        _persist(chat, answer, reasoning)
        yield _event("done", {"conversation_id": chat.conversation_id})
    except (httpx.HTTPError, PermissionError, ValueError) as exc:
        yield _event("error", {"message": str(exc)})
    except SQLAlchemyError:
        yield _event("error", {"message": "对话保存失败，请重试"})

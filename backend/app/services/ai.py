import json

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Transaction

from . import ai_connection
from .budget import get_settings

ALLOWED = {"餐饮", "交通", "购物", "居住", "医疗健康", "娱乐", "旅行", "通讯", "其他"}


def enabled(db: Session, owner_id: int) -> bool:
    return (
        get_settings(db, owner_id)["ai_consent"]
        and ai_connection.status(db, owner_id)["configured"]
    )


def ask(messages: list[dict], db: Session, owner_id: int) -> str:
    key, model = ai_connection.resolve(db, owner_id)
    response = httpx.post(
        f"{ai_connection.DEEPSEEK_URL}/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": model,
            "messages": messages,
            "thinking": {"type": "disabled"},
        },
        timeout=20,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def review(db: Session, ids: list[int], owner_id: int) -> list[dict]:
    if not enabled(db, owner_id):
        raise ValueError("请先授权并配置 AI 连接")
    items = db.scalars(
        select(Transaction)
        .where(Transaction.owner_id == owner_id, Transaction.id.in_(ids))
        .limit(30)
    ).all()
    # Never send amounts, account balances, or full ledger history.
    payload = [
        {"id": x.id, "merchant": x.merchant[:100], "description": x.description[:100]}
        for x in items
    ]
    answer = ask(
        [
            {
                "role": "system",
                "content": "仅对商户文本分类。返回 JSON 数组，每项包含 id 和 category。允许分类："
                + "、".join(sorted(ALLOWED))
                + "。不得生成金额。",
            },
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        db,
        owner_id,
    )
    try:
        parsed = json.loads(answer)
    except json.JSONDecodeError as exc:
        raise ValueError("AI 返回无效 JSON，请人工分类") from exc
    valid_ids = {x.id for x in items}
    return [
        {"id": int(x["id"]), "category": x["category"], "reason": "AI 建议，等待人工确认"}
        for x in parsed
        if isinstance(x, dict) and x.get("id") in valid_ids and x.get("category") in ALLOWED
    ]

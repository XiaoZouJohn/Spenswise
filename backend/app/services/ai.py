import json

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Transaction

from . import ai_connection
from .budget import get_settings

ALLOWED = {
    "餐饮",
    "交通",
    "购物",
    "居住",
    "医疗健康",
    "娱乐",
    "旅行",
    "通讯",
    "教育",
    "日用品",
    "人情往来",
    "收入",
    "退款",
    "转账",
    "其他",
}


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


def _review_items(db: Session, items: list[Transaction], owner_id: int) -> list[dict]:
    # Never send amounts, account balances, or full ledger history.
    payload = [
        {
            "id": x.id,
            "type": x.tx_type,
            "merchant": x.merchant[:100],
            "description": x.description[:100],
        }
        for x in items
    ]
    answer = ask(
        [
            {
                "role": "system",
                "content": "仅根据交易类型、商户和商品文本进行消费分类。"
                "只返回 JSON 数组，不要使用 Markdown。每项必须包含 id、category、"
                "confidence（0-100 整数）和 reason（不超过 30 个字）。允许分类："
                + "、".join(sorted(ALLOWED))
                + "。支出优先根据商户用途分类；收入、退款和转账按交易类型分类。"
                "不得生成或推测金额。",
            },
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        db,
        owner_id,
    )
    cleaned = answer.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```json").removeprefix("```")
        cleaned = cleaned.removesuffix("```").strip()
    start, end = cleaned.find("["), cleaned.rfind("]")
    if start >= 0 and end >= start:
        cleaned = cleaned[start : end + 1]
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError("AI 返回无效 JSON，请人工分类") from exc
    if not isinstance(parsed, list):
        raise ValueError("AI 返回的分类结果不完整，请重试")
    by_id = {x.id: x for x in items}
    suggestions = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        try:
            item_id = int(item.get("id"))
            confidence = max(0, min(100, int(item.get("confidence", 0))))
        except (TypeError, ValueError):
            continue
        category = str(item.get("category", "")).strip()
        if item_id not in by_id or category not in ALLOWED:
            continue
        transaction = by_id[item_id]
        reason = str(item.get("reason", "AI 建议，等待人工确认")).strip()[:80]
        suggestions.append(
            {
                "id": item_id,
                "category": category,
                "confidence": confidence,
                "reason": reason or "AI 建议，等待人工确认",
                "merchant": transaction.merchant,
                "description": transaction.description,
                "current_category": transaction.category,
            }
        )
    return suggestions


def review(db: Session, ids: list[int], owner_id: int) -> list[dict]:
    if not enabled(db, owner_id):
        raise ValueError("请先授权并配置 AI 连接")
    unique_ids = list(dict.fromkeys(ids))
    if not unique_ids:
        raise ValueError("请至少选择一笔账单")
    if len(unique_ids) > 30:
        raise ValueError("每次最多请 AI 分类 30 笔账单")
    items = list(
        db.scalars(
            select(Transaction)
            .where(Transaction.owner_id == owner_id, Transaction.id.in_(unique_ids))
            .limit(30)
        ).all()
    )
    return _review_items(db, items, owner_id)


def review_all(db: Session, owner_id: int) -> dict:
    if not enabled(db, owner_id):
        raise ValueError("请先授权并配置 AI 连接")
    items = list(
        db.scalars(
            select(Transaction).where(Transaction.owner_id == owner_id).order_by(Transaction.id)
        ).all()
    )
    if not items:
        return {"suggestions": [], "total": 0, "groups_reviewed": 0}

    # Repeated merchants/products share one DeepSeek call and then receive the
    # same suggestion. This keeps a one-click full-ledger review fast and cheap.
    groups: dict[tuple[str, str, str], list[Transaction]] = {}
    for item in items:
        key = (
            item.tx_type.strip().lower(),
            " ".join(item.merchant.strip().lower().split()),
            " ".join(item.description.strip().lower().split()),
        )
        groups.setdefault(key, []).append(item)

    representatives = [rows[0] for rows in groups.values()]
    representative_suggestions: dict[int, dict] = {}
    for start in range(0, len(representatives), 30):
        batch = representatives[start : start + 30]
        for suggestion in _review_items(db, batch, owner_id):
            representative_suggestions[suggestion["id"]] = suggestion

    suggestions = []
    for rows in groups.values():
        suggestion = representative_suggestions.get(rows[0].id)
        if not suggestion:
            continue
        for row in rows:
            suggestions.append(
                {
                    **suggestion,
                    "id": row.id,
                    "merchant": row.merchant,
                    "description": row.description,
                    "current_category": row.category,
                }
            )
    suggestions.sort(key=lambda item: item["id"])
    return {
        "suggestions": suggestions,
        "total": len(items),
        "groups_reviewed": len(representatives),
    }


def apply_suggestions(db: Session, suggestions: list[dict], owner_id: int) -> dict:
    if not enabled(db, owner_id):
        raise ValueError("请先授权并配置 AI 连接")
    ids = [int(item["id"]) for item in suggestions]
    rows = []
    # Keep the save action compatible with SQLite builds that cap the number of
    # bound variables in a single IN query.
    for start in range(0, len(ids), 500):
        rows.extend(
            db.scalars(
                select(Transaction).where(
                    Transaction.owner_id == owner_id,
                    Transaction.id.in_(ids[start : start + 500]),
                )
            ).all()
        )
    by_id = {row.id: row for row in rows}
    if len(by_id) != len(ids):
        raise ValueError("部分账单不存在或不属于当前账号")

    before = []
    for suggestion in suggestions:
        row = by_id[int(suggestion["id"])]
        category = str(suggestion["category"]).strip()
        if category not in ALLOWED:
            raise ValueError(f"不支持的 AI 分类：{category}")
        before.append(
            {
                "id": row.id,
                "category": row.category,
                "confidence": row.confidence,
                "classification_reason": row.classification_reason,
            }
        )
        row.category = category
        row.confidence = max(0, min(100, int(suggestion["confidence"])))
        reason = str(suggestion.get("reason") or "AI 分类").strip()[:200]
        row.classification_reason = f"DeepSeek：{reason}"
    db.flush()
    return {"updated": len(rows), "before": before}

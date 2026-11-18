"""The shared AI ledger permission plus per-record opt-in controls life-log reads."""

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LifeLog, Setting

from . import ai_ledger_consent
from . import village_life as life

TOOL = {
    "type": "function",
    "function": {
        "name": "view_life_logs",
        "description": "按月份读取本人明确允许AI使用的生活记录，最多20条。没有授权的日志不会返回。",
        "parameters": {
            "type": "object",
            "properties": {
                "month": {"type": "string", "description": "YYYY-MM"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
                "log_id": {
                    "type": "string",
                    "description": "可选，按明确的记录ID读取；仍校验本人归属及逐篇许可",
                },
            },
            "required": ["month"],
            "additionalProperties": False,
        },
    },
}


def ensure_history_allowed(db: Session, owner_id: int, conversation_id: str):
    row = db.get(Setting, (owner_id, f"chat_log_sources:{conversation_id}"))
    if row:
        for source in json.loads(row.value):
            log = db.scalar(
                select(LifeLog).where(LifeLog.owner_id == owner_id, LifeLog.id == source["id"])
            )
            if (
                log is None
                or log.deleted
                or not log.ai_allowed
                or log.revision != source["revision"]
            ):
                raise PermissionError("对话引用的生活记录已变更或撤销许可，请开启新对话")


def view(db: Session, owner_id: int, arguments: dict, conversation_id: str):
    if not ai_ledger_consent.enabled(db, owner_id):
        raise PermissionError("AI 账本授权已关闭")
    if not isinstance(arguments, dict) or set(arguments) - {"month", "limit", "log_id"}:
        raise ValueError("生活记录筛选无效")
    limit = arguments.get("limit", 10)
    if type(limit) is not int or not 1 <= limit <= 20:
        raise ValueError("最多读取20条生活记录")
    start, end = life.period(arguments.get("month", ""))
    selected_id = arguments.get("log_id")
    if selected_id is not None and not isinstance(selected_id, str):
        raise ValueError("记录ID无效")
    rows = list(
        db.scalars(
            select(LifeLog)
            .where(
                LifeLog.owner_id == owner_id,
                LifeLog.deleted.is_(False),
                LifeLog.ai_allowed.is_(True),
                LifeLog.event_date.between(start, end),
                *([LifeLog.id == selected_id] if selected_id else []),
            )
            .order_by(LifeLog.event_date.desc())
            .limit(limit)
        )
    )
    key = f"chat_log_sources:{conversation_id}"
    saved = db.get(Setting, (owner_id, key))
    previous = json.loads(saved.value) if saved else []
    sources = {source["id"]: source for source in previous}
    sources.update({row.id: {"id": row.id, "revision": row.revision} for row in rows})
    if rows:
        encoded = json.dumps(list(sources.values()))
        if saved:
            saved.value = encoded
        else:
            db.add(Setting(owner_id=owner_id, key=key, value=encoded))
        db.commit()
    return {
        "records": [
            {
                "id": row.id,
                "date": row.event_date.isoformat(),
                "title": row.title,
                "content": row.content[:1200],
            }
            for row in rows
        ],
        "limit": limit,
    }

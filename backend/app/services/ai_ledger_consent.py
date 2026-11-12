"""One owner-scoped ledger permission shared by chat and Agent briefings."""

import threading

from sqlalchemy.orm import Session

from app.models import Setting

_locks = [threading.Lock() for _ in range(64)]


def owner_lock(owner_id: int) -> threading.Lock:
    return _locks[owner_id % len(_locks)]


def enabled(db: Session, owner_id: int) -> bool:
    row = db.get(Setting, (owner_id, "ai_chat_ledger_consent"))
    return row is None or row.value == "true"


def set_enabled(db: Session, owner_id: int, value: bool) -> None:
    with owner_lock(owner_id):
        db.rollback()
        row = db.get(Setting, (owner_id, "ai_chat_ledger_consent"))
        if row is None:
            row = Setting(owner_id=owner_id, key="ai_chat_ledger_consent", value="false")
            db.add(row)
        row.value = "true" if value else "false"
        cache = db.get(Setting, (owner_id, "agent_cache"))
        if cache is not None:
            db.delete(cache)
        db.commit()

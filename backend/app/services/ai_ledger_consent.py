"""Compatibility helpers for the single AI usage agreement."""

import threading

from sqlalchemy.orm import Session

from . import ai_agreement

_locks = [threading.Lock() for _ in range(64)]


def owner_lock(owner_id: int) -> threading.Lock:
    return _locks[owner_id % len(_locks)]


def enabled(db: Session, owner_id: int) -> bool:
    return ai_agreement.accepted(db, owner_id)

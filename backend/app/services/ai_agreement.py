"""Versioned AI service agreement accepted per account."""

from sqlalchemy.orm import Session

from app.models import Setting

VERSION = "1"
KEY = "ai_usage_agreement_version"


def accepted(db: Session, owner_id: int) -> bool:
    row = db.get(Setting, (owner_id, KEY))
    return row is not None and row.value == VERSION


def accept(db: Session, owner_id: int) -> None:
    row = db.get(Setting, (owner_id, KEY))
    if row is None:
        db.add(Setting(owner_id=owner_id, key=KEY, value=VERSION))
    else:
        row.value = VERSION

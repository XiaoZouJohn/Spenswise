import calendar
import json
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Setting
from app.services import budget, ledger


def read(db: Session, owner_id: int, month: str) -> dict:
    year, number = map(int, month.split("-"))
    end = date(year, number, calendar.monthrange(year, number)[1])
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    before_version = ledger.version(db, owner_id)
    facts = budget.summary(
        db, min(end, today) if month == today.strftime("%Y-%m") else end, owner_id
    )
    version = ledger.version(db, owner_id)
    if version != before_version:
        raise ValueError("账本正在更新，请稍后重新读取")
    row = db.get(Setting, (owner_id, f"monthly_review:{month}"))
    stored = json.loads(row.value) if row else {}
    from .village_life import review_log_refs

    refs = stored.get("life_log_ids", [])
    return {
        "month": month,
        "revision": stored.get("revision", 0),
        "notes": stored.get("notes", ""),
        "constraints": stored.get("constraints", ""),
        "differences": stored.get("differences", ""),
        "saved_at": stored.get("saved_at"),
        "ledger_version": version,
        "saved_ledger_version": stored.get("ledger_version"),
        "ledger_changed": bool(
            stored.get("ledger_version") and stored["ledger_version"] != version
        ),
        "saved_facts": stored.get("facts"),
        "facts": facts,
        "life_log_ids": refs,
        "life_logs": review_log_refs(db, owner_id, refs),
    }


def save(db: Session, owner_id: int, month: str, value: dict, *, clear: bool = False) -> dict:
    from .village_life import review_log_refs

    review_log_refs(db, owner_id, value.get("life_log_ids", []))
    current = read(db, owner_id, month)
    if current["revision"] != value["revision"]:
        raise ValueError("盘点已在其他窗口更新，请重新读取后合并修改")
    if not clear and current["ledger_version"] != value["ledger_version"]:
        raise ValueError("账本已更新，请刷新事实后重新确认保存")
    key = f"monthly_review:{month}"
    stored = {
        "revision": current["revision"] + 1,
        "notes": "" if clear else value["notes"],
        "constraints": "" if clear else value["constraints"],
        "differences": "" if clear else value["differences"],
        "saved_at": None if clear else datetime.now(timezone.utc).isoformat(),
        "ledger_version": None if clear else current["ledger_version"],
        "facts": None if clear else current["facts"],
        "life_log_ids": [] if clear else value.get("life_log_ids", []),
    }
    encoded = json.dumps(stored, ensure_ascii=False, sort_keys=True)
    row = db.get(Setting, (owner_id, key))
    if row:
        result = db.execute(
            update(Setting)
            .where(
                Setting.owner_id == owner_id,
                Setting.key == key,
                Setting.value == row.value,
            )
            .values(value=encoded)
        )
        if result.rowcount != 1:
            raise ValueError("盘点已更新，请重新读取")
        db.expire(row)
    else:
        db.add(Setting(owner_id=owner_id, key=key, value=encoded))
    db.flush()
    return read(db, owner_id, month)

"""Account-owned onboarding progress and evidence-based village keepsakes."""

import calendar
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import LifeLog, Setting, Transaction
from app.services import budget

KEY = "village_onboarding:v1"
TIPS = {"ledger", "story", "assistant"}
LOGIN_KEY = "village_login:v1"
SHANGHAI = ZoneInfo("Asia/Shanghai")


def record_login(db: Session, owner_id: int) -> None:
    """Count one authenticated login per Shanghai calendar day."""
    row = db.get(Setting, (owner_id, LOGIN_KEY))
    progress = json.loads(row.value) if row else {}
    today = datetime.now(SHANGHAI).date()
    last = date.fromisoformat(progress["last_date"]) if progress.get("last_date") else None
    if last == today:
        return
    streak = progress.get("streak", 0) + 1 if last == today - timedelta(days=1) else 1
    awards = progress.get("awards", {})
    for target in (3, 7):
        if streak >= target:
            awards.setdefault(str(target), datetime.now(SHANGHAI).isoformat())
    encoded = json.dumps({"last_date": today.isoformat(), "streak": streak, "awards": awards})
    if row:
        row.value = encoded
    else:
        db.add(Setting(owner_id=owner_id, key=LOGIN_KEY, value=encoded))
    db.flush()


def _plans(db: Session, owner_id: int) -> tuple[int, dict[int, datetime | None]]:
    """Closed months with an explicitly configured spending plan and a saved review."""
    today = datetime.now(SHANGHAI).date()
    passed: dict[str, datetime] = {}
    for row in db.scalars(
        select(Setting).where(Setting.owner_id == owner_id, Setting.key.like("monthly_review:%"))
    ):
        try:
            month = row.key.removeprefix("monthly_review:")
            year, number = map(int, month.split("-"))
            if not 1 <= number <= 12 or (year, number) >= (today.year, today.month):
                continue
            review = json.loads(row.value)
            facts = review.get("facts") or {}
            end = date(year, number, calendar.monthrange(year, number)[1])
            actual = budget.summary(db, end, owner_id)
            target = facts.get("expense_cents", 0) + facts.get("budget_remaining_cents", -1)
            if (
                review.get("saved_at")
                and review.get("budget_configured")
                and actual["transaction_count"] > 0
                and actual["net_flow_cents"] >= 0
                and actual["expense_cents"] <= target
            ):
                passed[month] = datetime.fromisoformat(review["saved_at"])
        except (ValueError, TypeError, AttributeError, KeyError):
            continue
    run = 0
    best = 0
    unlocked: dict[int, datetime | None] = {2: None, 3: None}
    previous: tuple[int, int] | None = None
    for month, saved_at in sorted(passed.items()):
        year, number = map(int, month.split("-"))
        expected = (year - 1, 12) if number == 1 else (year, number - 1)
        run = run + 1 if previous == expected else 1
        best = max(best, run)
        previous = (year, number)
        for target in (2, 3):
            if run >= target and unlocked[target] is None:
                end = date(year, number, calendar.monthrange(year, number)[1])
                end_at = datetime(end.year, end.month, end.day, 23, 59, tzinfo=SHANGHAI)
                unlocked[target] = max(saved_at, end_at)
    return best, unlocked


def read(db: Session, owner_id: int) -> dict:
    row = db.get(Setting, (owner_id, KEY))
    progress = json.loads(row.value) if row else {}
    transaction = db.scalar(
        select(func.min(Transaction.created_at)).where(Transaction.owner_id == owner_id)
    )
    logs = db.scalars(
        select(LifeLog.created_at)
        .where(LifeLog.owner_id == owner_id, LifeLog.deleted.is_(False))
        .order_by(LifeLog.created_at)
    ).all()
    login_row = db.get(Setting, (owner_id, LOGIN_KEY))
    login = json.loads(login_row.value) if login_row else {}
    today = datetime.now(SHANGHAI).date()
    last = date.fromisoformat(login["last_date"]) if login.get("last_date") else None
    login_streak = login.get("streak", 0) if last in (today, today - timedelta(days=1)) else 0
    plan_streak, plan_awards = _plans(db, owner_id)
    dismissed = bool(progress.get("welcome_dismissed", False))
    return {
        "revision": progress.get("revision", 0),
        "welcome_dismissed": dismissed,
        "show_welcome": not dismissed and (transaction is None or bool(progress.get("replay"))),
        "tour_step": progress.get("tour_step", 0),
        "seen_tips": [
            tip for tip in ("ledger", "story", "assistant") if tip in progress.get("seen_tips", [])
        ],
        "has_transactions": transaction is not None,
        "login_streak": login_streak,
        "log_count": len(logs),
        "plan_streak": plan_streak,
        "achievements": [
            {"code": "login_3", "unlocked_at": login.get("awards", {}).get("3")},
            {"code": "login_7", "unlocked_at": login.get("awards", {}).get("7")},
            {"code": "logs_1", "unlocked_at": logs[0] if logs else None},
            {"code": "logs_5", "unlocked_at": logs[4] if len(logs) >= 5 else None},
            {"code": "plan_2", "unlocked_at": plan_awards[2]},
            {"code": "plan_3", "unlocked_at": plan_awards[3]},
        ],
    }


def update_progress(db: Session, owner_id: int, value: dict) -> dict:
    row = db.get(Setting, (owner_id, KEY))
    current = json.loads(row.value) if row else {}
    if current.get("revision", 0) != value["revision"]:
        raise ValueError("引导状态已更新，请重新读取")
    if value.get("replay"):
        current["welcome_dismissed"] = False
        current["seen_tips"] = []
        current["replay"] = True
        current["tour_step"] = 0
    if value.get("dismiss_welcome"):
        current["welcome_dismissed"] = True
        current["replay"] = False
    if value.get("tour_step") is not None:
        current["tour_step"] = value["tour_step"]
    tip = value.get("seen_tip")
    if tip:
        if tip not in TIPS:
            raise ValueError("未知引导步骤")
        current["seen_tips"] = list(set(current.get("seen_tips", [])) | {tip})
    current["revision"] = value["revision"] + 1
    encoded = json.dumps(current, ensure_ascii=False, sort_keys=True)
    if row:
        result = db.execute(
            update(Setting)
            .where(Setting.owner_id == owner_id, Setting.key == KEY, Setting.value == row.value)
            .values(value=encoded)
        )
        if result.rowcount != 1:
            raise ValueError("引导状态已更新，请重新读取")
        db.expire(row)
    else:
        db.add(Setting(owner_id=owner_id, key=KEY, value=encoded))
    db.flush()
    return read(db, owner_id)

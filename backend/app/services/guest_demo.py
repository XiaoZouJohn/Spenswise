"""Create an isolated, synthetic ledger for a visitor session."""

import secrets
from datetime import datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models import User
from app.schemas import TransactionIn

from . import budget, ledger

GUEST_DOMAIN = "guest.spendwise.invalid"
TransactionType = Literal["expense", "income", "transfer", "refund"]


def is_guest(user: User | None) -> bool:
    return user is not None and user.email.endswith("@" + GUEST_DOMAIN)


def create(db: Session) -> User:
    user = User(
        email=f"{secrets.token_hex(16)}@{GUEST_DOMAIN}",
        display_name="游客村民",
        password_hash="!",
    )
    db.add(user)
    db.flush()
    budget.save_settings(
        db, {"monthly_budget_cents": 650000, "opening_balance_cents": 1600000}, user.id
    )
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    for offset in range(89, -1, -1):
        day = today - timedelta(days=offset)
        rows: list[tuple[int, TransactionType, str, str]] = []
        if day.day == 3:
            rows.append((880000, "income", "工资收入", "收入"))
        if day.day == 5:
            rows.append((210000, "expense", "房租", "居住"))
        if day.weekday() < 5:
            rows.append((2500 + day.day % 4 * 350, "expense", "日常餐饮", "餐饮"))
        if day.weekday() in (1, 4):
            rows.append((650, "expense", "地铁出行", "交通"))
        if day.day in (12, 23):
            rows.append((6800 + day.month * 100, "expense", "生活采购", "购物"))
        for amount, kind, merchant, category in rows:
            ledger.add_transaction(
                db,
                TransactionIn(
                    tx_date=day,
                    amount_cents=amount,
                    tx_type=kind,
                    merchant=merchant,
                    category=category,
                ),
                source="demo",
                owner_id=user.id,
            )
    return user

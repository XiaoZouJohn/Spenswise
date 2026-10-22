"""Deterministic, idempotent demo data relative to local today."""

import argparse
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.schemas import TransactionIn
from app.services.budget import save_settings
from app.services.ledger import add_transaction


def main(owner_email: str) -> None:
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    inserted = 0
    with SessionLocal.begin() as db:
        owner = db.scalar(
            select(User).where(
                User.email == owner_email.lower().strip(), User.is_legacy_placeholder.is_(False)
            )
        )
        if owner is None:
            raise ValueError("目标用户不存在，请先注册真实账号")
        save_settings(
            db, {"opening_balance_cents": 800000, "monthly_budget_cents": 350000}, owner.id
        )
        for offset in range(88, -1, -1):
            day = today - timedelta(days=offset)
            if day.day == 5:
                _, ok = add_transaction(
                    db,
                    TransactionIn(
                        tx_date=day,
                        amount_cents=120000,
                        merchant="安居公寓",
                        category="居住",
                        is_fixed=True,
                    ),
                    source="demo",
                    owner_id=owner.id,
                )
                inserted += ok
            if day.day == 12:
                _, ok = add_transaction(
                    db,
                    TransactionIn(
                        tx_date=day,
                        amount_cents=3200,
                        merchant="通讯服务",
                        category="通讯",
                        is_fixed=True,
                    ),
                    source="demo",
                    owner_id=owner.id,
                )
                inserted += ok
            if day.day == 1:
                _, ok = add_transaction(
                    db,
                    TransactionIn(
                        tx_date=day,
                        amount_cents=450000,
                        tx_type="income",
                        merchant="工资",
                        category="收入",
                    ),
                    source="demo",
                    owner_id=owner.id,
                )
                inserted += ok
            if day.weekday() < 5:
                _, ok = add_transaction(
                    db,
                    TransactionIn(
                        tx_date=day,
                        amount_cents=1800 + day.day % 5 * 200,
                        merchant=f"餐饮 {day.day}",
                        category="餐饮",
                    ),
                    source="demo",
                    owner_id=owner.id,
                )
                inserted += ok
            if day.weekday() in (1, 4):
                _, ok = add_transaction(
                    db,
                    TransactionIn(
                        tx_date=day, amount_cents=900, merchant=f"地铁 {day.day}", category="交通"
                    ),
                    source="demo",
                    owner_id=owner.id,
                )
                inserted += ok
    print({"inserted": inserted})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner-email", required=True)
    args = parser.parse_args()
    main(args.owner_email)

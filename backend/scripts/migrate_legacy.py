"""Read a legacy SQLite database without modifying it; import idempotently."""

import argparse
import sqlite3
from datetime import date
from pathlib import Path

from sqlalchemy import select

from app.db import SessionLocal
from app.models import MerchantRule, User
from app.schemas import TransactionIn
from app.services.budget import save_settings
from app.services.ledger import add_transaction


def migrate(path: Path, owner_email: str) -> dict:
    source = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    inserted = duplicates = 0
    with SessionLocal.begin() as db:
        owner = db.scalar(
            select(User).where(
                User.email == owner_email.lower().strip(), User.is_legacy_placeholder.is_(False)
            )
        )
        if owner is None:
            raise ValueError("目标用户不存在，请先注册真实账号")
        for old in source.execute("SELECT * FROM transactions ORDER BY id"):
            item = TransactionIn(
                tx_date=date.fromisoformat(old["tx_date"]),
                amount_cents=int(old["amount_cents"]),
                tx_type=old["tx_type"],
                merchant=old["merchant"],
                description=old["description"],
                category=old["category"],
                is_fixed=bool(old["is_fixed"]),
            )
            _, created = add_transaction(db, item, source=f"legacy:{path.name}", owner_id=owner.id)
            inserted += int(created)
            duplicates += int(not created)
        for old in source.execute("SELECT merchant_pattern, category FROM merchant_rules"):
            if not db.scalar(
                select(MerchantRule).where(
                    MerchantRule.owner_id == owner.id,
                    MerchantRule.merchant_pattern == old["merchant_pattern"],
                )
            ):
                db.add(
                    MerchantRule(
                        owner_id=owner.id,
                        merchant_pattern=old["merchant_pattern"],
                        category=old["category"],
                    )
                )
        settings = {
            row["key"]: row["value"] for row in source.execute("SELECT key,value FROM settings")
        }
        if "monthly_budget_cents" in settings:
            save_settings(
                db, {"monthly_budget_cents": int(settings["monthly_budget_cents"])}, owner.id
            )
    source.close()
    return {"source": str(path), "inserted": inserted, "duplicates": duplicates}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner-email", required=True)
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()
    for path in args.paths:
        print(migrate(path, args.owner_email))

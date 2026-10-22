"""Replay the user and asset migrations against a populated pre-family database."""

import sqlite3
from datetime import date
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import HouseholdMember
from app.services.households import _coverage


def test_old_ledger_survives_family_and_asset_migrations(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    database = tmp_path / "legacy.sqlite3"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database.as_posix()}")
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    command.upgrade(config, "0004")

    with sqlite3.connect(database) as db:
        db.execute(
            "INSERT INTO transactions (id,tx_date,amount_cents,tx_type,merchant,description,"
            "category,confidence,classification_reason,is_fixed,source,fingerprint,created_at) "
            "VALUES (7,'2026-09-30',12345,'expense','旧商户','','餐饮',100,'手工',0,"
            "'manual',?,'2026-09-30')",
            ("f" * 64,),
        )
        db.execute("INSERT INTO settings (key,value) VALUES ('monthly_budget_cents','50000')")
        db.execute("INSERT INTO category_budgets (category,limit_cents) VALUES ('餐饮',20000)")
        db.commit()

    command.upgrade(config, "0006")
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT owner_id,amount_cents FROM transactions WHERE id=7"
        ).fetchone() == (1, 12345)
        assert db.execute("SELECT owner_id,value FROM settings").fetchone() == (1, "50000")
        assert db.execute("SELECT owner_id,limit_cents FROM category_budgets").fetchone() == (
            1,
            20000,
        )
        db.execute(
            "INSERT INTO asset_snapshots (owner_id,account_key,name,kind,balance_cents,"
            "as_of,include_in_family,family_household_id,is_cash_account,archived) "
            "VALUES (1,'old-account','旧资产','asset',1000,'2026-09-30',0,NULL,0,0)"
        )
        db.execute("INSERT INTO households (id,name,created_at) VALUES (1,'旧家庭','2026-09-30')")
        db.execute(
            "INSERT INTO household_members (user_id,household_id,role,share_transactions,"
            "share_from,joined_at) VALUES (1,1,'leader',1,'2026-09-30','2026-09-30')"
        )
        db.execute(
            "INSERT INTO asset_snapshots (owner_id,account_key,name,kind,ownership,"
            "balance_cents,as_of,include_in_family,family_household_id,is_cash_account,archived) "
            "VALUES (1,'old-joint','旧共有账户','asset','joint',2000,'2026-09-30',1,1,0,0)"
        )
        db.execute(
            "INSERT INTO settings (owner_id,key,value) "
            "VALUES (1,'family_asset_coverage_confirmed','true')"
        )
        db.commit()

    command.upgrade(config, "head")
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT version_num FROM alembic_version").fetchone() == ("0007",)
        assert db.execute(
            "SELECT ownership,shared_account_key FROM asset_snapshots "
            "WHERE account_key='old-account'"
        ).fetchone() == ("individual", None)
        assert db.execute(
            "SELECT ownership,shared_account_key FROM asset_snapshots "
            "WHERE account_key='old-joint'"
        ).fetchone() == ("joint", None)

    engine = create_engine(f"sqlite:///{database.as_posix()}")
    with Session(engine) as session:
        leader = session.get(HouseholdMember, 1)
        assert leader is not None
        _, net, details = _coverage(session, leader, date(2026, 9, 30))
        assert net is None
        assert "缺少共享标识" in details[0]["reason"]

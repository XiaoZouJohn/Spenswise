from datetime import date

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Transaction, User
from app.schemas import TransactionIn
from app.services import ledger


def test_ledger_filters_and_deletion(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'ledger-management.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(User(id=1, email="ledger@example.com", display_name="账本测试", password_hash="x"))
        rows = [
            TransactionIn(
                tx_date=date(2026, 10, 1),
                amount_cents=1800,
                tx_type="expense",
                merchant="校园食堂",
                description="午餐",
                category="餐饮",
            ),
            TransactionIn(
                tx_date=date(2026, 10, 2),
                amount_cents=100000,
                tx_type="income",
                merchant="学校财务处",
                description="奖学金",
                category="收入",
            ),
            TransactionIn(
                tx_date=date(2026, 9, 1),
                amount_cents=1500,
                tx_type="expense",
                merchant="校外食堂",
                description="晚餐",
                category="餐饮",
            ),
        ]
        created = [ledger.add_transaction(db, row, owner_id=1)[0] for row in rows]
        db.commit()

        filtered, total, totals = ledger.list_transactions(
            db,
            owner_id=1,
            page=1,
            page_size=25,
            tx_type="expense",
            category="餐饮",
            merchant="校园",
            date_from=date(2026, 10, 1),
            date_to=date(2026, 10, 31),
        )
        assert total == 1
        assert filtered[0].merchant == "校园食堂"
        assert totals == {
            "expense_cents": 1800,
            "income_cents": 0,
            "net_flow_cents": -1800,
            "category_spend": [{"category": "餐饮", "amount_cents": 1800}],
        }

        try:
            ledger.list_transactions(
                db,
                owner_id=1,
                page=1,
                page_size=25,
                date_from=date(2026, 10, 31),
                date_to=date(2026, 10, 1),
            )
        except ValueError as exc:
            assert "开始日期" in str(exc)
        else:
            raise AssertionError("Expected an invalid date range to be rejected")

        assert ledger.delete_transaction(db, created[0].id, owner_id=1)
        db.commit()
        assert db.get(Transaction, created[0].id) is None

        assert ledger.delete_all_transactions(db, owner_id=1) == 2
        db.commit()
        assert list(db.scalars(select(Transaction)).all()) == []

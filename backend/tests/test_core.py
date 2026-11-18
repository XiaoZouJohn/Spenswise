from datetime import date, timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base, get_db
from app.main import app, local_today
from app.models import Transaction
from app.schemas import ImportMapping, ScenarioIn, TransactionIn
from app.services.budget import (
    budget_status as _budget_status,
)
from app.services.budget import (
    get_settings as _get_settings,
)
from app.services.budget import (
    save_settings as _save_settings,
)
from app.services.budget import (
    summary as _summary,
)
from app.services.forecast import next_calendar_month
from app.services.forecast import simulate as _simulate
from app.services.imports import guess_mapping, normalize_row, parse_file
from app.services.ledger import add_transaction as _add_transaction
from app.services.ledger import version as _version
from app.services.money import to_cents


def add_transaction(db, item, source="manual"):
    return _add_transaction(db, item, source, owner_id=1)


def save_settings(db, data):
    return _save_settings(db, data, 1)


def get_settings(db):
    return _get_settings(db, 1)


def summary(db, as_of):
    return _summary(db, as_of, 1)


def budget_status(db, as_of, limits=None):
    return _budget_status(db, as_of, limits, owner_id=1)


def simulate(db, request, as_of=None):
    return _simulate(db, request, as_of, owner_id=1)


def version(db):
    return _version(db, 1)


def _login(client):
    assert (
        client.post(
            "/api/auth/register",
            json={
                "email": "test@example.com",
                "password": "safe-test-password-123",
                "display_name": "测试用户",
            },
        ).status_code
        == 200
    )


def test_money_rounding():
    assert to_cents("1.005") == 101
    assert to_cents("-0.005") == -1


def test_next_calendar_month_handles_year_and_leap_month_boundaries():
    assert next_calendar_month(date(2026, 12, 20)) == (
        date(2027, 1, 1),
        date(2027, 1, 31),
    )
    assert next_calendar_month(date(2028, 1, 15)) == (
        date(2028, 2, 1),
        date(2028, 2, 29),
    )


def test_balance_refund_transfer_and_duplicate(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        save_settings(db, {"monthly_budget_cents": 10000, "opening_balance_cents": 50000})
        today = date.today()
        expense = TransactionIn(tx_date=today, amount_cents=3000, tx_type="expense", merchant="A")
        assert add_transaction(db, expense)[1]
        assert not add_transaction(db, expense)[1]
        add_transaction(
            db, TransactionIn(tx_date=today, amount_cents=1000, tx_type="refund", merchant="A")
        )
        add_transaction(
            db, TransactionIn(tx_date=today, amount_cents=5000, tx_type="transfer", merchant="B")
        )
        add_transaction(
            db, TransactionIn(tx_date=today, amount_cents=10000, tx_type="income", merchant="C")
        )
        db.commit()
        result = summary(db, today)
        assert result["account_balance_cents"] == 58000
        assert result["budget_remaining_cents"] == 8000
        assert result["net_flow_cents"] == 8000
        assert result["net_flow_cents"] != result["account_balance_cents"]
        before = version(db)
        row = db.query(Transaction).filter_by(merchant="A", tx_type="expense").one()
        row.category = "餐饮"
        db.flush()
        assert version(db) != before


def test_forecast_excludes_paid_recurring(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    anchor = date(2026, 9, 15)
    with Session(engine) as db:
        save_settings(db, {"opening_balance_cents": 100000, "monthly_budget_cents": 200000})
        for month in (6, 7, 8, 9):
            add_transaction(
                db,
                TransactionIn(
                    tx_date=date(2026, month, 5),
                    amount_cents=20000,
                    tx_type="expense",
                    merchant="房租",
                    category="居住",
                    is_fixed=True,
                ),
            )
        db.commit()
        result = simulate(
            db,
            ScenarioIn(amount_cents=10000, purchase_date=date(2026, 10, 1), reserve_cents=0),
            as_of=anchor,
        )
        assert all(x["date"] != "2026-09-05" for x in result["recurring_bills"])
        assert any(x["date"] == "2026-10-05" for x in result["recurring_bills"])
        assert result["timeline"][0]["before_cents"] - result["timeline"][0]["after_cents"] == 10000


def test_monthly_plan_loads_with_varying_history(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'plan.db'}")
    Base.metadata.create_all(engine)
    anchor = date(2026, 10, 8)
    with Session(engine) as db:
        for week in range(12):
            add_transaction(
                db,
                TransactionIn(
                    tx_date=anchor - timedelta(days=84 - week * 7),
                    amount_cents=1000 + (week % 3) * 400,
                    tx_type="expense",
                    merchant=f"第 {week + 1} 周消费",
                    category="餐饮",
                ),
            )
        db.commit()
        result = simulate(
            db,
            ScenarioIn(amount_cents=0, purchase_date=date(2026, 11, 1), reserve_cents=0),
            as_of=anchor,
        )
        assert result["baseline"]["method"] == "fixed-variable-monthly"
        assert len(result["timeline"]) == 30
        assert result["period_start"] == "2026-11-01"
        assert result["period_end"] == "2026-11-30"
        assert result["timeline"][0]["date"] == "2026-11-01"
        assert result["timeline"][-1]["date"] == "2026-11-30"


def test_monthly_forecast_tracks_complete_month_spending_not_budget_or_default_purchase(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'monthly-forecast.db'}")
    Base.metadata.create_all(engine)
    anchor = date(2026, 10, 22)
    with Session(engine) as db:
        save_settings(db, {"opening_balance_cents": 500000, "monthly_budget_cents": 300000})
        for month, amount in zip(
            range(4, 10),
            (280000, 300000, 290000, 310000, 295000, 305000),
            strict=True,
        ):
            add_transaction(
                db,
                TransactionIn(
                    tx_date=date(2026, month, 15),
                    amount_cents=amount,
                    tx_type="expense",
                    merchant="校园综合消费",
                    category="餐饮",
                ),
            )
        add_transaction(
            db,
            TransactionIn(
                tx_date=date(2026, 10, 22),
                amount_cents=200000,
                tx_type="expense",
                merchant="本月累计消费",
                category="餐饮",
            ),
        )
        db.commit()
        result = simulate(
            db,
            ScenarioIn(
                amount_cents=0,
                purchase_date=date(2026, 11, 1),
                reserve_cents=0,
                use_ai_review=False,
            ),
            as_of=anchor,
        )
        assert 280000 <= result["expected_expense_cents"] <= 310000
        assert result["expected_expense_cents"] != 120000
        assert result["expected_budget_remaining_cents"] == (
            300000 - result["expected_expense_cents"]
        )
        assert result["ai_review"]["status"] == "not_requested"
        assert result["recurring_bills"] == []
        assert result["timeline"][-1]["before_cents"] == (
            result["opening_balance_cents"] - result["expected_expense_cents"]
        )


def test_monthly_budget_alerts_use_net_spending_only(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'budget.db'}")
    Base.metadata.create_all(engine)
    anchor = date(2026, 10, 8)
    with Session(engine) as db:
        save_settings(
            db,
            {
                "monthly_budget_cents": 12000,
                "category_budgets": [{"category": "餐饮", "limit_cents": 10000}],
            },
        )
        for tx_date, amount, kind, merchant, category in (
            (date(2026, 9, 30), 100000, "expense", "上月消费", "餐饮"),
            (anchor, 15000, "expense", "本月消费", "餐饮"),
            (anchor, 2000, "refund", "本月退款", "餐饮"),
            (anchor, 60000, "income", "工资", "收入"),
            (anchor, 50000, "transfer", "内部转账", "其他"),
        ):
            add_transaction(
                db,
                TransactionIn(
                    tx_date=tx_date,
                    amount_cents=amount,
                    tx_type=kind,
                    merchant=merchant,
                    category=category,
                ),
            )
        db.commit()
        result = budget_status(db, anchor)
        assert result["income_cents"] == 60000
        assert result["spent_cents"] == 13000
        assert [(item["scope"], item["over_cents"]) for item in result["alerts"]] == [
            ("total", 1000),
            ("category", 3000),
        ]
        assert budget_status(db, date(2026, 11, 1))["alerts"] == []


def test_budget_preview_uses_draft_limits_without_saving(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'preview.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        save_settings(db, {"monthly_budget_cents": 300000})
        add_transaction(
            db,
            TransactionIn(
                tx_date=local_today(),
                amount_cents=115000,
                tx_type="expense",
                merchant="测试餐厅",
                category="餐饮",
            ),
        )
        db.commit()

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        client = TestClient(app)
        _login(client)
        preview = client.post(
            "/api/budget/preview",
            json={
                "monthly_budget_cents": 100000,
                "category_budgets": [{"category": "餐饮", "limit_cents": 80000}],
            },
        )
        assert preview.status_code == 200
        assert [(item["scope"], item["over_cents"]) for item in preview.json()["alerts"]] == [
            ("total", 15000),
            ("category", 35000),
        ]
        assert client.get("/api/budget/status").json()["alerts"] == []
        assert client.get("/api/settings").json()["category_budgets"] == []
    finally:
        app.dependency_overrides.clear()


def test_settings_api_persists_total_and_category_budgets(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'settings.db'}")
    Base.metadata.create_all(engine)

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        client = TestClient(app)
        _login(client)
        response = client.put(
            "/api/settings",
            json={
                "monthly_budget_cents": 120000,
                "opening_balance_cents": 800000,
                "ai_consent": False,
                "category_budgets": [{"category": "餐饮", "limit_cents": 80000}],
            },
        )
        assert response.status_code == 200
        saved = client.get("/api/settings").json()
        assert saved["monthly_budget_cents"] == 120000
        assert saved["category_budgets"] == [{"category": "餐饮", "limit_cents": 80000}]
    finally:
        app.dependency_overrides.clear()


def test_budget_limit_update_and_legacy_settings_compatibility(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'budget.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        save_settings(
            db,
            {
                "monthly_budget_cents": 20000,
                "category_budgets": [{"category": "交通", "limit_cents": 3000}],
            },
        )
        before = version(db)
        save_settings(db, {"monthly_budget_cents": 25000})
        assert get_settings(db)["category_budgets"] == [{"category": "交通", "limit_cents": 3000}]
        assert version(db) != before


def test_importable_budget_warning_sample(tmp_path):
    sample = Path(__file__).resolve().parents[2] / "sample-data/2026-10-budget-alert-demo.csv"
    rows = parse_file(sample.name, sample.read_bytes())
    mapping = ImportMapping(**guess_mapping(list(rows[0])))
    engine = create_engine(f"sqlite:///{tmp_path / 'sample.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        save_settings(
            db,
            {
                "monthly_budget_cents": 300000,
                "category_budgets": [
                    {"category": "餐饮", "limit_cents": 80000},
                    {"category": "购物", "limit_cents": 50000},
                ],
            },
        )
        assert len(rows) == 11
        assert all(add_transaction(db, normalize_row(row, mapping), "import")[1] for row in rows)
        db.commit()
        result = budget_status(db, date(2026, 10, 8))
        assert result["income_cents"] == 680000
        assert result["spent_cents"] == 418000
        amounts = [
            (item["scope"], item["category"], item["over_cents"]) for item in result["alerts"]
        ]
        assert amounts == [
            ("total", None, 118000),
            ("category", "购物", 20000),
            ("category", "餐饮", 35000),
        ]

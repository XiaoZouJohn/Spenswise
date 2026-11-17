from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.schemas import ScenarioIn, ScenarioResult, TransactionIn
from app.services.budget import get_settings, save_settings
from app.services.forecast import simulate
from app.services.ledger import add_transaction


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def request(**kwargs):
    return ScenarioIn(
        **({"amount_cents": 0, "purchase_date": "2026-11-01", "reserve_cents": 0} | kwargs)
    )


def test_snapshot_is_end_of_day_and_future_events_bridge_exactly(db):
    result = simulate(
        db,
        request(
            balance_cents=10000,
            balance_date="2026-10-20",
            cash_events=[
                {"date": "2026-10-25", "kind": "income", "amount_cents": 3000},
                {"date": "2026-11-03", "kind": "expense", "amount_cents": 1000},
                {"date": "2026-11-20", "kind": "income", "amount_cents": 2000},
            ],
        ),
        date(2026, 10, 20),
        owner_id=1,
    )
    parsed = ScenarioResult.model_validate(result)
    assert parsed.opening_balance_cents == 13000
    assert parsed.bridge_change_cents == 3000
    assert parsed.timeline[-1].after_cents == 14000
    assert parsed.expected_expense_cents == 1000
    assert parsed.balance_basis == "confirmed_snapshot"


def test_missing_balance_does_not_invent_verified_balance(db):
    save_settings(db, {"opening_balance_cents": 999999}, 1)
    result = simulate(db, request(), date(2026, 10, 31), owner_id=1)
    assert result["balance_basis"] == "net_cashflow"
    assert result["opening_balance_cents"] == 0
    assert result["data_quality"] == "insufficient"


def test_later_income_cannot_repair_early_purchase(db):
    result = simulate(
        db,
        request(
            balance_cents=1000,
            balance_date="2026-10-31",
            amount_cents=2000,
            cash_events=[{"date": "2026-11-20", "kind": "income", "amount_cents": 10000}],
        ),
        date(2026, 10, 31),
        owner_id=1,
    )
    assert result["timeline"][-1]["after_cents"] == 9000
    assert result["minimum_after_cents"] == -1000
    assert result["optimization"]["feasible"] is False


@pytest.mark.parametrize("event_date", ["2026-10-20", "2026-12-01"])
def test_out_of_window_events_rejected(db, event_date):
    with pytest.raises(ValueError, match="额外收支日期"):
        simulate(
            db,
            request(cash_events=[{"date": event_date, "kind": "income", "amount_cents": 1}]),
            date(2026, 10, 20),
            owner_id=1,
        )


def test_coverage_persists_when_old_clients_omit_it_and_is_owner_scoped(db):
    coverage = [{"start_date": "2026-01-01", "end_date": "2026-10-31"}]
    save_settings(db, {"history_coverage": coverage}, 1)
    db.flush()
    save_settings(db, {"monthly_budget_cents": 12300, "history_coverage": None}, 1)
    db.flush()
    assert get_settings(db, 1)["history_coverage"] == coverage
    assert get_settings(db, 2)["history_coverage"] == []
    save_settings(db, {"history_coverage": []}, 1)
    db.flush()
    assert get_settings(db, 1)["history_coverage"] == []


def test_previous_saved_result_parses_without_new_fields(db):
    result = simulate(db, request(), date(2026, 10, 31), owner_id=1)
    for key in [
        "fixed_expense_cents",
        "variable_expense_cents",
        "data_quality",
        "balance_basis",
        "warnings",
        "minimum_adjusted_cents",
        "coverage_status",
    ]:
        result.pop(key)
    assert ScenarioResult.model_validate(result).balance_basis == "net_cashflow"


def test_snapshot_rollforward_uses_only_later_own_transactions(db):
    for day, amount, kind, owner in [
        ("2026-10-20", 90000, "income", 1),
        ("2026-10-21", 1000, "expense", 1),
        ("2026-10-22", 200, "refund", 1),
        ("2026-10-22", 999999, "income", 2),
    ]:
        add_transaction(
            db,
            TransactionIn(
                tx_date=day, amount_cents=amount, tx_type=kind, merchant=f"{owner}-{day}"
            ),
            owner_id=owner,
        )
    db.flush()
    result = simulate(
        db, request(balance_cents=10000, balance_date="2026-10-20"), date(2026, 10, 31), owner_id=1
    )
    assert result["opening_balance_cents"] == 9200
    assert len(result["source_transaction_ids"]) == 3


def test_executable_cuts_reconcile_adjusted_timeline_and_preserve_reserve(db):
    for m in (8, 9, 10):
        add_transaction(
            db,
            TransactionIn(
                tx_date=date(2026, m, 1),
                amount_cents=10000,
                tx_type="expense",
                merchant="food",
                category="餐饮",
            ),
            owner_id=1,
        )
    db.flush()
    result = simulate(
        db,
        request(
            balance_cents=10000,
            balance_date="2026-10-31",
            amount_cents=2000,
            purchase_date="2026-11-30",
        ),
        date(2026, 10, 31),
        owner_id=1,
    )
    assert result["optimization"]["feasible"]
    assert result["minimum_adjusted_cents"] >= 0
    assert result["timeline"][-1]["adjusted_cents"] == (
        result["timeline"][-1]["after_cents"] + result["optimization"]["total_cuts_cents"]
    )
    assert (
        result["expected_expense_cents"]
        == result["fixed_expense_cents"] + result["variable_expense_cents"]
    )

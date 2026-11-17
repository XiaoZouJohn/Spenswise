from datetime import date
from types import SimpleNamespace

from app.services.backtest import evaluate


def history(owner=1, amount=10000):
    return [
        SimpleNamespace(
            id=owner * 100 + m,
            owner_id=owner,
            tx_date=date(2026, m, 1),
            amount_cents=amount,
            category="餐饮",
            merchant="meal",
            is_fixed=False,
            tx_type="expense",
        )
        for m in range(1, 11)
    ]


def test_owner_isolation_future_exclusion_and_frozen_holdout():
    rows = history()
    base = evaluate(rows, owner_id=1, as_of=date(2026, 9, 30), holdout_months=2)
    assert base == evaluate(
        rows + history(2, 9999999), owner_id=1, as_of=date(2026, 9, 30), holdout_months=2
    )
    assert base["status"] == "ok"
    assert base["test_months"] == ["2026-08", "2026-09"]
    assert max(base["validation_months"]) < min(base["test_months"])
    changed = history()
    changed[-2].amount_cents = 9999999
    report = evaluate(changed, owner_id=1, as_of=date(2026, 9, 30), holdout_months=2)
    assert report["selected_model"] == base["selected_model"]
    assert report["validation"] == base["validation"]


def test_confirmed_zero_targets_and_insufficient_history():
    rows = history()[:5]
    assert evaluate(rows[:2], owner_id=1, as_of=date(2026, 5, 31))["status"] == "insufficient"
    coverage = [{"start_date": "2026-01-01", "end_date": "2026-08-31"}]
    report = evaluate(rows, owner_id=1, as_of=date(2026, 8, 31), coverage=coverage)
    assert report["folds"][-1]["actual_cents"] == 0
    assert report["coverage_status"] == "confirmed"

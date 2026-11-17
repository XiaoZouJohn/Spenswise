from datetime import date
from types import SimpleNamespace

import pytest

from app.services import forecast


def transaction(index, day, cents, category="餐饮", merchant="shop", fixed=False, kind="expense"):
    return SimpleNamespace(
        id=index,
        owner_id=1,
        tx_date=date.fromisoformat(day),
        amount_cents=cents,
        category=category,
        merchant=merchant,
        is_fixed=fixed,
        tx_type=kind,
    )


def test_category_average_uses_observed_months_instead_of_six():
    rows = [transaction(1, "2026-09-01", 90000), transaction(2, "2026-10-01", 90000)]
    assert forecast._category_monthly_averages(rows, date(2026, 11, 17)) == {"餐饮": 90000}


def test_month_end_bills_clamp_and_stale_bills_expire():
    rows = [
        transaction(1, "2026-07-31", 10000, "居住", "rent", True),
        transaction(2, "2026-08-31", 10000, "居住", "rent", True),
    ]
    bills = forecast.recurring(rows, date(2026, 9, 1), 30)
    assert [(b["date"], b["amount_cents"]) for b in bills] == [("2026-09-30", 10000)]
    assert forecast.recurring(rows, date(2027, 1, 1), 31) == []


def test_confirmed_zero_month_is_included_but_unknown_gap_is_not_zero():
    rows = [transaction(1, "2026-09-01", 90000)]
    result = forecast.monthly_projection(
        rows,
        date(2026, 11, 1),
        date(2026, 12, 1),
        date(2026, 12, 31),
        coverage=[{"start_date": "2026-09-01", "end_date": "2026-10-31"}],
    )
    assert [m["amount_cents"] for m in result["history_months"]] == [90000, 0]
    assert result["coverage_status"] == "confirmed"
    inferred = forecast.monthly_projection(
        rows,
        date(2026, 11, 1),
        date(2026, 12, 1),
        date(2026, 12, 31),
    )
    assert inferred["coverage_status"] == "inferred"
    assert len(inferred["history_months"]) == 1


def test_fixed_variable_decomposition_does_not_count_rent_twice_or_future_rows():
    rows = []
    for month in (7, 8, 9):
        rows += [
            transaction(month, f"2026-{month:02}-01", 100000, "居住", "rent", True),
            transaction(month + 20, f"2026-{month:02}-02", 30000),
        ]
    args = (date(2026, 10, 1), date(2026, 11, 1), date(2026, 11, 30))
    result = forecast.monthly_projection(rows, *args)
    polluted = forecast.monthly_projection(rows + [transaction(99, "2026-12-01", 9999999)], *args)
    assert result["expected_cents"] == polluted["expected_cents"]
    assert result["fixed_cents"] == 100000
    assert 128000 <= result["expected_cents"] <= 132000
    assert sum(result["category_variable_cents"].values()) == result["variable_cents"]
    assert result["expected_cents"] == result["fixed_cents"] + result["variable_cents"]


def test_no_history_reports_insufficient_instead_of_claiming_certainty():
    result = forecast.monthly_projection(
        [], date(2026, 10, 1), date(2026, 11, 1), date(2026, 11, 30)
    )
    assert result["data_quality"] == "insufficient"
    assert result["warnings"]


def test_partial_disjoint_coverage_does_not_spread_spend_across_missing_days():
    rows = [transaction(1, "2026-10-01", 500), transaction(2, "2026-10-20", 600)]
    result = forecast.monthly_projection(
        rows,
        date(2026, 10, 25),
        date(2026, 11, 1),
        date(2026, 11, 30),
        coverage=[
            {"start_date": "2026-10-01", "end_date": "2026-10-05"},
            {"start_date": "2026-10-20", "end_date": "2026-10-25"},
        ],
    )
    assert result["sample_days"] == 11
    assert result["variable_cents"] == 3000


def test_integer_cut_capacity_cannot_claim_feasible_after_rounding():
    result = forecast.optimize_cuts({"a": 1, "b": 1, "c": 1}, [], 1, 1)
    assert result["feasible"] is False
    assert result["shortfall_cents"] == 1


def test_optimizer_respects_minimums_preferences_and_returns_best_effort():
    result = forecast.optimize_cuts(
        {},
        [],
        5000,
        30,
        category_totals={"餐饮": 10000, "娱乐": 10000},
        constraints=[
            {
                "category": "餐饮",
                "minimum_cents": 9000,
                "max_cut_percent": 100,
                "disruption_weight": 5,
            },
            {
                "category": "娱乐",
                "minimum_cents": 0,
                "max_cut_percent": 100,
                "disruption_weight": 1,
            },
        ],
    )
    assert result["feasible"]
    assert result["cuts"] == [{"category": "娱乐", "amount_cents": 5000}]
    limited = forecast.optimize_cuts({}, ["餐饮"], 5000, 30, category_totals={"餐饮": 10000})
    assert not limited["feasible"] and limited["shortfall_cents"] == 5000


def test_optimizer_cannot_cover_early_deficit_using_later_savings():
    result = forecast.optimize_cuts(
        {},
        [],
        1000,
        30,
        category_totals={"娱乐": 10000},
        daily_deficits=[1000] + [0] * 29,
    )
    assert not result["feasible"]
    assert result["shortfall_cents"] > 0


def test_daily_rounding_cannot_save_more_than_total_daily_spend():
    result = forecast.optimize_cuts(
        {},
        [],
        2,
        3,
        category_totals={"a": 1, "b": 1},
        constraints=[{"category": k, "max_cut_percent": 100} for k in ("a", "b")],
        daily_deficits=[2, 0, 0],
    )
    # Two cents spread across three days means only one cent exists on day one.
    assert result["feasible"] is False


@pytest.mark.parametrize(
    "field,value", [("max_cut_percent", 101), ("minimum_cents", -1), ("disruption_weight", 0)]
)
def test_scenario_rejects_invalid_cut_constraints(field, value):
    from pydantic import ValidationError

    from app.schemas import ScenarioIn

    with pytest.raises(ValidationError):
        ScenarioIn(
            amount_cents=0,
            purchase_date=date(2026, 11, 1),
            reserve_cents=0,
            category_constraints=[{"category": "餐饮", field: value}],
        )

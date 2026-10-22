import warnings
from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta
from statistics import median

import numpy as np
from scipy.optimize import linprog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Transaction
from app.schemas import ScenarioIn

from .budget import summary
from .ledger import version


def baseline(
    rows: Sequence[Transaction],
    as_of: date,
    horizon: int,
    recurring_merchants: set[str] | None = None,
) -> dict:
    # Daily historical expense net of refunds; no future rows enter training.
    start = as_of - timedelta(days=89)
    daily: dict[date, int] = defaultdict(int)
    for r in rows:
        if r.merchant.lower().strip() in (recurring_merchants or set()):
            continue
        if start <= r.tx_date < as_of:
            if r.tx_type == "expense":
                daily[r.tx_date] += r.amount_cents
            elif r.tx_type == "refund":
                daily[r.tx_date] -= r.amount_cents
    values = [max(0, daily[start + timedelta(days=i)]) for i in range((as_of - start).days)]
    sample_days = len(values)
    weeks = [sum(values[i : i + 7]) / 7 for i in range(0, len(values), 7)]
    estimate = float(median(weeks)) if weeks else 0.0
    method = "median-weekly-baseline"
    if len(weeks) >= 6 and np.std(weeks) > 0:
        try:
            from statsmodels.tools.sm_exceptions import ConvergenceWarning
            from statsmodels.tsa.holtwinters import SimpleExpSmoothing

            with warnings.catch_warnings():
                warnings.simplefilter("error", ConvergenceWarning)
                fitted = SimpleExpSmoothing(
                    np.asarray(weeks), initialization_method="estimated"
                ).fit(optimized=True)
            estimate = max(0.0, float(fitted.forecast(1)[0]))
            method = "statsmodels-simple-exponential-smoothing"
        except (ImportError, AttributeError, TypeError, ValueError, RuntimeError, Warning):
            pass
    residual = [w - estimate for w in weeks]
    spread = float(np.quantile(np.abs(residual), 0.8)) if residual else 0.0
    return {
        "daily_cents": round(estimate),
        "lower_daily_cents": max(0, round(estimate - spread)),
        "upper_daily_cents": round(estimate + spread),
        "method": method,
        "sample_days": sample_days,
        "history_start": start.isoformat(),
        "assumptions": [
            "历史净支出按周汇总后估计每日基线",
            "区间由历史周偏差的 80% 分位数给出；非概率保证",
        ],
        "parameters": {"history_days": 90, "quantile": 0.8, "random_seed": 0},
    }


def recurring(rows: Sequence[Transaction], as_of: date, horizon: int) -> list[dict]:
    groups = defaultdict(list)
    for r in rows:
        if r.tx_type == "expense" and r.merchant and r.tx_date < as_of:
            groups[r.merchant.lower().strip()].append(r)
    result = []
    for items in groups.values():
        by_month = defaultdict(list)
        for row in items:
            by_month[row.tx_date.strftime("%Y-%m")].append(row)
        if len(by_month) < 2 or not (any(x.is_fixed for x in items) or len(by_month) >= 3):
            continue
        amount = round(median([sum(x.amount_cents for x in month) for month in by_month.values()]))
        day = round(
            median([round(median([x.tx_date.day for x in month])) for month in by_month.values()])
        )
        paid_month = {
            (r.tx_date.year, r.tx_date.month)
            for r in items
            if r.tx_date.month == as_of.month and r.tx_date.year == as_of.year
        }
        for offset in range(horizon):
            target = as_of + timedelta(days=offset)
            if target.day == day and (target.year, target.month) not in paid_month:
                result.append(
                    {
                        "date": target.isoformat(),
                        "amount_cents": amount,
                        "merchant": items[-1].merchant,
                        "category": items[-1].category,
                        "source_ids": [x.id for x in items],
                    }
                )
    return result


def optimize_cuts(
    category_daily: dict[str, int], protected: list[str], required_cents: int, horizon: int
) -> dict:
    candidates = [
        (k, v * horizon) for k, v in category_daily.items() if k not in protected and v > 0
    ]
    if required_cents <= 0:
        return {"feasible": True, "cuts": [], "total_cuts_cents": 0}
    if not candidates:
        return {"feasible": False, "cuts": [], "total_cuts_cents": 0}
    # Minimize proportional disruption, capped at 40% per flexible category.
    result = linprog(
        c=[1 / max(1, amount) for _, amount in candidates],
        A_ub=[[-1] * len(candidates)],
        b_ub=[-required_cents],
        bounds=[(0, amount * 0.4) for _, amount in candidates],
        method="highs",
    )
    if not result.success:
        return {"feasible": False, "cuts": [], "total_cuts_cents": 0}
    cuts = [
        {"category": name, "amount_cents": round(value)}
        for (name, _), value in zip(candidates, result.x, strict=False)
        if value > 0.5
    ]
    return {
        "feasible": True,
        "cuts": cuts,
        "total_cuts_cents": sum(x["amount_cents"] for x in cuts),
    }


def simulate(db: Session, request: ScenarioIn, as_of: date | None = None, *, owner_id: int) -> dict:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    today = as_of or datetime.now(ZoneInfo("Asia/Shanghai")).date()
    rows = db.scalars(
        select(Transaction).where(Transaction.owner_id == owner_id, Transaction.tx_date <= today)
    ).all()
    bills = recurring(rows, today, request.horizon_days)
    base = baseline(
        rows, today, request.horizon_days, {x["merchant"].lower().strip() for x in bills}
    )
    opening = summary(db, today, owner_id)["account_balance_cents"]
    category_daily: dict[str, int] = defaultdict(int)
    historical = [
        r
        for r in rows
        if today - timedelta(days=90) <= r.tx_date < today and r.tx_type == "expense"
    ]
    for row in historical:
        category_daily[row.category] += round(row.amount_cents / 90)
    purchase_offset = (request.purchase_date - today).days
    if purchase_offset < 0 or purchase_offset >= request.horizon_days:
        raise ValueError("购买日期必须位于预测区间内")
    timeline = []
    before = after = lower = upper = opening
    for offset in range(request.horizon_days):
        day = today + timedelta(days=offset)
        bill_amount = sum(x["amount_cents"] for x in bills if x["date"] == day.isoformat())
        before -= base["daily_cents"] + bill_amount
        after -= (
            base["daily_cents"]
            + bill_amount
            + (request.amount_cents if offset == purchase_offset else 0)
        )
        lower -= (
            base["upper_daily_cents"]
            + bill_amount
            + (request.amount_cents if offset == purchase_offset else 0)
        )
        upper -= (
            base["lower_daily_cents"]
            + bill_amount
            + (request.amount_cents if offset == purchase_offset else 0)
        )
        timeline.append(
            {
                "date": day.isoformat(),
                "before_cents": before,
                "after_cents": after,
                "lower_cents": lower,
                "upper_cents": upper,
                "bill_cents": bill_amount,
            }
        )
    minimum = min(x["after_cents"] for x in timeline)
    required = max(0, request.reserve_cents - minimum)
    optimization = optimize_cuts(
        category_daily, request.protected_categories, required, request.horizon_days
    )
    return {
        "data_version": version(db, owner_id),
        "as_of": today.isoformat(),
        "currency": "CNY",
        "baseline": base,
        "opening_balance_cents": opening,
        "budget_remaining_cents": summary(db, today, owner_id)["budget_remaining_cents"],
        "purchase_amount_cents": request.amount_cents,
        "minimum_after_cents": minimum,
        "reserve_cents": request.reserve_cents,
        "required_saving_cents": required,
        "optimization": optimization,
        "timeline": timeline,
        "recurring_bills": bills,
        "source_transaction_ids": [r.id for r in historical],
    }

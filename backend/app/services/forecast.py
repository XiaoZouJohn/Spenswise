import json
import warnings
from calendar import monthrange
from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta
from statistics import median

import httpx
import numpy as np
from scipy.optimize import linprog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Transaction
from app.schemas import ScenarioIn

from . import ai, ai_connection
from .budget import get_settings, summary
from .ledger import version

_AI_FORECAST_CACHE: dict[tuple[int, str, str], dict] = {}
_INFERRED_RECURRING_CATEGORIES = {"居住", "通讯", "教育", "娱乐"}


def next_calendar_month(as_of: date) -> tuple[date, date]:
    year = as_of.year + (1 if as_of.month == 12 else 0)
    month = 1 if as_of.month == 12 else as_of.month + 1
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def _shift_month(value: date, offset: int) -> date:
    index = value.year * 12 + value.month - 1 + offset
    return date(index // 12, index % 12 + 1, 1)


def _month_end(value: date) -> date:
    return date(value.year, value.month, monthrange(value.year, value.month)[1])


def _net_expense(rows: Sequence[Transaction]) -> int:
    expense = sum(row.amount_cents for row in rows if row.tx_type == "expense")
    refunds = sum(row.amount_cents for row in rows if row.tx_type == "refund")
    return max(0, expense - refunds)


def monthly_projection(
    rows: Sequence[Transaction], as_of: date, period_start: date, period_end: date
) -> dict:
    """Forecast a calendar month's total spend from complete monthly history.

    The budget is deliberately not used as a spending target. It is compared with
    the forecast later, so a 3,000 yuan limit cannot manufacture a 3,000 yuan
    prediction when the ledger says otherwise.
    """

    current_start = date(as_of.year, as_of.month, 1)
    relevant = [
        row for row in rows if row.tx_type in {"expense", "refund"} and row.tx_date < current_start
    ]
    earliest = min((row.tx_date for row in relevant), default=None)
    monthly: list[tuple[date, int, int]] = []
    for offset in range(-12, 0):
        start = _shift_month(current_start, offset)
        end = _month_end(start)
        month_rows = [row for row in relevant if start <= row.tx_date <= end]
        if not month_rows:
            continue
        # An import that starts late in its first month is not a complete month.
        if earliest and start.year == earliest.year and start.month == earliest.month:
            if earliest.day > 7:
                continue
        monthly.append((start, _net_expense(month_rows), len(month_rows)))

    target_days = (period_end - period_start).days + 1
    current_rows = [
        row
        for row in rows
        if row.tx_type in {"expense", "refund"} and current_start <= row.tx_date <= as_of
    ]
    current_pace: float | None = None
    if as_of.day >= 10 and current_rows:
        current_pace = (
            _net_expense(current_rows) / as_of.day * monthrange(as_of.year, as_of.month)[1]
        )

    values = np.asarray([amount for _, amount, _ in monthly], dtype=float)
    method = "hybrid-monthly-ensemble"
    if len(values) >= 2:
        center = float(np.median(values))
        deviations = np.abs(values - center)
        mad = float(np.median(deviations))
        robust = values
        if mad > 0:
            robust = np.clip(values, max(0, center - 2.5 * mad), center + 2.5 * mad)
        weights = np.asarray([0.82 ** (len(robust) - 1 - i) for i in range(len(robust))])
        weighted = float(np.average(robust, weights=weights))
        candidates = [(weighted, 0.65), (center, 0.25)]
        if current_pace is not None:
            pace = min(max(current_pace, weighted * 0.7), weighted * 1.3)
            candidates.append((pace, 0.10))
        expected = sum(value * weight for value, weight in candidates) / sum(
            weight for _, weight in candidates
        )
        if len(robust) >= 4:
            x = np.arange(len(robust), dtype=float)
            slope, intercept = np.polyfit(x, robust, 1)
            trend = float(intercept + slope * len(robust))
            trend = min(max(trend, weighted * 0.85), weighted * 1.15)
            expected = expected * 0.85 + trend * 0.15
        spread = max(expected * 0.08, float(np.quantile(np.abs(values - expected), 0.8)))
    elif len(values) == 1:
        expected = float(values[0])
        if current_pace is not None:
            expected = expected * 0.7 + current_pace * 0.3
        spread = expected * 0.2
        method = "single-month-with-current-pace"
    elif current_pace is not None:
        expected = current_pace
        spread = expected * 0.25
        method = "current-month-pace-fallback"
    else:
        start = as_of - timedelta(days=89)
        recent = [
            row
            for row in rows
            if row.tx_type in {"expense", "refund"} and start <= row.tx_date <= as_of
        ]
        observed_days = max(
            1, (as_of - max(start, min((r.tx_date for r in recent), default=as_of))).days + 1
        )
        expected = _net_expense(recent) / observed_days * target_days
        spread = expected * 0.3
        method = "recent-daily-fallback"

    expected_cents = max(0, round(expected))
    lower_cents = max(0, round(expected - spread))
    upper_cents = max(expected_cents, round(expected + spread))
    sample_days = sum(monthrange(item.year, item.month)[1] for item, _, _ in monthly)
    return {
        "expected_cents": expected_cents,
        "lower_cents": lower_cents,
        "upper_cents": upper_cents,
        "method": method,
        "history_months": [
            {"month": item.strftime("%Y-%m"), "amount_cents": amount, "rows": count}
            for item, amount, count in monthly
        ],
        "current_pace_cents": round(current_pace) if current_pace is not None else None,
        "sample_days": sample_days,
        "history_start": monthly[0][0].isoformat()
        if monthly
        else (as_of - timedelta(days=89)).isoformat(),
    }


def _category_monthly_averages(rows: Sequence[Transaction], as_of: date) -> dict[str, int]:
    start = _shift_month(date(as_of.year, as_of.month, 1), -6)
    totals: dict[str, int] = defaultdict(int)
    for row in rows:
        if start <= row.tx_date < date(as_of.year, as_of.month, 1):
            if row.tx_type == "expense":
                totals[row.category] += row.amount_cents
            elif row.tx_type == "refund":
                totals[row.category] -= row.amount_cents
    return {category: max(0, round(amount / 6)) for category, amount in totals.items()}


def _ai_review(
    db: Session,
    owner_id: int,
    data_version: str,
    period_start: date,
    projection: dict,
    category_monthly: dict[str, int],
    requested: bool,
) -> dict:
    if not requested:
        return {
            "status": "not_requested",
            "model": None,
            "adjustment_percent": 0,
            "reason": "本次未请求 AI 复核，金额由本地历史模型计算。",
        }
    if not ai.enabled(db, owner_id):
        return {
            "status": "unavailable",
            "model": None,
            "adjustment_percent": 0,
            "reason": "未授权或未配置 DeepSeek，已使用本地历史模型。",
        }
    cache_key = (owner_id, data_version, period_start.isoformat())
    cached = _AI_FORECAST_CACHE.get(cache_key)
    if cached:
        return cached
    status = ai_connection.status(db, owner_id)
    facts = {
        "target_month": period_start.strftime("%Y-%m"),
        "deterministic_forecast_yuan": round(projection["expected_cents"] / 100, 2),
        "complete_months_yuan": [
            {
                "month": item["month"],
                "expense": round(item["amount_cents"] / 100, 2),
            }
            for item in projection["history_months"]
        ],
        "current_month_pace_yuan": (
            round(projection["current_pace_cents"] / 100, 2)
            if projection["current_pace_cents"] is not None
            else None
        ),
        "recent_category_monthly_average_yuan": {
            name: round(amount / 100, 2) for name, amount in category_monthly.items()
        },
    }
    try:
        answer = ai.ask(
            [
                {
                    "role": "system",
                    "content": (
                        "你是消费预测复核器。只能根据给出的月度和分类汇总检查趋势，"
                        "不得假设未提供的事件。只返回 JSON 对象：adjustment_percent（-8 到 8）、"
                        "confidence（0 到 100）和 reason（60 字以内）。"
                        "数据不足或没有明确趋势时 adjustment_percent 必须为 0。"
                    ),
                },
                {"role": "user", "content": json.dumps(facts, ensure_ascii=False)},
            ],
            db,
            owner_id,
        )
        cleaned = (
            answer.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        )
        start, end = cleaned.find("{"), cleaned.rfind("}")
        parsed = json.loads(cleaned[start : end + 1])
        confidence = max(0, min(100, int(parsed.get("confidence", 0))))
        adjustment = max(-8.0, min(8.0, float(parsed.get("adjustment_percent", 0))))
        if confidence < 60:
            adjustment = 0.0
        result = {
            "status": "applied",
            "model": status["model"],
            "adjustment_percent": round(adjustment, 2),
            "reason": str(parsed.get("reason") or "AI 未发现需要修正的明确趋势")[:120],
        }
    except (ValueError, TypeError, KeyError, IndexError, OSError, httpx.HTTPError) as exc:
        result = {
            "status": "failed",
            "model": status["model"],
            "adjustment_percent": 0,
            "reason": f"AI 复核失败，已回退本地模型：{str(exc)[:60]}",
        }
    _AI_FORECAST_CACHE[cache_key] = result
    return result


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
        items.sort(key=lambda item: (item.tx_date, item.id))
        by_month = defaultdict(list)
        for row in items:
            by_month[row.tx_date.strftime("%Y-%m")].append(row)
        explicitly_fixed = any(x.is_fixed for x in items)
        monthly_amounts = [sum(x.amount_cents for x in month) for month in by_month.values()]
        monthly_counts = [len(month) for month in by_month.values()]
        amount_center = float(median(monthly_amounts)) if monthly_amounts else 0
        amount_deviation = (
            max(abs(value - amount_center) for value in monthly_amounts) / amount_center
            if amount_center > 0
            else 1
        )
        monthly_days = [month[0].tx_date.day for month in by_month.values() if len(month) == 1]
        day_center = float(median(monthly_days)) if monthly_days else 0
        day_deviation = max((abs(value - day_center) for value in monthly_days), default=99)
        inferred_fixed = (
            len(by_month) >= 3
            and items[-1].category in _INFERRED_RECURRING_CATEGORIES
            and max(monthly_counts, default=0) == 1
            and amount_deviation <= 0.2
            and day_deviation <= 5
        )
        if len(by_month) < 2 or not (explicitly_fixed or inferred_fixed):
            continue
        amount = round(median(monthly_amounts))
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
    period_start, period_end = next_calendar_month(today)
    horizon_days = (period_end - period_start).days + 1
    data_version = version(db, owner_id)
    projection = monthly_projection(rows, today, period_start, period_end)
    category_monthly = _category_monthly_averages(rows, today)
    ai_review = _ai_review(
        db,
        owner_id,
        data_version,
        period_start,
        projection,
        category_monthly,
        request.use_ai_review,
    )
    adjustment = ai_review["adjustment_percent"] / 100
    deterministic_expected = projection["expected_cents"]
    expected_expense = max(0, round(deterministic_expected * (1 + adjustment)))
    ai_delta = expected_expense - deterministic_expected
    lower_expense = max(0, projection["lower_cents"] + ai_delta)
    upper_expense = max(expected_expense, projection["upper_cents"] + ai_delta)
    bills = recurring(rows, period_start, horizon_days)
    recurring_total = sum(item["amount_cents"] for item in bills)
    expected_expense = max(expected_expense, recurring_total)
    lower_expense = min(expected_expense, max(lower_expense, recurring_total))
    upper_expense = max(expected_expense, upper_expense, recurring_total)
    variable_expected = max(0, expected_expense - recurring_total)
    variable_lower = max(0, lower_expense - recurring_total)
    variable_upper = max(0, upper_expense - recurring_total)
    base = {
        "daily_cents": round(variable_expected / horizon_days),
        "lower_daily_cents": round(variable_lower / horizon_days),
        "upper_daily_cents": round(variable_upper / horizon_days),
        "method": projection["method"]
        + ("+deepseek-review" if ai_review["status"] == "applied" else ""),
        "sample_days": projection["sample_days"],
        "history_start": projection["history_start"],
        "assumptions": [
            "以最近最多 12 个完整自然月的净支出为主，近期月份权重更高",
            "本月进度和受限趋势仅作小幅校正，预算上限不充当预计支出",
            "周期账单从总预测中拆分展示，不与历史月均重复相加",
            "预测区间来自历史月度偏差，不是概率保证",
        ],
        "parameters": {
            "history_months": len(projection["history_months"]),
            "recent_month_weight_decay": 0.82,
            "current_pace_weight": 0.1,
            "trend_weight": 0.15,
            "ai_adjustment_limit_percent": 8,
        },
    }
    opening = summary(db, today, owner_id)["account_balance_cents"]
    category_daily: dict[str, int] = defaultdict(int)
    historical = [
        r
        for r in rows
        if today - timedelta(days=90) <= r.tx_date < today and r.tx_type == "expense"
    ]
    for row in historical:
        category_daily[row.category] += round(row.amount_cents / 90)
    purchase_offset = (request.purchase_date - period_start).days
    if request.purchase_date < period_start or request.purchase_date > period_end:
        raise ValueError(
            f"购买日期必须位于下个月（{period_start.isoformat()} 至 {period_end.isoformat()}）"
        )
    timeline = []
    before = after = lower = upper = opening

    def daily_share(total: int, offset: int) -> int:
        return total // horizon_days + (1 if offset < total % horizon_days else 0)

    for offset in range(horizon_days):
        day = period_start + timedelta(days=offset)
        bill_amount = sum(x["amount_cents"] for x in bills if x["date"] == day.isoformat())
        expected_daily = daily_share(variable_expected, offset)
        lower_daily = daily_share(variable_lower, offset)
        upper_daily = daily_share(variable_upper, offset)
        before -= expected_daily + bill_amount
        after -= (
            expected_daily
            + bill_amount
            + (request.amount_cents if offset == purchase_offset else 0)
        )
        lower -= (
            upper_daily + bill_amount + (request.amount_cents if offset == purchase_offset else 0)
        )
        upper -= (
            lower_daily + bill_amount + (request.amount_cents if offset == purchase_offset else 0)
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
        category_daily, request.protected_categories, required, horizon_days
    )
    monthly_budget = get_settings(db, owner_id)["monthly_budget_cents"]
    return {
        "data_version": data_version,
        "as_of": today.isoformat(),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
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
        "expected_expense_cents": expected_expense,
        "expected_expense_after_purchase_cents": expected_expense + request.amount_cents,
        "forecast_lower_expense_cents": lower_expense,
        "forecast_upper_expense_cents": upper_expense,
        "expected_budget_remaining_cents": monthly_budget - expected_expense - request.amount_cents,
        "ai_review": ai_review,
    }

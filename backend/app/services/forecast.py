import json
import warnings
from calendar import monthrange
from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta
from statistics import median

import httpx
import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Transaction
from app.schemas import ScenarioIn

from . import ai, ai_connection, forecast_math
from .budget import get_settings, summary
from .forecast_math import monthly_projection, optimize_cuts, recurring
from .ledger import version

_AI_FORECAST_CACHE: dict[tuple[int, str, str], dict] = {}


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


def legacy_monthly_projection(
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
    return forecast_math.category_monthly_averages(rows, as_of)


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


def simulate(db: Session, request: ScenarioIn, as_of: date | None = None, *, owner_id: int) -> dict:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from .money import signed_amount

    today = as_of or datetime.now(ZoneInfo("Asia/Shanghai")).date()
    period_start, period_end = next_calendar_month(today)
    if not period_start <= request.purchase_date <= period_end:
        raise ValueError(f"购买日期必须位于下个月（{period_start} 至 {period_end}）")
    if request.balance_date and request.balance_date > today:
        raise ValueError("余额快照不能晚于试算日期")
    if any(not today < e.date <= period_end for e in request.cash_events):
        raise ValueError("额外收支日期须晚于今日且不晚于预测月末")
    rows = db.scalars(
        select(Transaction).where(Transaction.owner_id == owner_id, Transaction.tx_date <= today)
    ).all()
    settings = get_settings(db, owner_id)
    data_version = version(db, owner_id)
    projection = monthly_projection(
        rows, today, period_start, period_end, settings["history_coverage"]
    )
    horizon = (period_end - period_start).days + 1
    review = _ai_review(
        db,
        owner_id,
        data_version,
        period_start,
        projection,
        forecast_math.category_monthly_averages(rows, today, settings["history_coverage"]),
        request.use_ai_review,
    )
    # AI can adjust the flexible component only. Fixed bills keep their known amounts.
    ai_delta = round(projection["variable_cents"] * review["adjustment_percent"] / 100)
    variable = max(0, projection["variable_cents"] + ai_delta)
    fixed = projection["fixed_cents"]
    variable_lower = max(0, projection["lower_cents"] - fixed + ai_delta)
    variable_upper = max(variable, projection["upper_cents"] - fixed + ai_delta)
    bills = projection["recurring_bills"]
    warnings_list = list(projection["warnings"])
    if request.balance_cents is not None and request.balance_date is not None:
        current = request.balance_cents + sum(
            signed_amount(r.tx_type, r.amount_cents)
            for r in rows
            if request.balance_date < r.tx_date <= today
        )
        basis = "confirmed_snapshot"
        if request.balance_date < today and not forecast_math.covered(
            request.balance_date + timedelta(days=1), today, settings["history_coverage"]
        ):
            warnings_list.append("快照日后的账本覆盖未确认，余额推算可能遗漏交易。")
    else:
        current = 0
        basis = "net_cashflow"
        warnings_list.append("未提供余额快照：时间轴显示从今日起累计净现金流变化，不代表账户余额。")
    warnings_list.append("仅计入手动确认的未来收入；额外支出须排除已包含的日常消费和周期账单。")
    bridge_days = (period_start - today).days - 1
    bridge_bills = recurring(rows, today + timedelta(days=1), bridge_days, observed_through=today)
    bridge_variable = round(variable * bridge_days / horizon)
    bridge_events = sum(
        e.amount_cents * (1 if e.kind == "income" else -1)
        for e in request.cash_events
        if e.date < period_start
    )
    bridge_change = bridge_events - bridge_variable - sum(b["amount_cents"] for b in bridge_bills)
    opening = current + bridge_change
    monthly_events = [e for e in request.cash_events if e.date >= period_start]
    planned_expense = sum(e.amount_cents for e in monthly_events if e.kind == "expense")
    expected = fixed + variable + planned_expense
    lower_expense = fixed + variable_lower + planned_expense
    upper_expense = fixed + variable_upper + planned_expense
    timeline = []
    before = after = low = high = opening
    for offset in range(horizon):
        day = period_start + timedelta(days=offset)
        bill = sum(b["amount_cents"] for b in bills if b["date"] == day.isoformat())
        income = sum(e.amount_cents for e in monthly_events if e.date == day and e.kind == "income")
        extra = sum(e.amount_cents for e in monthly_events if e.date == day and e.kind == "expense")
        purchase = request.amount_cents if day == request.purchase_date else 0
        common = income - extra - bill
        before += common - forecast_math.share(variable, offset, horizon)
        after += common - forecast_math.share(variable, offset, horizon) - purchase
        low += common - forecast_math.share(variable_upper, offset, horizon) - purchase
        high += common - forecast_math.share(variable_lower, offset, horizon) - purchase
        timeline.append(
            {
                "date": day.isoformat(),
                "before_cents": before,
                "after_cents": after,
                "lower_cents": low,
                "upper_cents": high,
                "bill_cents": bill,
                "planned_income_cents": income,
                "planned_expense_cents": extra,
            }
        )
    minimum = min(opening, *(x["after_cents"] for x in timeline))
    required = max(0, request.reserve_cents - minimum)
    deficits = [max(0, request.reserve_cents - x["after_cents"]) for x in timeline]
    optimization = optimize_cuts(
        {},
        request.protected_categories,
        required,
        horizon,
        category_totals=forecast_math.allocate(variable, projection["category_variable_cents"]),
        constraints=[c.model_dump() for c in request.category_constraints],
        daily_deficits=deficits,
    )
    saved = 0
    for item, saving in zip(timeline, optimization["daily_savings_cents"], strict=True):
        saved += saving
        item["adjusted_cents"] = item["after_cents"] + saved
    if opening < request.reserve_cents:
        optimization["feasible"] = False
        optimization["shortfall_cents"] = max(
            optimization["shortfall_cents"], request.reserve_cents - opening
        )
        optimization["reason"] = "预测月初已低于目标；需提前补充资金或调整计划"
    base = {
        "daily_cents": round(variable / horizon),
        "lower_daily_cents": round(variable_lower / horizon),
        "upper_daily_cents": round(variable_upper / horizon),
        "method": projection["method"],
        "sample_days": projection["sample_days"],
        "history_start": projection["history_start"],
        "assumptions": [
            "固定账单与可变消费分开预测，金额按分分配",
            "空白月份仅在确认完整覆盖后按零消费处理",
            "预测范围为历史偏差范围，未校准为置信区间",
            "今日至预测月初按预计日常支出、账单和确认收支衔接",
        ]
        + warnings_list,
        "parameters": {
            "history_months": len(projection["history_months"]),
            "recent_month_weight_decay": 0.82,
        },
    }
    return {
        "data_version": data_version,
        "as_of": today.isoformat(),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "currency": "CNY",
        "baseline": base,
        "opening_balance_cents": opening,
        "balance_basis": basis,
        "bridge_change_cents": bridge_change,
        "budget_remaining_cents": summary(db, today, owner_id)["budget_remaining_cents"],
        "purchase_amount_cents": request.amount_cents,
        "minimum_after_cents": minimum,
        "reserve_cents": request.reserve_cents,
        "required_saving_cents": required,
        "optimization": optimization,
        "timeline": timeline,
        "recurring_bills": bills,
        "source_transaction_ids": sorted(r.id for r in rows),
        "expected_expense_cents": expected,
        "expected_expense_after_purchase_cents": expected + request.amount_cents,
        "forecast_lower_expense_cents": lower_expense,
        "forecast_upper_expense_cents": upper_expense,
        "expected_budget_remaining_cents": settings["monthly_budget_cents"]
        - expected
        - request.amount_cents,
        "ai_review": review,
        "ai_delta_cents": ai_delta,
        "fixed_expense_cents": fixed,
        "variable_expense_cents": variable,
        "planned_expense_cents": planned_expense,
        "data_quality": projection["data_quality"],
        "coverage_status": projection["coverage_status"],
        "warnings": warnings_list,
        "interval_method": projection["interval_method"],
        "minimum_adjusted_cents": min(opening, *(x["adjusted_cents"] for x in timeline)),
    }

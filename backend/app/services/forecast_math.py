"""Pure, cent-based forecasting and spending constraints (no database or AI calls)."""

from calendar import monthrange
from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta
from statistics import median

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp

from app.models import Transaction


def shift_month(value: date, offset: int) -> date:
    index = value.year * 12 + value.month - 1 + offset
    return date(index // 12, index % 12 + 1, 1)


def month_end(value: date) -> date:
    return value.replace(day=monthrange(value.year, value.month)[1])


def share(total: int, day: int, days: int) -> int:
    """Distribute all cents, with remainders at the start of the period."""
    return total // days + int(day < total % days)


def net(rows: Sequence[Transaction]) -> int:
    return max(
        0,
        sum(
            r.amount_cents * (1 if r.tx_type == "expense" else -1)
            for r in rows
            if r.tx_type in {"expense", "refund"}
        ),
    )


def covered(start: date, end: date, coverage: list[dict]) -> bool:
    cursor = start
    for item in sorted(coverage, key=lambda x: str(x["start_date"])):
        left, right = (date.fromisoformat(str(item[k])) for k in ("start_date", "end_date"))
        if left > cursor:
            break
        if right >= cursor:
            cursor = right + timedelta(days=1)
        if cursor > end:
            return True
    return False


def observations(
    rows: Sequence[Transaction], as_of: date, coverage: list[dict] | None = None, months: int = 12
) -> list[dict]:
    history = []
    relevant = [r for r in rows if r.tx_type in {"expense", "refund"} and r.tx_date <= as_of]
    first = min((r.tx_date for r in relevant), default=as_of)
    # Include the cutoff month only if it has actually ended.
    stop = shift_month(as_of, 1) if as_of == month_end(as_of) else as_of.replace(day=1)
    for offset in range(-months, 0):
        start = shift_month(stop, offset)
        end = month_end(start)
        items = [r for r in relevant if start <= r.tx_date <= end]
        if coverage:
            if not covered(start, end, coverage):
                continue
        elif not items or (start <= first <= end and first.day > 7):
            continue
        history.append(
            {"month": start.strftime("%Y-%m"), "amount_cents": net(items), "rows": len(items)}
        )
    return history


def recurring(
    rows: Sequence[Transaction], as_of: date, horizon: int, *, observed_through: date | None = None
) -> list[dict]:
    cutoff = observed_through or (as_of - timedelta(days=1))
    groups: dict[tuple[str, str], list[Transaction]] = defaultdict(list)
    for row in rows:
        if row.tx_type in {"expense", "refund"} and row.merchant and row.tx_date <= cutoff:
            groups[(row.merchant.strip().lower(), row.category)].append(row)
    result = []
    for items in groups.values():
        expenses = sorted(
            (r for r in items if r.tx_type == "expense"), key=lambda r: (r.tx_date, r.id)
        )
        if not expenses or expenses[-1].tx_date < shift_month(cutoff, -1):
            continue
        recent = [r for r in items if r.tx_date >= shift_month(cutoff, -6)]
        by_month: dict[str, list[Transaction]] = defaultdict(list)
        for row in recent:
            by_month[row.tx_date.strftime("%Y-%m")].append(row)
        amounts = [net(group) for group in by_month.values()]
        if len(amounts) < 2 or min(amounts) <= 0:
            continue
        center = median(amounts)
        recent_expenses = [r for r in recent if r.tx_type == "expense"]
        days = [r.tx_date.day for r in recent_expenses]
        last_day = all(r.tx_date == month_end(r.tx_date) for r in recent_expenses)
        consecutive = all(
            shift_month(date.fromisoformat(a + "-01"), 1).strftime("%Y-%m") == b
            for a, b in zip(sorted(by_month), sorted(by_month)[1:], strict=False)
        )
        inferred = (
            len(amounts) >= 3
            and consecutive
            and expenses[-1].category in {"居住", "通讯", "教育", "娱乐"}
            and all(sum(r.tx_type == "expense" for r in group) == 1 for group in by_month.values())
            and max(abs(x - center) for x in amounts) <= center * 0.2
            and (last_day or max(days) - min(days) <= 5)
        )
        if not any(r.is_fixed for r in recent_expenses) and not inferred:
            continue
        due_day = 31 if last_day else round(median(days))
        paid = {(r.tx_date.year, r.tx_date.month) for r in expenses}
        for offset in range(horizon):
            target = as_of + timedelta(days=offset)
            if (
                target.day == min(due_day, month_end(target).day)
                and (target.year, target.month) not in paid
            ):
                result.append(
                    {
                        "date": target.isoformat(),
                        "amount_cents": round(center),
                        "merchant": expenses[-1].merchant,
                        "category": expenses[-1].category,
                        "source_ids": [r.id for r in items],
                    }
                )
    return sorted(result, key=lambda b: (b["date"], b["merchant"], b["category"]))


def allocate(total: int, weights: dict[str, int]) -> dict[str, int]:
    positive = {k: v for k, v in sorted(weights.items()) if v > 0}
    denominator = sum(positive.values())
    if not denominator:
        return {"其他": total} if total else {}
    result = {k: total * v // denominator for k, v in positive.items()}
    ranked = sorted(positive, key=lambda k: (-(total * positive[k] % denominator), k))
    for name in ranked[: total - sum(result.values())]:
        result[name] += 1
    return result


def monthly_projection(
    rows: Sequence[Transaction],
    as_of: date,
    period_start: date,
    period_end: date,
    coverage: list[dict] | None = None,
) -> dict:
    rows = [r for r in rows if r.tx_date <= as_of]
    history = observations(rows, as_of, coverage)
    days = (period_end - period_start).days + 1
    bills = recurring(rows, period_start, days, observed_through=as_of)
    fixed_ids = {i for b in bills for i in b["source_ids"]}
    variable_rows = [r for r in rows if r.id not in fixed_ids]
    values = [
        round(
            net([r for r in variable_rows if r.tx_date.strftime("%Y-%m") == h["month"]])
            * days
            / month_end(date.fromisoformat(h["month"] + "-01")).day
        )
        for h in history
    ]
    warnings = []
    observed_dates: set[date] = set()
    if not coverage:
        warnings.append("历史覆盖范围尚未确认；无记录月份不按零消费处理。")
    if values:
        weights = [0.82 ** (len(values) - 1 - i) for i in range(len(values))]
        variable = round(sum(v * w for v, w in zip(values, weights, strict=True)) / sum(weights))
        start = date.fromisoformat(history[0]["month"] + "-01")
        sample_days = sum(month_end(date.fromisoformat(h["month"] + "-01")).day for h in history)
    else:
        eligible = [r for r in variable_rows if r.tx_type in {"expense", "refund"}]
        start = max(as_of - timedelta(days=89), min((r.tx_date for r in eligible), default=as_of))
        if coverage:
            observed_dates = {
                as_of - timedelta(days=d)
                for d in range(90)
                if covered(as_of - timedelta(days=d), as_of - timedelta(days=d), coverage)
            }
            start = min(observed_dates, default=as_of)
        else:
            observed_dates = {start + timedelta(days=d) for d in range((as_of - start).days + 1)}
        sample_days = len(observed_dates)
        # A short observed window is explicitly a provisional estimate.
        variable = round(
            net([r for r in eligible if r.tx_date in observed_dates]) * days / max(1, sample_days)
        )
        warnings.append("完整历史月份不足，当前结果仅供试算，不能视为已验证预测。")
    totals: dict[str, int] = defaultdict(int)
    months = {h["month"] for h in history}
    for row in variable_rows:
        if row.tx_date.strftime("%Y-%m") in months if history else row.tx_date in observed_dates:
            if row.tx_type in {"expense", "refund"}:
                totals[row.category] += row.amount_cents * (1 if row.tx_type == "expense" else -1)
    fixed = sum(b["amount_cents"] for b in bills)
    spread = round(
        max(
            variable * (0.25 if len(values) < 3 else 0.1),
            float(np.quantile([abs(v - variable) for v in values], 0.8)) if values else 0,
        )
    )
    quality = "insufficient" if not history else "limited" if len(history) < 3 else "usable"
    if not rows and not history:
        warnings.append("没有可用历史；零值代表暂无法估计，不代表未来零支出。")
    return {
        "expected_cents": fixed + variable,
        "lower_cents": fixed + max(0, variable - spread),
        "upper_cents": fixed + variable + spread,
        "fixed_cents": fixed,
        "variable_cents": variable,
        "category_variable_cents": allocate(variable, totals),
        "recurring_bills": bills,
        "history_months": history,
        "current_pace_cents": None,
        "sample_days": sample_days,
        "history_start": start.isoformat(),
        "method": "fixed-variable-monthly",
        "coverage_status": "confirmed" if coverage else "inferred",
        "data_quality": quality,
        "warnings": warnings,
        "interval_method": "historical-deviation-not-calibrated",
    }


def category_monthly_averages(
    rows: Sequence[Transaction], as_of: date, coverage: list[dict] | None = None
) -> dict[str, int]:
    history = observations(rows, as_of, coverage, 6)
    months = {h["month"] for h in history}
    totals: dict[str, int] = defaultdict(int)
    for row in rows:
        if row.tx_date <= as_of and row.tx_date.strftime("%Y-%m") in months:
            if row.tx_type in {"expense", "refund"}:
                totals[row.category] += row.amount_cents * (1 if row.tx_type == "expense" else -1)
    return {k: max(0, round(v / len(months))) for k, v in totals.items()} if months else {}


def optimize_cuts(
    category_daily: dict[str, int],
    protected: list[str],
    required_cents: int,
    horizon: int,
    *,
    category_totals: dict[str, int] | None = None,
    constraints: list[dict] | None = None,
    daily_deficits: list[int] | None = None,
) -> dict:
    if horizon < 1:
        raise ValueError("预测天数必须为正数")
    totals = (
        category_totals
        if category_totals is not None
        else {k: v * horizon for k, v in category_daily.items()}
    )
    rules = {r["category"]: r for r in constraints or []}
    candidates = [(k, v) for k, v in sorted(totals.items()) if k not in protected and v > 0]
    deficits = daily_deficits or [0] * (horizon - 1) + [max(0, required_cents)]
    if len(deficits) != horizon:
        raise ValueError("缺口天数与预测天数不一致")
    caps = [
        max(
            0,
            min(
                amount - rules.get(k, {}).get("minimum_cents", 0),
                amount * rules.get(k, {}).get("max_cut_percent", 40) // 100,
            ),
        )
        for k, amount in candidates
    ]
    daily = [0] * horizon
    cuts = []
    needed = max(required_cents, max(deficits))
    solver_incomplete = False
    if candidates and needed > 0 and sum(caps) > 0:
        size = len(candidates) * horizon
        matrix, lower, upper = [], [], []
        for i, cap in enumerate(caps):
            row = np.zeros(size)
            row[i * horizon : (i + 1) * horizon] = 1
            matrix.append(row)
            lower.append(0)
            upper.append(cap)
        for day, deficit in enumerate(deficits):
            row = np.zeros(size)
            for i in range(len(candidates)):
                row[i * horizon : i * horizon + day + 1] = 1
            matrix.append(row)
            lower.append(max(deficit, required_cents if day == horizon - 1 else 0))
            upper.append(np.inf)
            daily_row = np.zeros(size)
            for i in range(len(candidates)):
                daily_row[i * horizon + day] = 1
            matrix.append(daily_row)
            lower.append(0)
            upper.append(share(sum(totals.values()), day, horizon))
        bounds = [share(amount, d, horizon) for _, amount in candidates for d in range(horizon)]
        costs = [
            rules.get(k, {}).get("disruption_weight", 1) * 10000 / amount
            for k, amount in candidates
            for _ in range(horizon)
        ]
        result = milp(
            np.asarray(costs),
            integrality=np.ones(size),
            bounds=Bounds(np.zeros(size), bounds),
            constraints=LinearConstraint(np.asarray(matrix), lower, upper),
            options={"time_limit": 5, "mip_rel_gap": 0},
        )
        solver_incomplete = result.status not in (0, 2)
        if result.success and result.x is not None:
            chosen = [max(0, round(x)) for x in result.x]
            # Check the integer solution, independently of solver tolerances.
            if all(x <= b for x, b in zip(chosen, bounds, strict=True)) and all(
                sum(chosen[i * horizon : (i + 1) * horizon]) <= caps[i]
                for i in range(len(candidates))
            ):
                for i, (name, _) in enumerate(candidates):
                    amounts = chosen[i * horizon : (i + 1) * horizon]
                    if sum(amounts):
                        cuts.append({"category": name, "amount_cents": sum(amounts)})
                        daily = [a + b for a, b in zip(daily, amounts, strict=True)]
                if any(v > share(sum(totals.values()), d, horizon) for d, v in enumerate(daily)):
                    cuts = []
                    daily = [0] * horizon
    cumulative = 0
    shortfall = max(0, required_cents - sum(daily))
    for deficit, saved in zip(deficits, daily, strict=True):
        cumulative += saved
        shortfall = max(shortfall, deficit - cumulative)
    return {
        "feasible": shortfall == 0,
        "cuts": cuts,
        "total_cuts_cents": sum(daily),
        "shortfall_cents": shortfall,
        "daily_savings_cents": daily,
        "capacity_cents": sum(caps),
        "reason": (
            "求解未在时限内完成，尚不能确认可行方案"
            if solver_incomplete
            else "满足分类限额及逐日现金流约束"
            if not shortfall
            else "分类可削减额度或缺口发生前的可节省金额不足"
        ),
    }

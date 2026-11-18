"""Chronological evaluation. Holdout outcomes never participate in model selection."""

from collections.abc import Sequence
from datetime import date, timedelta

from app.models import Transaction

from .forecast import legacy_monthly_projection
from .forecast_math import month_end, monthly_projection, observations

MODELS = ("last-month", "three-month-mean", "legacy-ensemble", "fixed-variable")


def metrics(folds: list[dict], model: str) -> dict:
    errors = [f["predictions"][model]["expected_cents"] - f["actual_cents"] for f in folds]
    intervals = [f["predictions"][model] for f in folds]
    return {
        "months": len(folds),
        "mae_cents": round(sum(abs(e) for e in errors) / len(errors), 2),
        "bias_cents": round(sum(errors) / len(errors), 2),
        "interval_coverage": sum(
            p["lower_cents"] <= f["actual_cents"] <= p["upper_cents"]
            for f, p in zip(folds, intervals, strict=True)
        )
        / len(folds),
        "mean_interval_width_cents": round(
            sum(p["upper_cents"] - p["lower_cents"] for p in intervals) / len(folds), 2
        ),
    }


def evaluate(
    rows: Sequence[Transaction],
    *,
    owner_id: int,
    as_of: date,
    coverage: list[dict] | None = None,
    holdout_months: int = 2,
) -> dict:
    if holdout_months < 1:
        raise ValueError("留出月份至少为 1")
    private = [r for r in rows if r.owner_id == owner_id and r.tx_date <= as_of]
    targets = observations(private, as_of, coverage, months=36)
    folds = []
    for target in targets:
        start = date.fromisoformat(target["month"] + "-01")
        cutoff = start - timedelta(days=1)
        train = [r for r in private if r.tx_date <= cutoff]
        history = observations(train, cutoff, coverage)
        if len(history) < 2:
            continue
        amounts = [h["amount_cents"] for h in history]
        predictions = {}
        for name, value in (
            ("last-month", amounts[-1]),
            ("three-month-mean", round(sum(amounts[-3:]) / len(amounts[-3:]))),
        ):
            # Point baselines intentionally have zero-width intervals.
            predictions[name] = {
                "expected_cents": value,
                "lower_cents": value,
                "upper_cents": value,
            }
        for name, value in (
            ("legacy-ensemble", legacy_monthly_projection(train, cutoff, start, month_end(start))),
            (
                "fixed-variable",
                monthly_projection(train, cutoff, start, month_end(start), coverage),
            ),
        ):
            predictions[name] = {
                k: value[k] for k in ("expected_cents", "lower_cents", "upper_cents")
            }
        folds.append(
            {
                "month": target["month"],
                "train_through": cutoff.isoformat(),
                "actual_cents": target["amount_cents"],
                "predictions": predictions,
            }
        )
    report = {
        "owner_id": owner_id,
        "as_of": as_of.isoformat(),
        "folds": folds,
        "coverage_status": "confirmed" if coverage else "inferred",
        "notes": [
            "每次预测仅使用目标月之前的记录；回测不调用 AI。",
            "点预测基线区间宽度为零；历史偏差区间未经概率校准。",
            "缺少覆盖确认时只评估有记录的月份，结果可能有选择偏差。",
        ],
    }
    if len(folds) <= holdout_months:
        return report | {
            "status": "insufficient",
            "selected_model": None,
            "reason": "至少需要两个训练月、一个验证月及指定留出月份",
        }
    validation, test = folds[:-holdout_months], folds[-holdout_months:]
    scores = {model: metrics(validation, model) for model in MODELS}
    selected = min(MODELS, key=lambda model: scores[model]["mae_cents"])
    return report | {
        "status": "ok",
        "selected_model": selected,
        "validation": scores,
        "test": {model: metrics(test, model) for model in MODELS},
        "validation_months": [f["month"] for f in validation],
        "test_months": [f["month"] for f in test],
        "selected_test": metrics(test, selected),
    }

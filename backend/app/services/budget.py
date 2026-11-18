from collections import defaultdict
from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import CategoryBudget, Setting, Transaction

from .ledger import version
from .money import signed_amount

DEFAULTS = {"monthly_budget_cents": "300000", "opening_balance_cents": "0", "ai_consent": "false"}


def get_settings(db: Session, owner_id: int) -> dict:
    values = DEFAULTS | {
        s.key: s.value for s in db.scalars(select(Setting).where(Setting.owner_id == owner_id))
    }
    return {
        "monthly_budget_cents": int(values["monthly_budget_cents"]),
        "opening_balance_cents": int(values["opening_balance_cents"]),
        "ai_consent": values["ai_consent"] == "true",
        "category_budgets": [
            {"category": row.category, "limit_cents": row.limit_cents}
            for row in db.scalars(
                select(CategoryBudget)
                .where(CategoryBudget.owner_id == owner_id)
                .order_by(CategoryBudget.category)
            )
        ],
        "currency": "CNY",
        "timezone": "Asia/Shanghai",
    }


def save_settings(db: Session, data: dict, owner_id: int) -> dict:
    category_budgets = data.pop("category_budgets", None)
    for key, value in data.items():
        encoded = "true" if value is True else "false" if value is False else str(value)
        row = db.get(Setting, (owner_id, key))
        if row:
            row.value = encoded
        else:
            db.add(Setting(owner_id=owner_id, key=key, value=encoded))
    if category_budgets is not None:
        db.execute(delete(CategoryBudget).where(CategoryBudget.owner_id == owner_id))
        db.add_all(CategoryBudget(owner_id=owner_id, **item) for item in category_budgets)
        db.flush()
    return get_settings(db, owner_id)


def summary(db: Session, as_of: date, owner_id: int) -> dict:
    settings = get_settings(db, owner_id)
    rows = db.scalars(
        select(Transaction).where(Transaction.owner_id == owner_id, Transaction.tx_date <= as_of)
    ).all()
    month = as_of.strftime("%Y-%m")
    current = [r for r in rows if r.tx_date.strftime("%Y-%m") == month]
    expenses = sum(r.amount_cents for r in current if r.tx_type == "expense")
    refunds = sum(r.amount_cents for r in current if r.tx_type == "refund")
    income = sum(r.amount_cents for r in current if r.tx_type == "income")
    categories: dict[str, int] = defaultdict(int)
    for r in current:
        if r.tx_type == "expense":
            categories[r.category] += r.amount_cents
        elif r.tx_type == "refund":
            categories[r.category] -= r.amount_cents
    return {
        "month": month,
        "income_cents": income,
        "expense_cents": expenses - refunds,
        "net_flow_cents": income - expenses + refunds,
        "budget_remaining_cents": settings["monthly_budget_cents"] - expenses + refunds,
        "account_balance_cents": settings["opening_balance_cents"]
        + sum(signed_amount(r.tx_type, r.amount_cents) for r in rows),
        "category_spend": [
            {"category": k, "amount_cents": v}
            for k, v in sorted(categories.items(), key=lambda x: -x[1])
        ],
        "transaction_count": len(current),
    }


def budget_status(db: Session, as_of: date, limits: dict | None = None, *, owner_id: int) -> dict:
    settings = limits if limits is not None else get_settings(db, owner_id)
    month = summary(db, as_of, owner_id)
    spent = max(0, month["expense_cents"])
    total_limit = settings["monthly_budget_cents"]
    alerts = []
    if spent > total_limit:
        alerts.append(
            {
                "scope": "total",
                "category": None,
                "limit_cents": total_limit,
                "spent_cents": spent,
                "over_cents": spent - total_limit,
            }
        )
    category_spend = {
        item["category"]: max(0, item["amount_cents"]) for item in month["category_spend"]
    }
    for item in settings["category_budgets"]:
        category = item["category"]
        category_spent = category_spend.get(category, 0)
        if category_spent > item["limit_cents"]:
            alerts.append(
                {
                    "scope": "category",
                    "category": category,
                    "limit_cents": item["limit_cents"],
                    "spent_cents": category_spent,
                    "over_cents": category_spent - item["limit_cents"],
                }
            )
    return {
        "month": month["month"],
        "as_of": as_of,
        "income_cents": month["income_cents"],
        "spent_cents": spent,
        "total_limit_cents": total_limit,
        "alerts": alerts,
        "data_version": version(db, owner_id),
    }

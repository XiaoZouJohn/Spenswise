"""Walk-forward baseline check; all predictions train strictly before target day."""

from statistics import mean

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Transaction
from app.services.forecast import baseline


def main() -> None:
    with SessionLocal() as db:
        rows = db.scalars(select(Transaction).order_by(Transaction.tx_date)).all()
    if len({r.tx_date for r in rows}) < 35:
        print({"status": "insufficient_history", "required_active_days": 35})
        return
    dates = sorted({r.tx_date for r in rows})
    errors = []
    for anchor in dates[-28:]:
        estimate = baseline([r for r in rows if r.tx_date < anchor], anchor, 1)["daily_cents"]
        actual = sum(
            r.amount_cents
            if r.tx_type == "expense"
            else -r.amount_cents
            if r.tx_type == "refund"
            else 0
            for r in rows
            if r.tx_date == anchor
        )
        errors.append(abs(estimate - max(0, actual)))
    print(
        {
            "status": "ok",
            "holdout_days": len(errors),
            "mae_cents": round(mean(errors)),
            "split": "walk-forward",
            "leakage": "target and later rows excluded",
        }
    )


if __name__ == "__main__":
    main()

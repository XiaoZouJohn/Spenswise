"""Run with python -m scripts.backtest_forecast --input ledger.json --owner-id 1 --as-of YYYY-MM-DD.

Input: {"transactions": [{id, owner_id, tx_date, amount_cents, tx_type, category,
merchant, is_fixed}], "coverage": [{start_date, end_date}]}. Coverage applies to
the selected owner only. This offline command never connects to a database or AI.
"""

import argparse
import json
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from app.services.backtest import evaluate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--owner-id", type=int, required=True)
    parser.add_argument("--as-of", type=date.fromisoformat, required=True)
    parser.add_argument("--holdout-months", type=int, default=2)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8-sig"))
    rows = [
        SimpleNamespace(**(r | {"tx_date": date.fromisoformat(r["tx_date"])}))
        for r in payload["transactions"]
    ]
    report = evaluate(
        rows,
        owner_id=args.owner_id,
        as_of=args.as_of,
        coverage=payload.get("coverage"),
        holdout_months=args.holdout_months,
    )
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f'{report["status"]}: {args.output}')


if __name__ == "__main__":
    main()

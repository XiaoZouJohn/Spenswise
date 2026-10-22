from decimal import ROUND_HALF_UP, Decimal


def to_cents(value: str | int | float) -> int:
    amount = Decimal(str(value).replace(",", "").replace("¥", "").strip())
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def signed_amount(tx_type: str, amount_cents: int) -> int:
    return (
        amount_cents
        if tx_type in ("income", "refund")
        else -amount_cents
        if tx_type == "expense"
        else 0
    )

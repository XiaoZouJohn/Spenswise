import hashlib
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CategoryBudget, MerchantRule, Setting, Transaction
from app.schemas import TransactionIn


def fingerprint(
    tx_date: date, amount_cents: int, tx_type: str, merchant: str, description: str
) -> str:
    parts = [
        tx_date.isoformat(),
        str(amount_cents),
        tx_type.lower(),
        " ".join(merchant.lower().split()),
        " ".join(description.lower().split()),
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def classify(db: Session, merchant: str, category: str, owner_id: int) -> tuple[str, int, str]:
    if category and category != "待确认":
        return category, 100, "用户指定"
    rules = db.scalars(
        select(MerchantRule).where(MerchantRule.owner_id == owner_id).order_by(MerchantRule.id)
    ).all()
    for rule in rules:
        if rule.merchant_pattern.lower() in merchant.lower():
            return rule.category, 90, "商户规则"
    return "待确认", 0, "需要审核"


def add_transaction(
    db: Session, item: TransactionIn, source: str = "manual", *, owner_id: int
) -> tuple[Transaction, bool]:
    fp = fingerprint(item.tx_date, item.amount_cents, item.tx_type, item.merchant, item.description)
    existing = db.scalar(
        select(Transaction).where(Transaction.owner_id == owner_id, Transaction.fingerprint == fp)
    )
    if existing:
        return existing, False
    category, confidence, reason = classify(db, item.merchant, item.category, owner_id)
    row = Transaction(
        owner_id=owner_id,
        **item.model_dump(exclude={"category"}),
        category=category,
        confidence=confidence,
        classification_reason=reason,
        source=source,
        fingerprint=fp,
    )
    db.add(row)
    db.flush()
    return row, True


def batch_category(
    db: Session, ids: list[int], category: str, create_rule: bool, owner_id: int
) -> list[dict]:
    before = []
    for row in db.scalars(
        select(Transaction).where(Transaction.owner_id == owner_id, Transaction.id.in_(ids))
    ):
        before.append({"id": row.id, "category": row.category})
        row.category = category
        row.confidence = 100
        row.classification_reason = "用户批量修改"
        if (
            create_rule
            and row.merchant
            and not db.scalar(
                select(MerchantRule).where(
                    MerchantRule.owner_id == owner_id, MerchantRule.merchant_pattern == row.merchant
                )
            )
        ):
            db.add(
                MerchantRule(owner_id=owner_id, merchant_pattern=row.merchant, category=category)
            )
    return before


def version(db: Session, owner_id: int) -> str:
    digest = hashlib.sha256()
    for row in db.scalars(
        select(Transaction).where(Transaction.owner_id == owner_id).order_by(Transaction.id)
    ):
        fields = (
            row.id,
            row.tx_date.isoformat(),
            row.amount_cents,
            row.tx_type,
            row.merchant,
            row.description,
            row.category,
            row.is_fixed,
        )
        digest.update(repr(fields).encode("utf-8"))
    for setting in db.scalars(
        select(Setting).where(Setting.owner_id == owner_id).order_by(Setting.key)
    ):
        if setting.key != "ai_consent":
            digest.update(f"{setting.key}:{setting.value}".encode("utf-8"))
    for item in db.scalars(
        select(CategoryBudget)
        .where(CategoryBudget.owner_id == owner_id)
        .order_by(CategoryBudget.category)
    ):
        digest.update(f"{item.category}:{item.limit_cents}".encode("utf-8"))
    return digest.hexdigest()[:16]

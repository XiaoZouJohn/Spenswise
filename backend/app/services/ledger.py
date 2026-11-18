import hashlib
from datetime import date

from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from app.models import CategoryBudget, HouseholdProposal, MerchantRule, Setting, Transaction
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


def list_transactions(
    db: Session,
    *,
    owner_id: int,
    page: int,
    page_size: int,
    category: str | None = None,
    tx_type: str | None = None,
    merchant: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    review: bool = False,
    ids: list[int] | None = None,
) -> tuple[list[Transaction], int, dict]:
    if date_from and date_to and date_from > date_to:
        raise ValueError("开始日期不能晚于结束日期")

    statement = select(Transaction).where(Transaction.owner_id == owner_id)
    if ids:
        statement = statement.where(Transaction.id.in_(ids))
    if category:
        statement = statement.where(Transaction.category == category)
    if tx_type:
        statement = statement.where(Transaction.tx_type == tx_type)
    if merchant and merchant.strip():
        escaped = merchant.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        statement = statement.where(Transaction.merchant.ilike(f"%{escaped}%", escape="\\"))
    if date_from:
        statement = statement.where(Transaction.tx_date >= date_from)
    if date_to:
        statement = statement.where(Transaction.tx_date <= date_to)
    if review:
        statement = statement.where(Transaction.category == "待确认")

    filtered = statement.subquery()
    totals = db.execute(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (filtered.c.tx_type == "expense", filtered.c.amount_cents),
                        (filtered.c.tx_type == "refund", -filtered.c.amount_cents),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(case((filtered.c.tx_type == "income", filtered.c.amount_cents), else_=0)),
                0,
            ),
            func.count(),
        ).select_from(filtered)
    ).one()
    expense_cents, income_cents, total = (int(value or 0) for value in totals)
    category_expression = func.sum(case(
        (filtered.c.tx_type == "expense", filtered.c.amount_cents),
        (filtered.c.tx_type == "refund", -filtered.c.amount_cents), else_=0,
    ))
    category_spend = [
        {"category": category, "amount_cents": int(amount)}
        for category, amount in db.execute(select(filtered.c.category, category_expression)
            .group_by(filtered.c.category).having(category_expression != 0)
            .order_by(category_expression.desc()))
    ]
    items = list(
        db.scalars(
            statement.order_by(Transaction.tx_date.desc(), Transaction.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return (
        items,
        total,
        {
            "expense_cents": expense_cents,
            "income_cents": income_cents,
            "category_spend": category_spend,
            "net_flow_cents": income_cents - expense_cents,
        },
    )


def delete_transaction(db: Session, transaction_id: int, owner_id: int) -> bool:
    row = db.get(Transaction, transaction_id)
    if not row or row.owner_id != owner_id:
        return False
    if db.scalar(
        select(HouseholdProposal.id).where(
            HouseholdProposal.linked_transaction_id == transaction_id
        )
    ):
        raise ValueError("请先解除议事提案的账单关联")
    db.delete(row)
    return True


def delete_all_transactions(db: Session, owner_id: int) -> int:
    owned_ids = select(Transaction.id).where(Transaction.owner_id == owner_id)
    linked_count = db.scalar(
        select(func.count())
        .select_from(HouseholdProposal)
        .where(HouseholdProposal.linked_transaction_id.in_(owned_ids))
    )
    if linked_count:
        raise ValueError(f"有 {linked_count} 笔账单关联了家庭议事，请先解除关联")
    result = db.execute(delete(Transaction).where(Transaction.owner_id == owner_id))
    return int(result.rowcount or 0)


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
        if setting.key != "ai_consent" and not setting.key.startswith("monthly_review:"):
            digest.update(f"{setting.key}:{setting.value}".encode("utf-8"))
    for item in db.scalars(
        select(CategoryBudget)
        .where(CategoryBudget.owner_id == owner_id)
        .order_by(CategoryBudget.category)
    ):
        digest.update(f"{item.category}:{item.limit_cents}".encode("utf-8"))
    return digest.hexdigest()[:16]

"""Owner-scoped life records and links. All amounts come from shared ledger services."""

import calendar
import hashlib
import json
import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.models import (
    AssetSnapshot,
    ConsumptionEvent,
    ImportJob,
    LifeLog,
    LifeLogTransaction,
    Setting,
    Transaction,
    WorkspaceDraft,
)

from . import budget, ledger, monthly_review


def now():
    return datetime.now(timezone.utc)


def local_today():
    return datetime.now(ZoneInfo("Asia/Shanghai")).date()


def period(month: str):
    first = date.fromisoformat(month + "-01")
    last = date(first.year, first.month, calendar.monthrange(first.year, first.month)[1])
    return first, min(last, local_today()) if month == local_today().strftime("%Y-%m") else last


def owned_transactions(db: Session, owner_id: int, ids: list[int]):
    unique = list(dict.fromkeys(ids))
    rows = list(
        db.scalars(
            select(Transaction).where(Transaction.owner_id == owner_id, Transaction.id.in_(unique))
        )
    )
    if len(rows) != len(unique):
        raise LookupError("关联账单不存在或不属于当前账号")
    return rows


def account(db: Session, owner_id: int, key: str, *, include_archived=False):
    row = db.scalar(
        select(AssetSnapshot)
        .where(AssetSnapshot.owner_id == owner_id, AssetSnapshot.account_key == key)
        .order_by(AssetSnapshot.as_of.desc(), AssetSnapshot.id.desc())
    )
    if row is None or (row.archived and not include_archived):
        raise LookupError("账户不存在或已归档")
    return row


def log_out(db: Session, row: LifeLog):
    ids = list(
        db.scalars(
            select(LifeLogTransaction.transaction_id)
            .join(Transaction, Transaction.id == LifeLogTransaction.transaction_id)
            .where(
                LifeLogTransaction.owner_id == row.owner_id,
                Transaction.owner_id == row.owner_id,
                LifeLogTransaction.log_id == row.id,
            )
        )
    )
    return {
        "id": row.id,
        "event_date": row.event_date,
        "title": row.title,
        "content": row.content,
        "visibility": row.visibility,
        "ai_allowed": row.ai_allowed,
        "revision": row.revision,
        "transaction_ids": ids,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "deleted": row.deleted,
    }


def logs(db: Session, owner_id: int, month: str | None = None, transaction_id: int | None = None):
    statement = select(LifeLog).where(LifeLog.owner_id == owner_id, LifeLog.deleted.is_(False))
    if month:
        start, end = period(month)
        statement = statement.where(LifeLog.event_date.between(start, end))
    if transaction_id is not None:
        owned_transactions(db, owner_id, [transaction_id])
        statement = statement.where(
            LifeLog.id.in_(
                select(LifeLogTransaction.log_id).where(
                    LifeLogTransaction.owner_id == owner_id,
                    LifeLogTransaction.transaction_id == transaction_id,
                )
            )
        )
    return [
        log_out(db, row)
        for row in db.scalars(
            statement.order_by(LifeLog.event_date.desc(), LifeLog.created_at.desc()).limit(200)
        )
    ]


def get_log(db: Session, owner_id: int, log_id: str, *, include_deleted=False):
    row = db.scalar(select(LifeLog).where(LifeLog.id == log_id, LifeLog.owner_id == owner_id))
    if row is None or (row.deleted and not include_deleted):
        raise LookupError("生活记录不存在")
    return row


def save_log(db: Session, owner_id: int, value: dict, log_id: str | None = None):
    ids = list(dict.fromkeys(value.pop("transaction_ids")))
    owned_transactions(db, owner_id, ids)
    revision = value.pop("revision")
    if not value["content"].strip():
        raise ValueError("请填写一句生活记录")
    if log_id:
        row = get_log(db, owner_id, log_id)
        result = db.execute(
            update(LifeLog)
            .where(
                LifeLog.id == log_id,
                LifeLog.owner_id == owner_id,
                LifeLog.revision == revision,
                LifeLog.deleted.is_(False),
            )
            .values(**value, revision=revision + 1, updated_at=now())
        )
        if result.rowcount != 1:
            raise ValueError("记录已在其他窗口更新，请重新读取")
        db.expire(row)
    else:
        row = LifeLog(
            id=str(uuid.uuid4()), owner_id=owner_id, **value, created_at=now(), updated_at=now()
        )
        db.add(row)
        db.flush()
    db.execute(
        delete(LifeLogTransaction).where(
            LifeLogTransaction.owner_id == owner_id, LifeLogTransaction.log_id == row.id
        )
    )
    db.add_all(
        LifeLogTransaction(owner_id=owner_id, log_id=row.id, transaction_id=tx_id) for tx_id in ids
    )
    db.flush()
    return log_out(db, row)


def delete_log(db: Session, owner_id: int, log_id: str, revision: int):
    get_log(db, owner_id, log_id)
    result = db.execute(
        update(LifeLog)
        .where(LifeLog.id == log_id, LifeLog.owner_id == owner_id, LifeLog.revision == revision)
        .values(
            deleted=True,
            title="",
            content="",
            ai_allowed=False,
            revision=revision + 1,
            updated_at=now(),
        )
    )
    if result.rowcount != 1:
        raise ValueError("记录已更新，请重新读取后删除")
    db.execute(
        delete(LifeLogTransaction).where(
            LifeLogTransaction.owner_id == owner_id, LifeLogTransaction.log_id == log_id
        )
    )
    return {"deleted": True}


def review_log_refs(db: Session, owner_id: int, ids: list[str]):
    result = []
    for log_id in dict.fromkeys(ids):
        row = get_log(db, owner_id, log_id, include_deleted=True)
        result.append(
            {
                "id": log_id,
                "title": "来源已删除" if row.deleted else row.title or row.content[:60],
                "type": "life_log",
                "label": "来源已删除" if row.deleted else row.title or row.content[:60],
                "href": f"/logs?log={log_id}",
                "event_date": row.event_date.isoformat(),
                "deleted": row.deleted,
                "transaction_count": 0 if row.deleted else len(log_out(db, row)["transaction_ids"]),
            }
        )
    return result


def source(db: Session, owner_id: int, ref: dict):
    kind, key = ref.get("type"), str(ref.get("id", ""))
    base = {
        "type": kind,
        "id": key,
        "deleted": False,
        "label": ref.get("label", "查看来源"),
        "href": "/overview",
    }
    if kind == "transaction":
        row = db.scalar(
            select(Transaction).where(Transaction.owner_id == owner_id, Transaction.id == int(key))
        )
        base.update(
            deleted=row is None,
            href=f"/ledger?ids={key}&detail={key}",
            label=row.merchant if row else "账单已删除",
        )
    elif kind == "life_log":
        log = get_log(db, owner_id, key, include_deleted=True)
        base.update(
            deleted=log.deleted,
            label="来源已删除" if log.deleted else log.title or log.content[:40],
            href=f"/logs?log={key}",
        )
    elif kind == "review":
        review = monthly_review.read(db, owner_id, key)
        base.update(deleted=not review["saved_at"], href=f"/review?month={key}", label="本月回顾")
    elif kind == "account":
        snapshot = account(db, owner_id, key, include_archived=True)
        base.update(href=f"/accounts?account={key}", label=snapshot.name)
    else:
        start, end = period(key)
        base.update(
            type="ledger",
            href=f"/ledger?date_from={start.isoformat()}&date_to={end.isoformat()}",
            label="月度账本",
        )
    return base


def event_out(db: Session, owner_id: int, row: ConsumptionEvent):
    transaction = db.scalar(
        select(Transaction).where(
            Transaction.id == row.transaction_id, Transaction.owner_id == owner_id
        )
    )
    return {
        "id": row.id,
        "transaction_id": row.transaction_id,
        "origin": row.origin,
        "reason": row.reason,
        "purpose": row.purpose,
        "feeling": row.feeling,
        "note": row.note,
        "deferred": row.deferred,
        "revision": row.revision,
        "updated_at": row.updated_at,
        "transaction": tx_out(transaction) if transaction else None,
        "logs": logs(db, owner_id, transaction_id=transaction.id) if transaction else [],
    }


def tx_out(row: Transaction):
    return {
        "id": row.id,
        "tx_date": row.tx_date.isoformat(),
        "merchant": row.merchant,
        "category": row.category,
        "tx_type": row.tx_type,
        "amount_cents": row.amount_cents,
        "account_key": row.account_key,
    }


def events(db: Session, owner_id: int, month: str):
    start, end = period(month)
    rows = list(
        db.scalars(
            select(ConsumptionEvent)
            .join(Transaction, Transaction.id == ConsumptionEvent.transaction_id)
            .where(
                ConsumptionEvent.owner_id == owner_id,
                Transaction.owner_id == owner_id,
                Transaction.tx_date.between(start, end),
            )
        )
    )
    result = [event_out(db, owner_id, row) for row in rows]
    linked = {row.transaction_id for row in rows}
    for tx in db.scalars(
        select(Transaction)
        .where(
            Transaction.owner_id == owner_id,
            Transaction.tx_date.between(start, end),
            Transaction.tx_type == "expense",
            Transaction.amount_cents >= 50000,
        )
        .order_by(Transaction.amount_cents.desc())
        .limit(30)
    ):
        if tx.id not in linked:
            result.append(
                {
                    "id": f"rule-{tx.id}",
                    "transaction_id": tx.id,
                    "origin": "rule",
                    "reason": "单笔支出达到500元，建议回看",
                    "purpose": "",
                    "feeling": "",
                    "note": "",
                    "deferred": False,
                    "revision": 0,
                    "transaction": tx_out(tx),
                    "logs": logs(db, owner_id, transaction_id=tx.id),
                }
            )
    return result


def save_event(db: Session, owner_id: int, transaction_id: int, value: dict):
    owned_transactions(db, owner_id, [transaction_id])
    row = db.scalar(
        select(ConsumptionEvent).where(
            ConsumptionEvent.owner_id == owner_id, ConsumptionEvent.transaction_id == transaction_id
        )
    )
    revision = value.pop("revision")
    if row:
        result = db.execute(
            update(ConsumptionEvent)
            .where(
                ConsumptionEvent.id == row.id,
                ConsumptionEvent.owner_id == owner_id,
                ConsumptionEvent.revision == revision,
            )
            .values(**value, revision=revision + 1, updated_at=now())
        )
        if result.rowcount != 1:
            raise ValueError("事件已更新，请重新读取")
        db.expire(row)
    else:
        if revision != 0:
            raise ValueError("事件版本已变化")
        row = ConsumptionEvent(
            id=str(uuid.uuid4()),
            owner_id=owner_id,
            transaction_id=transaction_id,
            origin="user",
            reason="用户主动标记",
            **value,
            updated_at=now(),
        )
        db.add(row)
    db.flush()
    return event_out(db, owner_id, row)


def draft(db: Session, owner_id: int, kind: str, resource: str):
    if kind not in {"life-log", "monthly-review", "workspace"} or len(resource) > 100:
        raise ValueError("草稿类型无效")
    if kind == "life-log" and resource != "new":
        get_log(db, owner_id, resource)
    if kind == "monthly-review":
        period(resource)
    row = db.get(WorkspaceDraft, (owner_id, kind, resource))
    return {
        "content": row.content if row else {},
        "revision": row.revision if row else 0,
        "updated_at": row.updated_at if row else None,
    }


def save_draft(db: Session, owner_id: int, kind: str, resource: str, value: dict):
    current = draft(db, owner_id, kind, resource)
    if len(json.dumps(value["content"], ensure_ascii=False)) > 20000:
        raise ValueError("草稿过长")
    if current["revision"] != value["revision"]:
        raise ValueError("草稿已在另一窗口更新")
    row = db.get(WorkspaceDraft, (owner_id, kind, resource))
    if row:
        result = db.execute(
            update(WorkspaceDraft)
            .where(
                WorkspaceDraft.owner_id == owner_id,
                WorkspaceDraft.resource_type == kind,
                WorkspaceDraft.resource_id == resource,
                WorkspaceDraft.revision == value["revision"],
            )
            .values(content=value["content"], revision=value["revision"] + 1, updated_at=now())
        )
        if result.rowcount != 1:
            raise ValueError("草稿版本冲突")
        db.expire(row)
    else:
        db.add(
            WorkspaceDraft(
                owner_id=owner_id,
                resource_type=kind,
                resource_id=resource,
                content=value["content"],
                updated_at=now(),
            )
        )
    db.flush()
    return draft(db, owner_id, kind, resource)


def clear_draft(db: Session, owner_id: int, kind: str, resource: str, revision: int):
    current = draft(db, owner_id, kind, resource)
    if current["revision"] != revision:
        raise ValueError("草稿已更新")
    return save_draft(db, owner_id, kind, resource, {"content": {}, "revision": revision})


def batch_review(db: Session, owner_id: int, value: dict):
    rows = owned_transactions(db, owner_id, value["ids"])
    if value.get("account_key"):
        account(db, owner_id, value["account_key"])
    before = []
    for row in rows:
        before.append(
            {
                "id": row.id,
                "category": row.category,
                "tx_date": row.tx_date.isoformat(),
                "account_key": row.account_key,
            }
        )
        if value.get("category"):
            row.category = value["category"]
            row.confidence = 100
            row.classification_reason = "用户核对"
        if value.get("tx_date"):
            row.tx_date = value["tx_date"]
            row.fingerprint = ledger.fingerprint(
                row.tx_date, row.amount_cents, row.tx_type, row.merchant, row.description
            )
        if value.get("clear_account"):
            row.account_key = None
        elif value.get("account_key"):
            row.account_key = value["account_key"]
        row.reviewed = value["confirmed"]
    db.flush()
    return {"updated": len(rows), "before": before}


def market(db: Session, owner_id: int, month: str):
    first, end = period(month)
    previous_end = first.fromordinal(first.toordinal() - 1)
    days = min(end.day, previous_end.day)
    comparison_end = date(previous_end.year, previous_end.month, days)
    current = budget.summary(db, end, owner_id)
    previous = budget.summary(db, comparison_end, owner_id)
    old = {item["category"]: item["amount_cents"] for item in previous["category_spend"]}
    current_items = current["category_spend"] + [
        {"category": key, "amount_cents": 0}
        for key in old
        if key not in {item["category"] for item in current["category_spend"]}
    ]
    categories = [
        {
            **item,
            "previous_cents": old.get(item["category"], 0),
            "change_cents": item["amount_cents"] - old.get(item["category"], 0),
        }
        for item in current_items
    ]
    return {
        "month": month,
        "facts": current,
        "categories": categories,
        "comparison_from": previous_end.replace(day=1).isoformat(),
        "comparison_to": comparison_end.isoformat(),
        "events": events(db, owner_id, month),
        "logs": logs(db, owner_id, month),
    }


def state(db: Session, owner_id: int, month: str):
    waiting = Transaction.owner_id == owner_id
    unclassified = (
        db.scalar(
            select(func.count())
            .select_from(Transaction)
            .where(waiting, Transaction.category == "待确认")
        )
        or 0
    )
    unreviewed = (
        db.scalar(
            select(func.count())
            .select_from(Transaction)
            .where(
                waiting,
                or_(
                    Transaction.category == "待确认",
                    Transaction.reviewed.is_(False) & (Transaction.confidence < 80),
                ),
            )
        )
        or 0
    )
    jobs = list(
        db.scalars(
            select(ImportJob)
            .where(ImportJob.owner_id == owner_id)
            .order_by(ImportJob.id.desc())
            .limit(30)
        )
    )
    errors = sum(len(job.errors or []) for job in jobs)
    review = monthly_review.read(db, owner_id, month)
    latest = {}
    for row in db.scalars(
        select(AssetSnapshot)
        .where(AssetSnapshot.owner_id == owner_id)
        .order_by(AssetSnapshot.as_of, AssetSnapshot.id)
    ):
        latest[row.account_key] = row
    policy = db.get(Setting, (owner_id, "family_asset_valid_days"))
    valid_days = int(policy.value) if policy else 30
    stale = sum(
        1
        for row in latest.values()
        if not row.archived and (local_today() - row.as_of).days > valid_days
    )
    event_count = sum(not item["deferred"] for item in events(db, owner_id, month))
    buildings = {
        "ledger": {"count": unreviewed + errors, "label": "账房待整理", "href": "/ledger?review=1"},
        "bank": {
            "count": stale,
            "label": "快照待更新" if stale else "账户记录",
            "href": "/accounts",
        },
        "market": {
            "count": event_count,
            "label": "消费值得回看",
            "href": "/simulate?view=spending",
        },
        "hall": {
            "count": 0 if review["saved_at"] else 1,
            "label": "本月回顾已完成" if review["saved_at"] else "本月回顾待整理",
            "href": f"/review?month={month}",
        },
    }
    return {
        "month": month,
        "buildings": buildings,
        "unclassified": unclassified,
        "unreviewed": unreviewed,
        "import_errors": errors,
        "jobs": [
            {
                "id": job.id,
                "status": job.status,
                "filename": job.filename,
                "inserted": job.inserted,
                "duplicates": job.duplicates,
                "errors": job.errors,
                "error_message": job.error_message,
            }
            for job in jobs
        ],
        "review_completed": bool(review["saved_at"]),
        "character_hint": f"账房还有{unreviewed}笔账待整理"
        if unreviewed
        else "今天的账簿已经整理好了",
    }


def input_version(db: Session, owner_id: int, month: str):
    digest = hashlib.sha256(ledger.version(db, owner_id).encode())
    for snapshot in db.scalars(
        select(AssetSnapshot).where(AssetSnapshot.owner_id == owner_id).order_by(AssetSnapshot.id)
    ):
        digest.update(
            f"{snapshot.id}:{snapshot.balance_cents}:{snapshot.as_of}:{snapshot.archived}".encode()
        )
    for row in db.scalars(select(LifeLog).where(LifeLog.owner_id == owner_id).order_by(LifeLog.id)):
        digest.update(f"{row.id}:{row.revision}:{row.ai_allowed}:{row.deleted}".encode())
    for event_row in db.scalars(
        select(ConsumptionEvent)
        .where(ConsumptionEvent.owner_id == owner_id)
        .order_by(ConsumptionEvent.id)
    ):
        digest.update(f"{event_row.id}:{event_row.revision}".encode())
    review = db.get(Setting, (owner_id, f"monthly_review:{month}"))
    digest.update((review.value if review else "").encode())
    return digest.hexdigest()


def account_sources(db: Session, owner_id: int):
    latest = {}
    for snapshot in db.scalars(
        select(AssetSnapshot)
        .where(AssetSnapshot.owner_id == owner_id)
        .order_by(AssetSnapshot.as_of, AssetSnapshot.id)
    ):
        latest[snapshot.account_key] = snapshot
    return [
        {
            "account_key": row.account_key,
            "snapshot_id": row.id,
            "name": row.name,
            "kind": row.kind,
            "balance_cents": row.balance_cents,
            "as_of": row.as_of.isoformat(),
        }
        for row in latest.values()
        if not row.archived
    ][:20]

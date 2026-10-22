"""Household membership, privacy boundaries, and shared financial calculations."""

import secrets
import uuid
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import NoReturn

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth import token_hash
from app.models import (
    AssetSnapshot,
    Household,
    HouseholdBudget,
    HouseholdGoal,
    HouseholdInvitation,
    HouseholdMember,
    HouseholdProposal,
    ProposalComment,
    Setting,
    Transaction,
    User,
)
from app.services.forecast import baseline, recurring


def _error(status: int, code: str, message: str) -> NoReturn:
    raise HTTPException(status, detail={"code": code, "message": message})


def membership(db: Session, user_id: int) -> HouseholdMember | None:
    return db.get(HouseholdMember, user_id)


def require_member(db: Session, user_id: int) -> HouseholdMember:
    row = membership(db, user_id)
    if row is None:
        _error(404, "NO_FAMILY", "尚未加入家庭")
    return row


def require_leader(db: Session, user_id: int) -> HouseholdMember:
    row = require_member(db, user_id)
    if row.role != "leader":
        _error(403, "LEADER_REQUIRED", "仅家庭负责人可操作")
    return row


def family_summary(db: Session, user_id: int) -> dict | None:
    member = membership(db, user_id)
    if member is None:
        return None
    family = db.get(Household, member.household_id)
    if family is None:
        return None
    count = (
        db.scalar(
            select(func.count())
            .select_from(HouseholdMember)
            .where(HouseholdMember.household_id == family.id)
        )
        or 0
    )
    return {"id": family.id, "name": family.name, "role": member.role, "member_count": count}


def create_family(db: Session, user_id: int, name: str, today: date) -> dict:
    if membership(db, user_id):
        _error(409, "ALREADY_IN_FAMILY", "请先退出当前家庭")
    family = Household(name=name.strip())
    db.add(family)
    db.flush()
    db.add(
        HouseholdMember(
            user_id=user_id,
            household_id=family.id,
            role="leader",
            share_transactions=True,
            share_from=today,
        )
    )
    db.add(HouseholdBudget(household_id=family.id, monthly_budget_cents=0, category_budgets=[]))
    db.flush()
    summary = family_summary(db, user_id)
    if summary is None:
        _error(500, "FAMILY_CREATION_FAILED", "家庭创建失败")
    return summary


def members(db: Session, user_id: int) -> list[dict]:
    member = require_member(db, user_id)
    rows = db.execute(
        select(HouseholdMember, User)
        .join(User, User.id == HouseholdMember.user_id)
        .where(HouseholdMember.household_id == member.household_id)
        .order_by(HouseholdMember.joined_at, HouseholdMember.user_id)
    ).all()
    return [
        {
            "user_id": user.id,
            "display_name": user.display_name,
            "email": user.email,
            "role": row.role,
            "share_from": row.share_from,
            "share_transactions": row.share_transactions,
            "joined_at": row.joined_at,
        }
        for row, user in rows
    ]


def invite(db: Session, user_id: int, email: str | None) -> dict:
    member = require_leader(db, user_id)
    normalized = email.strip().lower() if email else None
    if normalized and "@" not in normalized:
        _error(422, "INVALID_EMAIL", "邮箱格式无效")
    code = secrets.token_urlsafe(24)
    expires = datetime.now(timezone.utc) + timedelta(days=7)
    db.add(
        HouseholdInvitation(
            household_id=member.household_id,
            code_hash=token_hash(code),
            invited_email=normalized,
            expires_at=expires,
            created_by=user_id,
        )
    )
    db.flush()
    return {"code": code, "expires_at": expires}


def preview_invite(db: Session, user: User, code: str) -> dict:
    invitation = db.scalar(
        select(HouseholdInvitation).where(HouseholdInvitation.code_hash == token_hash(code))
    )
    if invitation is None or invitation.accepted_at is not None:
        _error(404, "INVITATION_NOT_FOUND", "邀请无效或已使用")
    expiry = invitation.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry < datetime.now(timezone.utc):
        _error(410, "INVITATION_EXPIRED", "邀请已过期")
    if invitation.invited_email and invitation.invited_email != user.email:
        _error(403, "INVITATION_EMAIL_MISMATCH", "该邀请指定了其他邮箱")
    family = db.get(Household, invitation.household_id)
    inviter = db.get(User, invitation.created_by)
    if family is None or inviter is None:
        _error(404, "INVITATION_NOT_FOUND", "邀请无效")
    return {
        "family_name": family.name,
        "inviter_name": inviter.display_name,
        "expires_at": invitation.expires_at,
    }


def accept_invite(
    db: Session,
    user: User,
    code: str,
    share_from: date | None,
    share_transactions: bool,
    today: date,
) -> dict:
    if membership(db, user.id):
        _error(409, "ALREADY_IN_FAMILY", "请先退出当前家庭")
    invitation = db.scalar(
        select(HouseholdInvitation).where(HouseholdInvitation.code_hash == token_hash(code))
    )
    if invitation is None or invitation.accepted_at is not None:
        _error(404, "INVITATION_NOT_FOUND", "邀请无效或已使用")
    expiry = invitation.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry < datetime.now(timezone.utc):
        _error(410, "INVITATION_EXPIRED", "邀请已过期")
    if invitation.invited_email and invitation.invited_email != user.email:
        _error(403, "INVITATION_EMAIL_MISMATCH", "该邀请指定了其他邮箱")
    if not share_transactions:
        _error(422, "SHARING_REQUIRED", "加入前需要明确同意共享收支")
    start = share_from or today
    if start > today:
        _error(422, "INVALID_SHARE_DATE", "共享起点不能晚于今天")
    consumed = db.execute(
        update(HouseholdInvitation)
        .where(
            HouseholdInvitation.id == invitation.id,
            HouseholdInvitation.accepted_at.is_(None),
        )
        .values(accepted_at=datetime.now(timezone.utc))
    )
    if consumed.rowcount != 1:
        _error(409, "INVITATION_USED", "邀请已被使用")
    db.add(
        HouseholdMember(
            user_id=user.id,
            household_id=invitation.household_id,
            role="member",
            share_transactions=True,
            share_from=start,
        )
    )
    db.flush()
    summary = family_summary(db, user.id)
    if summary is None:
        _error(500, "FAMILY_JOIN_FAILED", "加入家庭失败")
    return summary


def sharing(db: Session, user_id: int) -> dict:
    member = require_member(db, user_id)
    return {"share_from": member.share_from, "share_transactions": member.share_transactions}


def set_sharing(
    db: Session, user_id: int, share_from: date, share_transactions: bool, today: date
) -> dict:
    member = require_member(db, user_id)
    if share_from > today:
        _error(422, "INVALID_SHARE_DATE", "共享起点不能晚于今天")
    member.share_from = share_from
    member.share_transactions = share_transactions
    db.flush()
    return sharing(db, user_id)


def leave_family(db: Session, user_id: int) -> None:
    member = require_member(db, user_id)
    if member.role == "leader":
        count = (
            db.scalar(
                select(func.count())
                .select_from(HouseholdMember)
                .where(HouseholdMember.household_id == member.household_id)
            )
            or 0
        )
        if count > 1:
            _error(409, "TRANSFER_REQUIRED", "请先转让负责人或移除其他成员")
        dissolve_family(db, user_id)
        return
    _revoke_member_shares(db, member)
    db.delete(member)
    db.flush()


def _revoke_member_shares(db: Session, member: HouseholdMember) -> None:
    for transaction in db.scalars(
        select(Transaction).where(
            Transaction.owner_id == member.user_id,
            Transaction.shared_household_id == member.household_id,
        )
    ):
        transaction.family_shared = False
        transaction.family_internal = False
        transaction.shared_household_id = None
    for snapshot in db.scalars(
        select(AssetSnapshot).where(
            AssetSnapshot.owner_id == member.user_id,
            AssetSnapshot.family_household_id == member.household_id,
        )
    ):
        snapshot.include_in_family = False
        snapshot.family_household_id = None
        snapshot.shared_account_key = None
    flag = db.get(Setting, (member.user_id, "family_asset_coverage_confirmed"))
    if flag is not None:
        flag.value = "false"


def remove_member(db: Session, leader_id: int, member_user_id: int) -> None:
    leader = require_leader(db, leader_id)
    target = db.get(HouseholdMember, member_user_id)
    if target is None or target.household_id != leader.household_id or target.role == "leader":
        _error(404, "MEMBER_NOT_FOUND", "成员不存在")
    _revoke_member_shares(db, target)
    db.delete(target)
    db.flush()


def transfer_leader(db: Session, leader_id: int, target_id: int) -> None:
    leader = require_leader(db, leader_id)
    target = db.get(HouseholdMember, target_id)
    if target is None or target.household_id != leader.household_id or target_id == leader_id:
        _error(404, "MEMBER_NOT_FOUND", "请选择其他家庭成员")
    target.role = "leader"
    leader.role = "member"
    db.flush()


def dissolve_family(db: Session, leader_id: int) -> None:
    leader = require_leader(db, leader_id)
    household_id = leader.household_id
    for member in db.scalars(
        select(HouseholdMember).where(HouseholdMember.household_id == household_id)
    ):
        _revoke_member_shares(db, member)
    proposal_ids = list(
        db.scalars(
            select(HouseholdProposal.id).where(HouseholdProposal.household_id == household_id)
        )
    )
    for comment in db.scalars(
        select(ProposalComment).where(ProposalComment.proposal_id.in_(proposal_ids))
    ):
        db.delete(comment)
    for table in (
        HouseholdProposal,
        HouseholdGoal,
        HouseholdInvitation,
        HouseholdBudget,
        HouseholdMember,
    ):
        for entity in db.scalars(select(table).where(table.household_id == household_id)):
            db.delete(entity)
    db.flush()
    db.delete(db.get(Household, household_id))


def visible_transactions(
    db: Session, member: HouseholdMember, as_of: date | None = None, common_only: bool = False
) -> list[Transaction]:
    if member.role == "leader":
        stmt = (
            select(Transaction)
            .join(HouseholdMember, HouseholdMember.user_id == Transaction.owner_id)
            .where(
                HouseholdMember.household_id == member.household_id,
                HouseholdMember.share_transactions.is_(True),
                Transaction.tx_date >= HouseholdMember.share_from,
            )
        )
    else:
        # A member's own ledger remains visible even after they revoke leader access.
        stmt = select(Transaction).where(Transaction.owner_id == member.user_id)
    if as_of:
        stmt = stmt.where(Transaction.tx_date <= as_of)
    if common_only:
        stmt = stmt.where(
            Transaction.family_shared.is_(True),
            Transaction.shared_household_id == member.household_id,
        )
    return list(db.scalars(stmt.order_by(Transaction.tx_date.desc(), Transaction.id.desc())))


def family_transactions(
    db: Session,
    user_id: int,
    owner_id: int | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    ids: list[int] | None = None,
    page: int = 1,
    page_size: int = 25,
    common_only: bool = False,
) -> dict:
    member = require_member(db, user_id)
    if owner_id and member.role != "leader" and owner_id != user_id:
        _error(403, "FORBIDDEN", "不能查看其他成员账单")
    rows = visible_transactions(db, member, common_only=common_only)
    if owner_id:
        rows = [r for r in rows if r.owner_id == owner_id]
    if category:
        rows = [r for r in rows if r.category == category]
    if date_from:
        rows = [r for r in rows if r.tx_date >= date_from]
    if date_to:
        rows = [r for r in rows if r.tx_date <= date_to]
    if ids is not None:
        rows = [r for r in rows if r.id in ids]
    total = len(rows)
    return {
        "items": rows[(page - 1) * page_size : page * page_size],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def set_transaction_shared(db: Session, user_id: int, transaction_id: int, shared: bool) -> dict:
    member = require_member(db, user_id)
    row = db.get(Transaction, transaction_id)
    if row is None or row.owner_id != user_id:
        _error(404, "NOT_FOUND", "账单不存在")
    if shared and row.tx_type not in {"expense", "refund"}:
        _error(422, "INVALID_SHARED_TRANSACTION", "仅支出或退款可标记为家庭共担")
    row.family_shared = shared
    if shared:
        row.family_internal = False
    row.shared_household_id = member.household_id if shared or row.family_internal else None
    db.flush()
    return {
        "id": row.id,
        "family_shared": row.family_shared,
        "family_internal": row.family_internal,
    }


def set_transaction_internal(
    db: Session, user_id: int, transaction_id: int, internal: bool
) -> dict:
    member = require_member(db, user_id)
    row = db.get(Transaction, transaction_id)
    if row is None or row.owner_id != user_id:
        _error(404, "NOT_FOUND", "账单不存在")
    row.family_internal = internal
    if internal:
        row.family_shared = False
    row.shared_household_id = member.household_id if internal or row.family_shared else None
    db.flush()
    return {
        "id": row.id,
        "family_shared": row.family_shared,
        "family_internal": row.family_internal,
    }


def _common_spend(rows: list[Transaction], as_of: date) -> tuple[int, dict[str, int]]:
    month_start = as_of.replace(day=1)
    by_category: dict[str, int] = defaultdict(int)
    for row in rows:
        if month_start <= row.tx_date <= as_of:
            if row.tx_type == "expense":
                by_category[row.category] += row.amount_cents
            elif row.tx_type == "refund":
                by_category[row.category] -= row.amount_cents
    return sum(by_category.values()), dict(by_category)


def family_budget(db: Session, user_id: int, as_of: date) -> dict:
    member = require_member(db, user_id)
    budget = db.get(HouseholdBudget, member.household_id)
    if budget is None:
        budget = HouseholdBudget(
            household_id=member.household_id, monthly_budget_cents=0, category_budgets=[]
        )
        db.add(budget)
        db.flush()
    rows = [
        row
        for row in visible_transactions(db, member, as_of, common_only=True)
        if not row.family_internal
    ]
    if member.role != "leader":
        rows = [row for row in rows if row.owner_id == user_id]
    spent, categories = _common_spend(rows, as_of)
    alerts = []
    if (
        member.role == "leader"
        and budget.monthly_budget_cents
        and spent > budget.monthly_budget_cents
    ):
        alerts.append(
            {
                "scope": "total",
                "category": None,
                "limit_cents": budget.monthly_budget_cents,
                "spent_cents": spent,
                "over_cents": spent - budget.monthly_budget_cents,
            }
        )
    for item in budget.category_budgets if member.role == "leader" else []:
        category_spent = max(0, categories.get(item["category"], 0))
        if category_spent > item["limit_cents"]:
            alerts.append(
                {
                    "scope": "category",
                    "category": item["category"],
                    "limit_cents": item["limit_cents"],
                    "spent_cents": category_spent,
                    "over_cents": category_spent - item["limit_cents"],
                }
            )
    return {
        "monthly_budget_cents": budget.monthly_budget_cents,
        "category_budgets": budget.category_budgets,
        "spent_cents": spent,
        "alerts": alerts,
        "scope": "household" if member.role == "leader" else "self",
    }


def save_family_budget(db: Session, user_id: int, data: dict, as_of: date) -> dict:
    member = require_leader(db, user_id)
    row = db.get(HouseholdBudget, member.household_id)
    if row is None:
        row = HouseholdBudget(household_id=member.household_id)
        db.add(row)
    row.monthly_budget_cents = data["monthly_budget_cents"]
    row.category_budgets = data["category_budgets"]
    db.flush()
    return family_budget(db, user_id, as_of)


def asset_coverage_policy(db: Session, user_id: int) -> dict:
    setting = db.get(Setting, (user_id, "family_asset_valid_days"))
    try:
        days = int(setting.value) if setting is not None else 30
    except ValueError:
        days = 30
    return {"valid_days": days if 1 <= days <= 365 else 30}


def save_asset_coverage_policy(db: Session, user_id: int, valid_days: int) -> dict:
    if not 1 <= valid_days <= 365:
        _error(422, "INVALID_VALID_DAYS", "估值有效天数需在 1 到 365 天之间")
    previous = asset_coverage_policy(db, user_id)["valid_days"]
    setting = db.get(Setting, (user_id, "family_asset_valid_days"))
    if setting is None:
        setting = Setting(owner_id=user_id, key="family_asset_valid_days", value=str(valid_days))
        db.add(setting)
    else:
        setting.value = str(valid_days)
    if previous != valid_days:
        confirmed = db.get(Setting, (user_id, "family_asset_coverage_confirmed"))
        if confirmed is not None:
            confirmed.value = "false"
    db.flush()
    return {"valid_days": valid_days}


def _coverage(
    db: Session, member: HouseholdMember, as_of: date
) -> tuple[int | None, int | None, list[dict]]:
    """Count declared joint accounts once and withhold totals on incomplete coverage."""
    if member.role != "leader":
        return None, None, []
    active = list(
        db.scalars(
            select(HouseholdMember).where(HouseholdMember.household_id == member.household_id)
        )
    )
    details: list[dict] = []
    selected: list[AssetSnapshot] = []
    reasons: dict[int, list[str]] = defaultdict(list)
    for person in active:
        person_user = db.get(User, person.user_id)
        flag = db.get(Setting, (person.user_id, "family_asset_coverage_confirmed"))
        valid_days = asset_coverage_policy(db, person.user_id)["valid_days"]
        snapshots = list(
            db.scalars(
                select(AssetSnapshot)
                .where(
                    AssetSnapshot.owner_id == person.user_id,
                    AssetSnapshot.as_of <= as_of,
                )
                .order_by(AssetSnapshot.as_of.desc(), AssetSnapshot.id.desc())
            )
        )
        latest: dict[str, AssetSnapshot] = {}
        for snapshot in snapshots:
            latest.setdefault(snapshot.account_key, snapshot)
        included = [
            snapshot
            for snapshot in latest.values()
            if not snapshot.archived
            and snapshot.include_in_family
            and snapshot.family_household_id == member.household_id
        ]
        expired = [
            snapshot for snapshot in included if snapshot.as_of < as_of - timedelta(days=valid_days)
        ]
        missing_keys = [
            snapshot
            for snapshot in included
            if snapshot.ownership == "joint" and not snapshot.shared_account_key
        ]
        confirmed = flag is not None and flag.value == "true"
        if not confirmed:
            reasons[person.user_id].append("未确认资产覆盖")
        if not included:
            reasons[person.user_id].append("缺少纳入资产快照")
        if expired:
            reasons[person.user_id].append(f"{len(expired)} 项资产估值已超出 {valid_days} 天")
        if missing_keys:
            reasons[person.user_id].append(f"{len(missing_keys)} 项共有账户缺少共享标识")
        details.append(
            {
                "user_id": person.user_id,
                "display_name": person_user.display_name if person_user else "成员",
                "confirmed": confirmed,
                "included_count": len(included),
                "valid_days": valid_days,
                "latest_as_of": max((item.as_of for item in included), default=None),
            }
        )
        selected.extend(included)

    joint_by_key: dict[str, list[AssetSnapshot]] = defaultdict(list)
    for item in selected:
        if item.shared_account_key:
            joint_by_key[item.shared_account_key].append(item)
    conflicting_keys: set[str] = set()
    for key, group in joint_by_key.items():
        signatures = {
            (
                item.ownership,
                item.kind,
                item.balance_cents,
                item.as_of,
                item.is_cash_account,
                item.family_household_id,
            )
            for item in group
        }
        if (
            any(item.ownership != "joint" for item in group)
            or len({item.owner_id for item in group}) != len(group)
            or len(signatures) != 1
        ):
            conflicting_keys.add(key)
            for owner_id in {item.owner_id for item in group}:
                reasons[owner_id].append(f"共有账户代号「{key}」有 {len(group)} 条记录不一致")

    for detail in details:
        detail["reason"] = "；".join(reasons[detail["user_id"]]) or None
    if any(detail["reason"] for detail in details):
        return None, None, details

    unique: list[AssetSnapshot] = []
    counted_joint_keys: set[str] = set()
    for item in selected:
        if item.ownership == "joint":
            shared_key = item.shared_account_key
            if (
                shared_key is None
                or shared_key in conflicting_keys
                or shared_key in counted_joint_keys
            ):
                continue
            counted_joint_keys.add(shared_key)
        unique.append(item)
    net = sum(
        item.balance_cents if item.kind == "asset" else -item.balance_cents for item in unique
    )
    cash_accounts = [item for item in unique if item.is_cash_account and item.kind == "asset"]
    cash = sum(item.balance_cents for item in cash_accounts) if cash_accounts else None
    return cash, net, details


def _project(
    rows: list[Transaction],
    as_of: date,
    amount_cents: int = 0,
    planned_date: date | None = None,
    opening: int | None = None,
) -> dict:
    if not rows and amount_cents == 0:
        return {
            "timeline": [],
            "events": [],
            "minimum_before_cents": None,
            "minimum_after_cents": None,
            "opening_balance_cents": opening,
            "forecast_assumptions": ["未来收入未纳入预测"],
        }
    bills = recurring(rows, as_of, 30)
    base = baseline(rows, as_of, 30, {bill["merchant"].lower().strip() for bill in bills})
    before = opening or 0
    after = before
    days = []
    events = []
    for offset in range(30):
        day = as_of + timedelta(days=offset)
        due = [bill for bill in bills if bill["date"] == day.isoformat()]
        bill_sum = sum(item["amount_cents"] for item in due)
        before -= base["daily_cents"] + bill_sum
        after -= base["daily_cents"] + bill_sum + (amount_cents if day == planned_date else 0)
        days.append(
            {
                "date": day,
                "before_cents": before,
                "after_cents": after,
                "change_cents": -(base["daily_cents"] + bill_sum),
                "cumulative_change_cents": before - (opening or 0),
            }
        )
        for bill in due:
            events.append(
                {
                    "date": day,
                    "title": bill["merchant"],
                    "amount_cents": bill["amount_cents"],
                    "kind": "bill",
                    "source_ids": bill["source_ids"],
                }
            )
    return {
        "timeline": days,
        "events": events,
        "minimum_before_cents": min(day["before_cents"] for day in days),
        "minimum_after_cents": min(day["after_cents"] for day in days),
        "opening_balance_cents": opening,
        "forecast_assumptions": ["历史支出基线与已识别周期账单用于推演", "未来收入未纳入预测"],
    }


def dashboard(db: Session, user_id: int, as_of: date) -> dict:
    member = require_member(db, user_id)
    rows = [row for row in visible_transactions(db, member, as_of) if not row.family_internal]
    month_start = as_of.replace(day=1)
    month_rows = [row for row in rows if month_start <= row.tx_date <= as_of]
    income = sum(row.amount_cents for row in month_rows if row.tx_type == "income")
    expense = sum(row.amount_cents for row in month_rows if row.tx_type == "expense") - sum(
        row.amount_cents for row in month_rows if row.tx_type == "refund"
    )
    common_rows = [
        row
        for row in month_rows
        if row.family_shared and row.shared_household_id == member.household_id
    ]
    common_expense, _ = _common_spend(common_rows, as_of)
    categories: dict[str, int] = defaultdict(int)
    for row in common_rows:
        if row.tx_type == "expense":
            categories[row.category] += row.amount_cents
        elif row.tx_type == "refund":
            categories[row.category] -= row.amount_cents
    budget = db.get(HouseholdBudget, member.household_id)
    limits = (
        {item["category"]: item["limit_cents"] for item in budget.category_budgets}
        if budget and member.role == "leader"
        else {}
    )
    sources = []
    for person in members(db, user_id):
        if member.role != "leader" and person["user_id"] != user_id:
            continue
        person_rows = [row for row in month_rows if row.owner_id == person["user_id"]]
        sources.append(
            {
                "user_id": person["user_id"],
                "display_name": person["display_name"],
                "income_cents": sum(
                    row.amount_cents for row in person_rows if row.tx_type == "income"
                ),
                "expense_cents": sum(
                    row.amount_cents for row in person_rows if row.tx_type == "expense"
                )
                - sum(row.amount_cents for row in person_rows if row.tx_type == "refund"),
            }
        )
    cash, net, coverage_details = _coverage(db, member, as_of)
    projection = _project(rows, as_of, opening=cash)
    goals = list_goals(db, user_id)
    pending = [
        proposal for proposal in list_proposals(db, user_id) if proposal["status"] == "pending"
    ]
    active_count = (
        db.scalar(
            select(func.count())
            .select_from(HouseholdMember)
            .where(HouseholdMember.household_id == member.household_id)
        )
        or 0
    )
    shared_count = (
        db.scalar(
            select(func.count())
            .select_from(HouseholdMember)
            .where(
                HouseholdMember.household_id == member.household_id,
                HouseholdMember.share_transactions.is_(True),
            )
        )
        or 0
    )
    return {
        "role": member.role,
        "scope": "household" if member.role == "leader" else "self",
        "month": as_of.strftime("%Y-%m"),
        "coverage": {
            "shared_members": shared_count
            if member.role == "leader"
            else int(member.share_transactions),
            "total_members": active_count,
        },
        "coverage_details": coverage_details,
        "income_cents": income,
        "expense_cents": expense,
        "common_expense_cents": common_expense,
        "category_spend": [
            {"category": name, "amount_cents": amount, "limit_cents": limits.get(name)}
            for name, amount in sorted(categories.items(), key=lambda item: -item[1])
        ],
        "member_sources": sources,
        "timeline": [
            {
                "date": item["date"],
                "change_cents": item["change_cents"],
                "cumulative_change_cents": item["cumulative_change_cents"],
            }
            for item in projection["timeline"]
        ],
        "events": projection["events"],
        "goals": goals,
        "pending_proposals": pending,
        "forecast_assumptions": projection["forecast_assumptions"],
        "net_worth_cents": net,
        "net_worth_covered": net is not None,
    }


def _goal_completion(
    goal: HouseholdGoal, current_cents: int, as_of: date
) -> tuple[date | None, int | None]:
    gap = max(0, goal.target_cents - current_cents)
    if gap == 0:
        return as_of, 0
    if goal.monthly_contribution_cents <= 0:
        return None, None
    months = (gap + goal.monthly_contribution_cents - 1) // goal.monthly_contribution_cents
    month_index = as_of.year * 12 + as_of.month - 1 + months
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    return date(year, month, min(as_of.day, monthrange(year, month)[1])), months


def preview_proposal(
    db: Session,
    user_id: int,
    amount_cents: int,
    planned_date: date,
    as_of: date,
    funding_goal_id: int | None = None,
) -> dict:
    member = require_member(db, user_id)
    if planned_date < as_of or planned_date >= as_of + timedelta(days=30):
        _error(422, "INVALID_DATE", "计划日期需在未来 30 天内")
    rows = [row for row in visible_transactions(db, member, as_of) if not row.family_internal]
    cash, _, _ = _coverage(db, member, as_of)
    result = _project(rows, as_of, amount_cents, planned_date, cash)
    result["timeline"] = [
        {
            "date": row["date"],
            "before_cents": row["before_cents"],
            "after_cents": row["after_cents"],
        }
        for row in result["timeline"]
    ]
    result.pop("events")
    result["scope"] = "household" if member.role == "leader" else "self"
    result["goal_impact"] = None
    if funding_goal_id is not None:
        goal = db.get(HouseholdGoal, funding_goal_id)
        if goal is None or goal.household_id != member.household_id:
            _error(404, "GOAL_NOT_FOUND", "目标不存在")
        if amount_cents > goal.current_cents:
            _error(422, "INSUFFICIENT_GOAL_FUNDS", "目标已留存资金不足以承担这笔支出")
        before_date, before_months = _goal_completion(goal, goal.current_cents, as_of)
        after_date, after_months = _goal_completion(goal, goal.current_cents - amount_cents, as_of)
        result["goal_impact"] = {
            "goal_id": goal.id,
            "estimated_before_date": before_date,
            "estimated_after_date": after_date,
            "delay_months": after_months - before_months
            if before_months is not None and after_months is not None
            else None,
        }
    return result


def _proposal_out(db: Session, row: HouseholdProposal) -> dict:
    comments = list(
        db.scalars(
            select(ProposalComment)
            .where(ProposalComment.proposal_id == row.id)
            .order_by(ProposalComment.id)
        )
    )
    return {
        "id": row.id,
        "author_id": row.author_id,
        "title": row.title,
        "description": row.description,
        "amount_cents": row.amount_cents,
        "planned_date": row.planned_date,
        "category": row.category,
        "split_method": row.split_method,
        "split_note": row.split_note,
        "funding_goal_id": row.funding_goal_id,
        "status": row.status,
        "linked_transaction_id": row.linked_transaction_id,
        "created_at": row.created_at,
        "comments": [
            {
                "id": item.id,
                "author_id": item.author_id,
                "content": item.content,
                "created_at": item.created_at,
            }
            for item in comments
        ],
    }


def list_proposals(db: Session, user_id: int) -> list[dict]:
    member = require_member(db, user_id)
    rows = db.scalars(
        select(HouseholdProposal)
        .where(HouseholdProposal.household_id == member.household_id)
        .order_by(HouseholdProposal.created_at.desc(), HouseholdProposal.id.desc())
    ).all()
    return [_proposal_out(db, row) for row in rows]


def proposal(db: Session, user_id: int, proposal_id: int) -> HouseholdProposal:
    member = require_member(db, user_id)
    row = db.get(HouseholdProposal, proposal_id)
    if row is None or row.household_id != member.household_id:
        _error(404, "PROPOSAL_NOT_FOUND", "议事提案不存在")
    return row


def create_proposal(db: Session, user_id: int, data: dict) -> dict:
    member = require_member(db, user_id)
    if data.get("funding_goal_id") is not None:
        goal = db.get(HouseholdGoal, data["funding_goal_id"])
        if goal is None or goal.household_id != member.household_id:
            _error(404, "GOAL_NOT_FOUND", "目标不存在")
    row = HouseholdProposal(household_id=member.household_id, author_id=user_id, **data)
    db.add(row)
    db.flush()
    return _proposal_out(db, row)


def comment_proposal(db: Session, user_id: int, proposal_id: int, content: str) -> dict:
    row = proposal(db, user_id, proposal_id)
    db.add(ProposalComment(proposal_id=row.id, author_id=user_id, content=content.strip()))
    db.flush()
    return _proposal_out(db, row)


def decide_proposal(db: Session, user_id: int, proposal_id: int, decision: str) -> dict:
    require_leader(db, user_id)
    row = proposal(db, user_id, proposal_id)
    if row.status != "pending":
        _error(409, "PROPOSAL_ALREADY_DECIDED", "提案已处理")
    row.status = decision
    db.flush()
    return _proposal_out(db, row)


def link_proposal(db: Session, user_id: int, proposal_id: int, transaction_id: int) -> dict:
    row = proposal(db, user_id, proposal_id)
    if row.status != "approved":
        _error(409, "APPROVAL_REQUIRED", "请先确认提案")
    transaction = db.get(Transaction, transaction_id)
    member = require_member(db, user_id)
    if transaction is None or transaction.tx_type != "expense":
        _error(404, "TRANSACTION_NOT_FOUND", "请选择家庭共担支出账单")
    if transaction.owner_id != user_id and member.role != "leader":
        _error(404, "TRANSACTION_NOT_FOUND", "账单不存在")
    owner_membership = db.get(HouseholdMember, transaction.owner_id)
    if owner_membership is None or owner_membership.household_id != member.household_id:
        _error(404, "TRANSACTION_NOT_FOUND", "账单不存在")
    if transaction.tx_date < owner_membership.share_from or not owner_membership.share_transactions:
        _error(404, "TRANSACTION_NOT_FOUND", "账单未获分享授权")
    if not transaction.family_shared or transaction.shared_household_id != row.household_id:
        _error(422, "SHARING_REQUIRED", "请先将账单标记为家庭共担")
    if row.linked_transaction_id is not None:
        _error(409, "ALREADY_LINKED", "提案已关联账单")
    existing = db.scalar(
        select(HouseholdProposal).where(HouseholdProposal.linked_transaction_id == transaction_id)
    )
    if existing:
        _error(409, "ALREADY_LINKED", "该账单已关联其他提案")
    row.linked_transaction_id = transaction_id
    db.flush()
    return _proposal_out(db, row)


def unlink_proposal(db: Session, user_id: int, proposal_id: int) -> dict:
    row = proposal(db, user_id, proposal_id)
    member = require_member(db, user_id)
    if member.role != "leader" and row.author_id != user_id:
        _error(403, "FORBIDDEN", "无权解除账单关联")
    row.linked_transaction_id = None
    db.flush()
    return _proposal_out(db, row)


def _goal_out(row: HouseholdGoal) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "target_cents": row.target_cents,
        "current_cents": row.current_cents,
        "target_date": row.target_date,
        "source_note": row.source_note,
        "monthly_contribution_cents": row.monthly_contribution_cents,
        "updated_at": row.updated_at,
    }


def list_goals(db: Session, user_id: int) -> list[dict]:
    member = require_member(db, user_id)
    rows = db.scalars(
        select(HouseholdGoal)
        .where(HouseholdGoal.household_id == member.household_id)
        .order_by(HouseholdGoal.id)
    ).all()
    return [_goal_out(row) for row in rows]


def save_goal(db: Session, user_id: int, data: dict, goal_id: int | None = None) -> dict:
    member = require_leader(db, user_id)
    if goal_id is None:
        row = HouseholdGoal(household_id=member.household_id, **data)
        db.add(row)
    else:
        existing = db.get(HouseholdGoal, goal_id)
        if existing is None or existing.household_id != member.household_id:
            _error(404, "GOAL_NOT_FOUND", "目标不存在")
        row = existing
        for key, value in data.items():
            setattr(row, key, value)
        row.updated_at = datetime.now(timezone.utc)
    db.flush()
    return _goal_out(row)


def asset_snapshots(db: Session, user_id: int) -> list[AssetSnapshot]:
    rows = db.scalars(
        select(AssetSnapshot)
        .where(AssetSnapshot.owner_id == user_id)
        .order_by(AssetSnapshot.as_of.desc(), AssetSnapshot.id.desc())
    )
    latest: dict[str, AssetSnapshot] = {}
    for row in rows:
        latest.setdefault(row.account_key, row)
    return list(latest.values())


def save_asset_snapshot(db: Session, user_id: int, data: dict, today: date) -> AssetSnapshot:
    member = membership(db, user_id)
    if data["as_of"] > today:
        _error(422, "INVALID_ASSET_DATE", "估值日期不能晚于今天")
    account_key = data.pop("account_key") or str(uuid.uuid4())
    existing = db.scalar(
        select(AssetSnapshot).where(AssetSnapshot.account_key == account_key).limit(1)
    )
    if existing is not None and existing.owner_id != user_id:
        _error(403, "ACCOUNT_FORBIDDEN", "资产账户归属不符")
    if data["include_in_family"] and member is None:
        _error(409, "NO_FAMILY", "请先加入家庭")
    if data["ownership"] == "joint" and data["include_in_family"]:
        if not data.get("shared_account_key"):
            _error(422, "SHARED_KEY_REQUIRED", "纳入家庭的共有账户需要共享标识")
    if data["ownership"] == "individual" and data.get("shared_account_key"):
        _error(422, "INVALID_SHARED_KEY", "个人账户不能设置共有账户标识")
    if data["kind"] != "asset" and data["is_cash_account"]:
        _error(422, "INVALID_ASSET", "负债不能标记为现金账户")
    row = AssetSnapshot(
        owner_id=user_id,
        account_key=account_key,
        family_household_id=member.household_id if data["include_in_family"] and member else None,
        **data,
    )
    db.add(row)
    db.flush()
    flag = db.get(Setting, (user_id, "family_asset_coverage_confirmed"))
    if flag is not None:
        flag.value = "false"
    return row


def archive_asset(db: Session, user_id: int, account_key: str, today: date) -> AssetSnapshot:
    latest = db.scalar(
        select(AssetSnapshot)
        .where(AssetSnapshot.owner_id == user_id, AssetSnapshot.account_key == account_key)
        .order_by(AssetSnapshot.as_of.desc(), AssetSnapshot.id.desc())
        .limit(1)
    )
    if latest is None:
        _error(404, "ASSET_NOT_FOUND", "资产账户不存在")
    row = AssetSnapshot(
        owner_id=user_id,
        account_key=account_key,
        name=latest.name,
        kind=latest.kind,
        ownership=latest.ownership,
        shared_account_key=latest.shared_account_key,
        balance_cents=latest.balance_cents,
        as_of=today,
        include_in_family=False,
        family_household_id=None,
        is_cash_account=latest.is_cash_account,
        archived=True,
    )
    db.add(row)
    db.flush()
    flag = db.get(Setting, (user_id, "family_asset_coverage_confirmed"))
    if flag is not None:
        flag.value = "false"
    return row

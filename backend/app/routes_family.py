"""Thin HTTP adapter for household services."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .auth import current_user
from .db import get_db
from .models import Setting, User
from .schemas import (
    AssetCoverageIn,
    AssetCoverageOut,
    AssetCoveragePolicyIn,
    AssetCoveragePolicyOut,
    AssetSnapshotIn,
    AssetSnapshotOut,
    FamilyBudgetIn,
    FamilyBudgetOut,
    FamilyCreate,
    FamilyDashboardOut,
    FamilyFlagsOut,
    FamilyGoalIn,
    FamilyGoalOut,
    FamilyInternalIn,
    FamilyProposalIn,
    FamilyProposalOut,
    FamilyShareIn,
    FamilySummary,
    InvitationAccept,
    InvitationCreate,
    InvitationOut,
    InvitationPreviewOut,
    MembersOut,
    Page,
    ProposalCommentIn,
    ProposalDecision,
    ProposalLink,
    ProposalPreviewIn,
    ProposalPreviewOut,
    SharingIn,
    TransactionOut,
    TransferIn,
)
from .services import households

router = APIRouter(prefix="/api")


def local_today() -> date:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo("Asia/Shanghai")).date()


@router.get("/families", response_model=FamilySummary | None)
def get_family(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict | None:
    return households.family_summary(db, user.id)


@router.post("/families", response_model=FamilySummary)
def create_family(
    value: FamilyCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = households.create_family(db, user.id, value.name, local_today())
    db.commit()
    return result


@router.get("/families/members", response_model=MembersOut)
def get_members(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return {"members": households.members(db, user.id)}


@router.post("/families/invitations", response_model=InvitationOut)
def create_invitation(
    value: InvitationCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = households.invite(db, user.id, value.email)
    db.commit()
    return result


@router.get("/families/invitations/preview", response_model=InvitationPreviewOut)
def preview_invitation(
    code: str = Query(min_length=16, max_length=256),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    return households.preview_invite(db, user, code)


@router.post("/families/invitations/accept", response_model=FamilySummary)
def accept_invitation(
    value: InvitationAccept, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = households.accept_invite(
        db, user, value.code, value.share_from, value.share_transactions, local_today()
    )
    db.commit()
    return result


@router.get("/families/sharing", response_model=SharingIn)
def get_sharing(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return households.sharing(db, user.id)


@router.put("/families/sharing", response_model=SharingIn)
def put_sharing(
    value: SharingIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = households.set_sharing(
        db, user.id, value.share_from, value.share_transactions, local_today()
    )
    db.commit()
    return result


@router.post("/families/leave")
def leave(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    households.leave_family(db, user.id)
    db.commit()
    return {"left": True}


@router.delete("/families/members/{user_id}")
def remove_member(
    user_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    households.remove_member(db, user.id, user_id)
    db.commit()
    return {"removed": user_id}


@router.post("/families/transfer", response_model=FamilySummary)
def transfer(
    value: TransferIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    households.transfer_leader(db, user.id, value.user_id)
    db.commit()
    summary = households.family_summary(db, user.id)
    if summary is None:
        raise HTTPException(500, detail={"code": "FAMILY_NOT_FOUND", "message": "家庭不存在"})
    return summary


@router.delete("/families")
def dissolve(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    households.dissolve_family(db, user.id)
    db.commit()
    return {"dissolved": True}


@router.get("/families/transactions", response_model=Page)
def transactions(
    user_id: int | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    ids: str | None = None,
    common_only: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    parsed_ids = None
    if ids is not None:
        try:
            parsed_ids = [int(item) for item in ids.split(",")]
        except ValueError as exc:
            raise HTTPException(
                422, detail={"code": "INVALID_IDS", "message": "账单编号无效"}
            ) from exc
        if len(parsed_ids) > 200:
            raise HTTPException(422, detail={"code": "TOO_MANY_IDS", "message": "最多筛选 200 笔"})
    result = households.family_transactions(
        db, user.id, user_id, category, date_from, date_to, parsed_ids, page, page_size, common_only
    )
    result["items"] = [TransactionOut.model_validate(row) for row in result["items"]]
    return result


@router.patch("/transactions/{transaction_id}/family-sharing", response_model=FamilyFlagsOut)
def set_shared(
    transaction_id: int,
    value: FamilyShareIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    result = households.set_transaction_shared(db, user.id, transaction_id, value.shared)
    db.commit()
    return result


@router.patch("/transactions/{transaction_id}/family-internal", response_model=FamilyFlagsOut)
def set_internal(
    transaction_id: int,
    value: FamilyInternalIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    result = households.set_transaction_internal(db, user.id, transaction_id, value.internal)
    db.commit()
    return result


@router.get("/families/budget", response_model=FamilyBudgetOut)
def get_budget(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return households.family_budget(db, user.id, local_today())


@router.put("/families/budget", response_model=FamilyBudgetOut)
def put_budget(
    value: FamilyBudgetIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = households.save_family_budget(db, user.id, value.model_dump(), local_today())
    db.commit()
    return result


@router.get("/families/dashboard", response_model=FamilyDashboardOut)
def dashboard(
    as_of: date | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    return households.dashboard(db, user.id, as_of or local_today())


@router.get("/families/proposals", response_model=list[FamilyProposalOut])
def proposals(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    return households.list_proposals(db, user.id)


@router.post("/families/proposals", response_model=FamilyProposalOut)
def create_proposal(
    value: FamilyProposalIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = households.create_proposal(db, user.id, value.model_dump())
    db.commit()
    return result


@router.post("/families/proposals/preview", response_model=ProposalPreviewOut)
def preview_proposal(
    value: ProposalPreviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    return households.preview_proposal(
        db, user.id, value.amount_cents, value.planned_date, local_today(), value.funding_goal_id
    )


@router.post("/families/proposals/{proposal_id}/comments", response_model=FamilyProposalOut)
def comment_proposal(
    proposal_id: int,
    value: ProposalCommentIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    result = households.comment_proposal(db, user.id, proposal_id, value.content)
    db.commit()
    return result


@router.post("/families/proposals/{proposal_id}/confirm", response_model=FamilyProposalOut)
def decide_proposal(
    proposal_id: int,
    value: ProposalDecision,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    result = households.decide_proposal(db, user.id, proposal_id, value.decision)
    db.commit()
    return result


@router.post("/families/proposals/{proposal_id}/link-transaction", response_model=FamilyProposalOut)
def link_transaction(
    proposal_id: int,
    value: ProposalLink,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    result = households.link_proposal(db, user.id, proposal_id, value.transaction_id)
    db.commit()
    return result


@router.delete(
    "/families/proposals/{proposal_id}/link-transaction", response_model=FamilyProposalOut
)
def unlink_transaction(
    proposal_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = households.unlink_proposal(db, user.id, proposal_id)
    db.commit()
    return result


@router.get("/families/goals", response_model=list[FamilyGoalOut])
def goals(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    return households.list_goals(db, user.id)


@router.post("/families/goals", response_model=FamilyGoalOut)
def create_goal(
    value: FamilyGoalIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = households.save_goal(db, user.id, value.model_dump())
    db.commit()
    return result


@router.put("/families/goals/{goal_id}", response_model=FamilyGoalOut)
def update_goal(
    goal_id: int,
    value: FamilyGoalIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    result = households.save_goal(db, user.id, value.model_dump(), goal_id)
    db.commit()
    return result


@router.get("/users/me/assets", response_model=list[AssetSnapshotOut])
def assets(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    return [
        {
            "id": row.id,
            "name": row.name,
            "kind": row.kind,
            "ownership": row.ownership,
            "shared_account_key": row.shared_account_key,
            "account_key": row.account_key,
            "balance_cents": row.balance_cents,
            "as_of": row.as_of,
            "include_in_family": row.include_in_family,
            "is_cash_account": row.is_cash_account,
            "archived": row.archived,
        }
        for row in households.asset_snapshots(db, user.id)
    ]


@router.post("/users/me/assets", response_model=AssetSnapshotOut)
def create_asset(
    value: AssetSnapshotIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    row = households.save_asset_snapshot(db, user.id, value.model_dump(), local_today())
    db.commit()
    return {
        "id": row.id,
        "account_key": row.account_key,
        "archived": False,
        **value.model_dump(exclude={"account_key"}),
    }


@router.post("/users/me/assets/{account_key}/archive", response_model=AssetSnapshotOut)
def archive_asset(
    account_key: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    row = households.archive_asset(db, user.id, account_key, local_today())
    db.commit()
    return {
        "id": row.id,
        "account_key": row.account_key,
        "name": row.name,
        "kind": row.kind,
        "ownership": row.ownership,
        "shared_account_key": row.shared_account_key,
        "balance_cents": row.balance_cents,
        "as_of": row.as_of,
        "include_in_family": False,
        "is_cash_account": row.is_cash_account,
        "archived": True,
    }


@router.get("/users/me/assets/coverage", response_model=AssetCoverageOut)
def asset_coverage(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    row = db.get(Setting, (user.id, "family_asset_coverage_confirmed"))
    return {"confirmed": row is not None and row.value == "true"}


@router.get("/users/me/assets/coverage-policy", response_model=AssetCoveragePolicyOut)
def get_asset_coverage_policy(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    return households.asset_coverage_policy(db, user.id)


@router.put("/users/me/assets/coverage-policy", response_model=AssetCoveragePolicyOut)
def put_asset_coverage_policy(
    value: AssetCoveragePolicyIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    result = households.save_asset_coverage_policy(db, user.id, value.valid_days)
    db.commit()
    return result


@router.put("/users/me/assets/coverage", response_model=AssetCoverageOut)
def set_asset_coverage(
    value: AssetCoverageIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    row = db.get(Setting, (user.id, "family_asset_coverage_confirmed"))
    if row is None:
        row = Setting(owner_id=user.id, key="family_asset_coverage_confirmed", value="false")
        db.add(row)
    row.value = "true" if value.confirmed else "false"
    db.commit()
    return {"confirmed": value.confirmed}

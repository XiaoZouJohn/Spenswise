"""Transactional deletion of a user's private data and authored family content."""

import logging
import uuid

from fastapi import HTTPException
from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.auth import verify_password
from app.models import (
    AiConnection,
    AssetSnapshot,
    BackgroundTask,
    CategoryBudget,
    ChatConversation,
    ChatMessage,
    HouseholdInvitation,
    HouseholdMember,
    HouseholdProposal,
    ImportJob,
    MerchantRule,
    ProposalComment,
    Scenario,
    Setting,
    Transaction,
    UploadToken,
    User,
    UserSession,
)

from .imports import UPLOAD_DIR

logger = logging.getLogger(__name__)


def delete_account(db: Session, user: User, password: str) -> list[str]:
    """Delete one account; caller must already be authenticated as ``user``.

    Family membership must be ended first, so a leader cannot silently remove a
    household. Queued imports are cancelled by removing their jobs; a running
    import must finish first because its worker may still write.
    The returned upload IDs are safe to remove from disk after the DB commits.
    """
    if not verify_password(password, user.password_hash):
        raise HTTPException(403, detail={"code": "INVALID_PASSWORD", "message": "密码错误"})
    if db.get(HouseholdMember, user.id) is not None:
        raise HTTPException(
            409,
            detail={"code": "LEAVE_FAMILY_FIRST", "message": "请先退出、转让或解散家庭"},
        )
    import_jobs = db.scalars(
        select(ImportJob).where(ImportJob.owner_id == user.id).with_for_update()
    ).all()
    if any(job.status not in ("pending", "completed", "failed") for job in import_jobs):
        raise HTTPException(
            409, detail={"code": "IMPORT_IN_PROGRESS", "message": "请等待导入结束后再注销"}
        )

    upload_ids = set(db.scalars(select(UploadToken.id).where(UploadToken.owner_id == user.id)))
    upload_ids.update(job.id for job in import_jobs)

    own_proposals = select(HouseholdProposal.id).where(HouseholdProposal.author_id == user.id)
    own_conversations = select(ChatConversation.id).where(ChatConversation.owner_id == user.id)
    own_transactions = select(Transaction.id).where(Transaction.owner_id == user.id)

    # Preserve other people's proposals but remove their link to a deleted bill.
    db.execute(
        update(HouseholdProposal)
        .where(HouseholdProposal.linked_transaction_id.in_(own_transactions))
        .values(linked_transaction_id=None)
    )
    db.execute(
        delete(ProposalComment).where(
            or_(
                ProposalComment.author_id == user.id,
                ProposalComment.proposal_id.in_(own_proposals),
            )
        )
    )
    db.execute(delete(HouseholdProposal).where(HouseholdProposal.author_id == user.id))
    db.execute(
        delete(HouseholdInvitation).where(
            or_(
                HouseholdInvitation.created_by == user.id,
                HouseholdInvitation.invited_email == user.email,
            )
        )
    )
    db.execute(delete(ChatMessage).where(ChatMessage.conversation_id.in_(own_conversations)))

    for table in (
        ChatConversation,
        AiConnection,
        AssetSnapshot,
        BackgroundTask,
        UploadToken,
        ImportJob,
        Scenario,
        MerchantRule,
        CategoryBudget,
        Setting,
        Transaction,
    ):
        db.execute(delete(table).where(table.owner_id == user.id))
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.delete(user)
    db.flush()
    return list(upload_ids)


def delete_upload_files(upload_ids: list[str]) -> None:
    """Remove private import files after successful account deletion."""
    for upload_id in upload_ids:
        try:
            uuid.UUID(upload_id)
        except ValueError:
            logger.warning("Skipped invalid upload ID while deleting account files")
            continue
        for filename in (upload_id, f"{upload_id}.name"):
            try:
                (UPLOAD_DIR / filename).unlink(missing_ok=True)
            except OSError:
                logger.exception("Could not remove an account upload file: %s", filename)

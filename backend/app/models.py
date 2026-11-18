from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    tx_date: Mapped[date] = mapped_column(Date, index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    tx_type: Mapped[str] = mapped_column(String(16), index=True)
    merchant: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(80), index=True, default="待确认")
    confidence: Mapped[int] = mapped_column(Integer, default=0)
    classification_reason: Mapped[str] = mapped_column(Text, default="")
    is_fixed: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(80), default="manual")
    fingerprint: Mapped[str] = mapped_column(String(64))
    account_key: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    family_shared: Mapped[bool] = mapped_column(Boolean, default=False)
    family_internal: Mapped[bool] = mapped_column(Boolean, default=False)
    shared_household_id: Mapped[int | None] = mapped_column(
        ForeignKey("households.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    __table_args__ = (
        UniqueConstraint("owner_id", "fingerprint", name="uq_transaction_owner_fingerprint"),
        CheckConstraint(
            "NOT (family_shared AND family_internal)", name="ck_transaction_family_flags_exclusive"
        ),
    )


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(Text)
    is_legacy_placeholder: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class UserSession(Base):
    __tablename__ = "user_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class LegacyClaim(Base):
    __tablename__ = "legacy_claims"
    id: Mapped[int] = mapped_column(primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Household(Base):
    __tablename__ = "households"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class HouseholdMember(Base):
    __tablename__ = "household_members"
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    share_transactions: Mapped[bool] = mapped_column(Boolean, default=False)
    share_from: Mapped[date] = mapped_column(Date)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class HouseholdInvitation(Base):
    __tablename__ = "household_invitations"
    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    invited_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))


class HouseholdBudget(Base):
    __tablename__ = "household_budgets"
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), primary_key=True
    )
    monthly_budget_cents: Mapped[int] = mapped_column(Integer, default=0)
    category_budgets: Mapped[list] = mapped_column(JSON, default=list)


class HouseholdProposal(Base):
    __tablename__ = "household_proposals"
    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    amount_cents: Mapped[int] = mapped_column(Integer)
    planned_date: Mapped[date] = mapped_column(Date)
    category: Mapped[str] = mapped_column(String(80), default="其他")
    split_method: Mapped[str] = mapped_column(String(16), default="equal")
    split_note: Mapped[str] = mapped_column(String(255), default="")
    funding_goal_id: Mapped[int | None] = mapped_column(
        ForeignKey("household_goals.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), default="pending")
    linked_transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ProposalComment(Base):
    __tablename__ = "proposal_comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    proposal_id: Mapped[int] = mapped_column(
        ForeignKey("household_proposals.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class HouseholdGoal(Base):
    __tablename__ = "household_goals"
    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    target_cents: Mapped[int] = mapped_column(Integer)
    current_cents: Mapped[int] = mapped_column(Integer, default=0)
    monthly_contribution_cents: Mapped[int] = mapped_column(Integer, default=0)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_note: Mapped[str] = mapped_column(String(255), default="手动记录")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AssetSnapshot(Base):
    __tablename__ = "asset_snapshots"
    __table_args__ = (
        Index("ix_asset_snapshots_shared_key", "family_household_id", "shared_account_key"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    account_key: Mapped[str] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16))
    ownership: Mapped[str] = mapped_column(String(16), default="individual")
    shared_account_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    balance_cents: Mapped[int] = mapped_column(Integer)
    as_of: Mapped[date] = mapped_column(Date)
    include_in_family: Mapped[bool] = mapped_column(Boolean, default=False)
    family_household_id: Mapped[int | None] = mapped_column(
        ForeignKey("households.id"), nullable=True
    )
    is_cash_account: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class Setting(Base):
    __tablename__ = "settings"
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class CategoryBudget(Base):
    __tablename__ = "category_budgets"
    __table_args__ = (CheckConstraint("limit_cents >= 0", name="ck_category_budget_nonnegative"),)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    category: Mapped[str] = mapped_column(String(80), primary_key=True)
    limit_cents: Mapped[int] = mapped_column(Integer)


class MerchantRule(Base):
    __tablename__ = "merchant_rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    merchant_pattern: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(80))
    __table_args__ = (
        UniqueConstraint("owner_id", "merchant_pattern", name="uq_merchant_owner_pattern"),
    )


class Scenario(Base):
    __tablename__ = "scenarios"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    input: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict] = mapped_column(JSON)
    data_version: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ImportJob(Base):
    __tablename__ = "import_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    filename: Mapped[str] = mapped_column(String(255))
    content_sha256: Mapped[str] = mapped_column(String(64))
    mapping_sha256: Mapped[str] = mapped_column(String(64))
    mapping: Mapped[dict] = mapped_column(JSON)
    inserted: Mapped[int] = mapped_column(Integer, default=0)
    duplicates: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[list] = mapped_column(JSON, default=list)
    error_message: Mapped[str] = mapped_column(Text, default="")
    __table_args__ = (
        UniqueConstraint(
            "owner_id", "content_sha256", "mapping_sha256", name="uq_import_owner_content_mapping"
        ),
    )


class BackgroundTask(Base):
    __tablename__ = "background_tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32))


class UploadToken(Base):
    __tablename__ = "upload_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AiConnection(Base):
    __tablename__ = "ai_connections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    encrypted_key: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(80), default="deepseek-flash")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ChatConversation(Base):
    __tablename__ = "chat_conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_ledger: Mapped[bool] = mapped_column(Boolean, default=False)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    reasoning: Mapped[str] = mapped_column(Text, default="")
    thinking: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LifeLog(Base):
    __tablename__ = "life_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    event_date: Mapped[date] = mapped_column(Date)
    title: Mapped[str] = mapped_column(String(100), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    visibility: Mapped[str] = mapped_column(String(16), default="private")
    ai_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LifeLogTransaction(Base):
    __tablename__ = "life_log_transactions"
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    log_id: Mapped[str] = mapped_column(
        ForeignKey("life_logs.id", ondelete="CASCADE"), primary_key=True
    )
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), primary_key=True
    )


class ConsumptionEvent(Base):
    __tablename__ = "consumption_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True
    )
    origin: Mapped[str] = mapped_column(String(16), default="user")
    reason: Mapped[str] = mapped_column(String(200), default="")
    purpose: Mapped[str] = mapped_column(String(200), default="")
    feeling: Mapped[str] = mapped_column(String(80), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    deferred: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("owner_id", "transaction_id", name="uq_event_owner_transaction"),
    )


class StoryEdition(Base):
    __tablename__ = "story_editions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    month: Mapped[str] = mapped_column(String(7))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    source_version: Mapped[str] = mapped_column(String(64))
    use_logs: Mapped[bool] = mapped_column(Boolean, default=False)
    error_message: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class StoryPart(Base):
    __tablename__ = "story_parts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    edition_id: Mapped[str] = mapped_column(
        ForeignKey("story_editions.id", ondelete="CASCADE"), index=True
    )
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    chapter: Mapped[str] = mapped_column(String(24))
    title: Mapped[str] = mapped_column(String(100))
    body: Mapped[str] = mapped_column(Text)
    facts: Mapped[list] = mapped_column(JSON, default=list)
    sources: Mapped[list] = mapped_column(JSON, default=list)


class WorkspaceDraft(Base):
    __tablename__ = "workspace_drafts"
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    resource_type: Mapped[str] = mapped_column(String(40), primary_key=True)
    resource_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

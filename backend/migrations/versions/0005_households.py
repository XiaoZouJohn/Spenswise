"""Add private users and households, assigning every existing row to an unclaimed legacy owner.

Revision ID: 0005
Revises: 0004
"""

from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def _copy_table(name: str, columns: list[sa.Column], copy_sql: str, constraints=()) -> None:
    replacement = f"{name}_family_v2"
    op.create_table(replacement, *columns, *constraints)
    op.execute(sa.text(f"INSERT INTO {replacement} {copy_sql}"))
    op.drop_table(name)
    op.rename_table(replacement, name)


def _sync_serial_sequence(table: str) -> None:
    """Explicit legacy IDs do not advance PostgreSQL SERIAL sequences."""
    if op.get_bind().dialect.name != "postgresql":
        return
    if table not in {"users", "transactions", "merchant_rules"}:
        raise ValueError("Unsupported sequence table")
    op.execute(
        sa.text(
            f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
            f"COALESCE((SELECT MAX(id) FROM {table}), 1), "
            f"EXISTS(SELECT 1 FROM {table}))"
        )
    )


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("is_legacy_placeholder", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_table(
        "households",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.execute(
        sa.text(
            "INSERT INTO users (id,email,display_name,password_hash,"
            "is_legacy_placeholder,created_at) "
            "VALUES (1,'legacy@spendwise.invalid','原有数据','!',true,:now)"
        ).bindparams(now=datetime.now(timezone.utc))
    )
    _sync_serial_sequence("users")
    op.create_table(
        "user_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.create_table(
        "legacy_claims",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("INSERT INTO legacy_claims (id,code_hash) VALUES (1,'')")

    _copy_table(
        "transactions",
        [
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
            sa.Column("tx_date", sa.Date, nullable=False),
            sa.Column("amount_cents", sa.Integer, nullable=False),
            sa.Column("tx_type", sa.String(16), nullable=False),
            sa.Column("merchant", sa.String(255), nullable=False),
            sa.Column("description", sa.Text, nullable=False),
            sa.Column("category", sa.String(80), nullable=False),
            sa.Column("confidence", sa.Integer, nullable=False),
            sa.Column("classification_reason", sa.Text, nullable=False),
            sa.Column("is_fixed", sa.Boolean, nullable=False),
            sa.Column("source", sa.String(80), nullable=False),
            sa.Column("fingerprint", sa.String(64), nullable=False),
            sa.Column("family_shared", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("family_internal", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column(
                "shared_household_id", sa.Integer, sa.ForeignKey("households.id"), nullable=True
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        ],
        "(id,owner_id,tx_date,amount_cents,tx_type,merchant,description,category,confidence,"
        "classification_reason,is_fixed,source,fingerprint,family_shared,family_internal,"
        "shared_household_id,created_at) "
        "SELECT id,1,tx_date,amount_cents,tx_type,merchant,description,category,confidence,"
        "classification_reason,is_fixed,source,fingerprint,false,false,NULL,"
        "created_at FROM transactions",
        [
            sa.UniqueConstraint("owner_id", "fingerprint", name="uq_transaction_owner_fingerprint"),
            sa.CheckConstraint(
                "NOT (family_shared AND family_internal)",
                name="ck_transaction_family_flags_exclusive",
            ),
        ],
    )
    _sync_serial_sequence("transactions")
    op.create_index("ix_transactions_owner_id", "transactions", ["owner_id"])
    op.create_index("ix_transactions_tx_date", "transactions", ["tx_date"])
    op.create_index("ix_transactions_tx_type", "transactions", ["tx_type"])
    op.create_index("ix_transactions_category", "transactions", ["category"])

    _copy_table(
        "settings",
        [
            sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
            sa.Column("key", sa.String(80), primary_key=True),
            sa.Column("value", sa.Text, nullable=False),
        ],
        "(owner_id,key,value) SELECT 1,key,value FROM settings",
    )
    _copy_table(
        "category_budgets",
        [
            sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
            sa.Column("category", sa.String(80), primary_key=True),
            sa.Column("limit_cents", sa.Integer, nullable=False),
        ],
        "(owner_id,category,limit_cents) SELECT 1,category,limit_cents FROM category_budgets",
        [sa.CheckConstraint("limit_cents >= 0", name="ck_category_budget_nonnegative")],
    )
    _copy_table(
        "merchant_rules",
        [
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
            sa.Column("merchant_pattern", sa.String(255), nullable=False),
            sa.Column("category", sa.String(80), nullable=False),
        ],
        "(id,owner_id,merchant_pattern,category) "
        "SELECT id,1,merchant_pattern,category FROM merchant_rules",
        [sa.UniqueConstraint("owner_id", "merchant_pattern", name="uq_merchant_owner_pattern")],
    )
    _sync_serial_sequence("merchant_rules")
    op.create_index("ix_merchant_rules_owner_id", "merchant_rules", ["owner_id"])

    with op.batch_alter_table("scenarios") as batch:
        batch.add_column(sa.Column("owner_id", sa.Integer, nullable=False, server_default="1"))
        batch.create_foreign_key("fk_scenarios_owner", "users", ["owner_id"], ["id"])
        batch.create_index("ix_scenarios_owner_id", ["owner_id"])
    _copy_table(
        "import_jobs",
        [
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("filename", sa.String(255), nullable=False),
            sa.Column("content_sha256", sa.String(64), nullable=False),
            sa.Column("mapping_sha256", sa.String(64), nullable=False),
            sa.Column("mapping", sa.JSON, nullable=False),
            sa.Column("inserted", sa.Integer, nullable=False),
            sa.Column("duplicates", sa.Integer, nullable=False),
            sa.Column("errors", sa.JSON, nullable=False),
            sa.Column("error_message", sa.Text, nullable=False),
        ],
        "(id,owner_id,status,filename,content_sha256,mapping_sha256,mapping,inserted,"
        "duplicates,errors,error_message) "
        "SELECT id,1,status,filename,content_sha256,mapping_sha256,mapping,inserted,"
        "duplicates,errors,error_message FROM import_jobs",
        [
            sa.UniqueConstraint(
                "owner_id",
                "content_sha256",
                "mapping_sha256",
                name="uq_import_owner_content_mapping",
            )
        ],
    )
    op.create_index("ix_import_jobs_owner_id", "import_jobs", ["owner_id"])
    op.create_table(
        "background_tasks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
    )
    op.create_index("ix_background_tasks_owner_id", "background_tasks", ["owner_id"])
    op.create_table(
        "upload_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_upload_tokens_owner_id", "upload_tokens", ["owner_id"])
    with op.batch_alter_table("ai_connections") as batch:
        batch.add_column(sa.Column("owner_id", sa.Integer, nullable=False, server_default="1"))
        batch.create_foreign_key("fk_ai_connections_owner", "users", ["owner_id"], ["id"])
        batch.create_unique_constraint("uq_ai_connections_owner", ["owner_id"])
    with op.batch_alter_table("chat_conversations") as batch:
        batch.add_column(sa.Column("owner_id", sa.Integer, nullable=False, server_default="1"))
        batch.create_foreign_key("fk_chat_conversations_owner", "users", ["owner_id"], ["id"])
        batch.create_index("ix_chat_conversations_owner_id", ["owner_id"])
    # The default is only for backfilling legacy rows; future inserts must name an owner.
    for table in ("scenarios", "ai_connections", "chat_conversations"):
        with op.batch_alter_table(table) as batch:
            batch.alter_column("owner_id", existing_type=sa.Integer(), server_default=None)

    op.create_table(
        "household_members",
        sa.Column(
            "user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "household_id",
            sa.Integer,
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("share_transactions", sa.Boolean, nullable=False),
        sa.Column("share_from", sa.Date, nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_household_members_household_id", "household_members", ["household_id"])
    op.create_table(
        "household_invitations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "household_id",
            sa.Integer,
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("invited_email", sa.String(255), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
    )
    op.create_index(
        "ix_household_invitations_household_id", "household_invitations", ["household_id"]
    )
    op.create_table(
        "household_budgets",
        sa.Column(
            "household_id",
            sa.Integer,
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("monthly_budget_cents", sa.Integer, nullable=False),
        sa.Column("category_budgets", sa.JSON, nullable=False),
    )
    op.create_table(
        "household_goals",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "household_id",
            sa.Integer,
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("target_cents", sa.Integer, nullable=False),
        sa.Column("current_cents", sa.Integer, nullable=False),
        sa.Column("monthly_contribution_cents", sa.Integer, nullable=False),
        sa.Column("target_date", sa.Date, nullable=True),
        sa.Column("source_note", sa.String(255), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_household_goals_household_id", "household_goals", ["household_id"])
    op.create_table(
        "household_proposals",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "household_id",
            sa.Integer,
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("amount_cents", sa.Integer, nullable=False),
        sa.Column("planned_date", sa.Date, nullable=False),
        sa.Column("category", sa.String(80), nullable=False),
        sa.Column("split_method", sa.String(16), nullable=False),
        sa.Column("split_note", sa.String(255), nullable=False),
        sa.Column(
            "funding_goal_id", sa.Integer, sa.ForeignKey("household_goals.id"), nullable=True
        ),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column(
            "linked_transaction_id", sa.Integer, sa.ForeignKey("transactions.id"), nullable=True
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_household_proposals_household_id", "household_proposals", ["household_id"])
    op.create_table(
        "proposal_comments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "proposal_id",
            sa.Integer,
            sa.ForeignKey("household_proposals.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_proposal_comments_proposal_id", "proposal_comments", ["proposal_id"])
    op.create_table(
        "asset_snapshots",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("account_key", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("balance_cents", sa.Integer, nullable=False),
        sa.Column("as_of", sa.Date, nullable=False),
        sa.Column("include_in_family", sa.Boolean, nullable=False),
        sa.Column("family_household_id", sa.Integer, sa.ForeignKey("households.id"), nullable=True),
        sa.Column("is_cash_account", sa.Boolean, nullable=False),
        sa.Column("archived", sa.Boolean, nullable=False),
    )
    op.create_index("ix_asset_snapshots_owner_id", "asset_snapshots", ["owner_id"])
    op.create_index("ix_asset_snapshots_account_key", "asset_snapshots", ["account_key"])


def downgrade() -> None:
    raise RuntimeError("家庭组迁移包含用户归属，不支持自动回滚；请从迁移前备份恢复。")

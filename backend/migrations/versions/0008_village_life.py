"""Village life records, event references, story versions and private drafts."""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("transactions", sa.Column("account_key", sa.String(36), nullable=True))
    op.add_column(
        "transactions",
        sa.Column("reviewed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "life_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("visibility", sa.String(16), nullable=False),
        sa.Column("ai_allowed", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_life_logs_owner_id", "life_logs", ["owner_id"])
    op.create_table(
        "life_log_transactions",
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column(
            "log_id",
            sa.String(36),
            sa.ForeignKey("life_logs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "transaction_id",
            sa.Integer(),
            sa.ForeignKey("transactions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_table(
        "consumption_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "transaction_id",
            sa.Integer(),
            sa.ForeignKey("transactions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(200), nullable=False),
        sa.Column("purpose", sa.String(200), nullable=False),
        sa.Column("feeling", sa.String(80), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("deferred", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "transaction_id", name="uq_event_owner_transaction"),
    )
    op.create_index("ix_consumption_events_owner_id", "consumption_events", ["owner_id"])
    op.create_table(
        "story_editions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("source_version", sa.String(64), nullable=False),
        sa.Column("use_logs", sa.Boolean(), nullable=False),
        sa.Column("error_message", sa.String(300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_story_editions_owner_id", "story_editions", ["owner_id"])
    op.create_table(
        "story_parts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "edition_id",
            sa.String(36),
            sa.ForeignKey("story_editions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("chapter", sa.String(24), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("facts", sa.JSON(), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False),
    )
    op.create_index("ix_story_parts_owner_id", "story_parts", ["owner_id"])
    op.create_index("ix_story_parts_edition_id", "story_parts", ["edition_id"])
    op.create_table(
        "workspace_drafts",
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("resource_type", sa.String(40), primary_key=True),
        sa.Column("resource_id", sa.String(100), primary_key=True),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    for table in (
        "workspace_drafts",
        "story_parts",
        "story_editions",
        "consumption_events",
        "life_log_transactions",
        "life_logs",
    ):
        op.drop_table(table)
    with op.batch_alter_table("transactions") as batch:
        batch.drop_column("reviewed")
        batch.drop_column("account_key")

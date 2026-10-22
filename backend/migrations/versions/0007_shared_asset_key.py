"""Add a household scoped declared identifier for jointly owned accounts.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "asset_snapshots",
        sa.Column("shared_account_key", sa.String(64), nullable=True),
    )
    op.create_index(
        "ix_asset_snapshots_shared_key",
        "asset_snapshots",
        ["family_household_id", "shared_account_key"],
    )


def downgrade() -> None:
    op.drop_index("ix_asset_snapshots_shared_key", table_name="asset_snapshots")
    with op.batch_alter_table("asset_snapshots") as batch:
        batch.drop_column("shared_account_key")

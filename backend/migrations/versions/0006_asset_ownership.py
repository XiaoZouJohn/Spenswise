"""Record whether an asset snapshot is personal or jointly owned.

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "asset_snapshots",
        sa.Column(
            "ownership",
            sa.String(16),
            nullable=False,
            server_default="individual",
        ),
    )


def downgrade() -> None:
    with op.batch_alter_table("asset_snapshots") as batch:
        batch.drop_column("ownership")

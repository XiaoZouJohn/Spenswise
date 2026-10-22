"""Add repeating monthly category budget limits.

Revision ID: 0002
Revises: 0001
"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "category_budgets",
        sa.Column("category", sa.String(80), primary_key=True),
        sa.Column("limit_cents", sa.Integer, nullable=False),
        sa.CheckConstraint("limit_cents >= 0", name="ck_category_budget_nonnegative"),
    )


def downgrade() -> None:
    op.drop_table("category_budgets")

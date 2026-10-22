"""Initial SpendWise schema.

Revision ID: 0001
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("transactions", sa.Column("id", sa.Integer, primary_key=True), sa.Column("tx_date", sa.Date, nullable=False), sa.Column("amount_cents", sa.Integer, nullable=False), sa.Column("tx_type", sa.String(16), nullable=False), sa.Column("merchant", sa.String(255), nullable=False), sa.Column("description", sa.Text, nullable=False), sa.Column("category", sa.String(80), nullable=False), sa.Column("confidence", sa.Integer, nullable=False), sa.Column("classification_reason", sa.Text, nullable=False), sa.Column("is_fixed", sa.Boolean, nullable=False), sa.Column("source", sa.String(80), nullable=False), sa.Column("fingerprint", sa.String(64), nullable=False, unique=True), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_transactions_tx_date", "transactions", ["tx_date"])
    op.create_index("ix_transactions_tx_type", "transactions", ["tx_type"])
    op.create_index("ix_transactions_category", "transactions", ["category"])
    op.create_table("settings", sa.Column("key", sa.String(80), primary_key=True), sa.Column("value", sa.Text, nullable=False))
    op.create_table("merchant_rules", sa.Column("id", sa.Integer, primary_key=True), sa.Column("merchant_pattern", sa.String(255), nullable=False, unique=True), sa.Column("category", sa.String(80), nullable=False))
    op.create_table("scenarios", sa.Column("id", sa.Integer, primary_key=True), sa.Column("name", sa.String(100), nullable=False), sa.Column("input", sa.JSON, nullable=False), sa.Column("result", sa.JSON, nullable=False), sa.Column("data_version", sa.String(80), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("import_jobs", sa.Column("id", sa.String(36), primary_key=True), sa.Column("status", sa.String(20), nullable=False), sa.Column("filename", sa.String(255), nullable=False), sa.Column("content_sha256", sa.String(64), nullable=False), sa.Column("mapping_sha256", sa.String(64), nullable=False), sa.Column("mapping", sa.JSON, nullable=False), sa.Column("inserted", sa.Integer, nullable=False), sa.Column("duplicates", sa.Integer, nullable=False), sa.Column("errors", sa.JSON, nullable=False), sa.Column("error_message", sa.Text, nullable=False), sa.UniqueConstraint("content_sha256", "mapping_sha256", name="uq_import_content_mapping"))


def downgrade() -> None:
    op.drop_table("import_jobs")
    op.drop_table("scenarios")
    op.drop_table("merchant_rules")
    op.drop_table("settings")
    op.drop_index("ix_transactions_category", table_name="transactions")
    op.drop_index("ix_transactions_tx_type", table_name="transactions")
    op.drop_index("ix_transactions_tx_date", table_name="transactions")
    op.drop_table("transactions")

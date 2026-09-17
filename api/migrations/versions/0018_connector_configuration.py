"""connector_configuration: one agency credential set per registered connector

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-28

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "connector_configuration",
        sa.Column("org_slug", sa.Text(), nullable=False),
        sa.Column("connector_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("credentials", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "credentials_verified_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_delivery_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_delivery_delivered", sa.Boolean(), nullable=True),
        sa.Column("last_delivery_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "(last_delivery_at IS NULL) = (last_delivery_delivered IS NULL)",
            name="ck_connector_configuration_delivery_pair",
        ),
        sa.PrimaryKeyConstraint("org_slug", "connector_id"),
    )


def downgrade() -> None:
    op.drop_table("connector_configuration")

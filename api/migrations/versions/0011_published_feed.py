"""published_feed table

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "published_feed",
        sa.Column("org_slug", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("query_id", sa.Integer(), nullable=False),
        sa.Column("standard", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("entity", sa.Text(), nullable=False),
        sa.Column("static_gtfs_ref", sa.Text(), nullable=False),
        sa.Column("source_column", sa.Text(), nullable=True),
        sa.Column("column_map", postgresql.JSONB(), nullable=False),
        sa.Column("on_error", sa.Text(), nullable=False, server_default="block"),
        sa.Column("last_good_max_age_seconds", sa.Integer(), nullable=True),
        sa.Column("visibility", sa.Text(), nullable=False, server_default="private"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("org_slug", "slug"),
        sa.CheckConstraint(
            "(on_error = 'last_good') = (last_good_max_age_seconds IS NOT NULL)",
            name="ck_published_feed_cap_matches_mode",
        ),
        sa.CheckConstraint("on_error IN ('block', 'last_good')", name="ck_published_feed_on_error"),
        sa.CheckConstraint("visibility IN ('private', 'public')", name="ck_published_feed_visibility"),
    )


def downgrade() -> None:
    op.drop_table("published_feed")

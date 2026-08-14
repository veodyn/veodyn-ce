"""publish_attempt table

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "publish_attempt",
        sa.Column("org_slug", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("attempt_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("binding_revision", sa.Integer(), nullable=False),
        sa.Column("query_result_id", sa.Integer(), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("feed_bytes", sa.LargeBinary(), nullable=True),
        sa.Column("feed_timestamp", sa.Integer(), nullable=True),
        sa.Column("findings", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("enabled_rules", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("org_slug", "slug", "attempt_id"),
        sa.CheckConstraint("decision IN ('published', 'blocked', 'failed')", name="ck_publish_attempt_decision"),
        # Bytes exist if and only if the attempt published. A blocked attempt
        # holding servable bytes is one mistake away from being served.
        sa.CheckConstraint(
            "(decision = 'published') = (feed_bytes IS NOT NULL)",
            name="ck_publish_attempt_bytes_match_decision",
        ),
    )
    # One current artifact per feed, enforced by the database rather than by
    # every writer remembering to clear the old one first. The predicate must
    # be a SQL expression: without it this is a plain unique index on
    # (org_slug, slug) and the second attempt for a feed, of any decision, is
    # refused. `models/publish_attempt.py` spells the same predicate with
    # `text("is_current")` and the two have to stay equal, because the tests
    # build their schema from the metadata and production gets it from here.
    op.create_index(
        "uq_publish_attempt_current",
        "publish_attempt",
        ["org_slug", "slug"],
        unique=True,
        postgresql_where=sa.text("is_current"),
    )


def downgrade() -> None:
    op.drop_index("uq_publish_attempt_current", table_name="publish_attempt")
    op.drop_table("publish_attempt")

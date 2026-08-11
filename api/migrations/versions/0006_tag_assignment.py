"""tag_assignment table

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-28

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tag_assignment",
        sa.Column("org_slug", sa.Text(), nullable=False),
        sa.Column("object_type", sa.Text(), nullable=False),
        sa.Column("object_id", sa.Text(), nullable=False),
        sa.Column("tag", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        # Every column but the timestamp: the row is the fact, so tagging twice
        # is the same state as tagging once. No user_id, because a tag is an
        # org-shared fact rather than a personal one.
        sa.PrimaryKeyConstraint("org_slug", "object_type", "object_id", "tag"),
    )
    # The key serves lookups by object. This serves the vocabulary count, which
    # groups by tag across every object kind and cannot use the key at all.
    op.create_index("ix_tag_assignment_org_tag", "tag_assignment", ["org_slug", "tag"])


def downgrade() -> None:
    op.drop_index("ix_tag_assignment_org_tag", table_name="tag_assignment")
    op.drop_table("tag_assignment")

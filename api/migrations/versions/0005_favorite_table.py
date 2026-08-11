"""favorite table

Revision ID: 0005
Revises: nothing. This is the root of the community chain.
Create Date: 2026-07-27

It revised 0004 while the two chains were one. 0004 creates `report`, which is
an enterprise table and now lives in the enterprise pack, and this revision
never needed anything from it. The id stays 0005 because every database the
service has ever migrated stamps these ids, so renumbering the root to 0001
would orphan the stamp rather than tidy the sequence.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "favorite",
        sa.Column("org_slug", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("object_type", sa.Text(), nullable=False),
        sa.Column("object_id", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        # Every column but the timestamp: the row is the fact, so starring twice
        # is the same state as starring once.
        sa.PrimaryKeyConstraint("org_slug", "user_id", "object_type", "object_id"),
    )
    # The list read is "this person's stars of this kind", which the primary key
    # already serves as a leading-column prefix. No second index.


def downgrade() -> None:
    op.drop_table("favorite")

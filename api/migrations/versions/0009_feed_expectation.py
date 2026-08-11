"""feed_expectation table

Revision ID: 0009
Revises: 0006
Create Date: 2026-08-02

It revised 0008 while the two chains were one. 0008 adds a column to `kpi` and
is now in the enterprise pack, so this closes the gap onto 0006, the community
revision before it. The gap in the numbering is the enterprise chain and is
supposed to be there.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feed_expectation",
        sa.Column("org_slug", sa.Text(), nullable=False),
        # The warehouse table name, which is also the dataset id. No foreign
        # key: the thing it points at lives in ClickHouse, not here.
        sa.Column("feed_id", sa.Text(), nullable=False),
        sa.Column("expected_interval_seconds", sa.Integer(), nullable=False),
        sa.Column("set_by_user_id", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("org_slug", "feed_id"),
        # Clearing an expectation deletes the row, so a stored value is always a
        # real interval and cadence_label can never be handed a nought.
        sa.CheckConstraint("expected_interval_seconds > 0", name="ck_feed_expectation_positive"),
    )
    # The read is "every expectation in this org", which the primary key already
    # serves as a leading-column prefix. No second index.


def downgrade() -> None:
    op.drop_table("feed_expectation")

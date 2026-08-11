"""feed_expectation.alert_id / alert_query_id

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-02

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable, and no foreign key: both point into Redash's database, not this
    # one. Null is the normal state, because an expectation is useful without an
    # alert; it is what lets the board judge the feed at all.
    op.add_column("feed_expectation", sa.Column("alert_id", sa.Integer(), nullable=True))
    op.add_column("feed_expectation", sa.Column("alert_query_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("feed_expectation", "alert_query_id")
    op.drop_column("feed_expectation", "alert_id")

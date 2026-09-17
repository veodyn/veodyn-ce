"""publish_attempt.source_version, an optional query behind a feed, retire-on-failure

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("publish_attempt", sa.Column("source_version", sa.Integer(), nullable=True))
    op.execute("UPDATE publish_attempt SET source_version = query_result_id")
    op.alter_column("publish_attempt", "source_version", nullable=False)
    op.alter_column("publish_attempt", "query_result_id", existing_type=sa.Integer(), nullable=True)

    op.alter_column("published_feed", "query_id", existing_type=sa.Integer(), nullable=True)
    op.add_column(
        "published_feed",
        sa.Column("retire_on_failure", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


class IrreversibleRows(RuntimeError):
    pass


def downgrade() -> None:
    bind = op.get_bind()
    queryless_feeds = bind.execute(sa.text("SELECT count(*) FROM published_feed WHERE query_id IS NULL")).scalar_one()
    queryless_attempts = bind.execute(
        sa.text("SELECT count(*) FROM publish_attempt WHERE query_result_id IS NULL")
    ).scalar_one()
    if queryless_feeds or queryless_attempts:
        raise IrreversibleRows(
            "0016 cannot be reversed while rows exist that 0015 has nowhere to put: "
            f"{queryless_feeds} published_feed row(s) carry a null query_id and "
            f"{queryless_attempts} publish_attempt row(s) carry a null query_result_id, "
            "and 0015 declares both columns NOT NULL. Bind those feeds to a query or delete "
            "them, delete the attempts they left behind, then run this downgrade again."
        )

    op.drop_column("published_feed", "retire_on_failure")
    op.alter_column("published_feed", "query_id", existing_type=sa.Integer(), nullable=False)
    op.alter_column("publish_attempt", "query_result_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("publish_attempt", "source_version")

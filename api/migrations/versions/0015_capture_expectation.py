"""rename feed_expectation to capture_expectation

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-19

A rename, not a recreate. The rows are operator-entered (a declared interval and
the alert link armed from it) and exist nowhere else, so recreating the table
would clear every expectation on the instance without raising anything.

The `feed_id` column keeps its name. Renaming a primary-key column is a separate
migration with its own risk, and nothing outside this service reads that name.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.rename_table("feed_expectation", "capture_expectation")
    # Postgres does not rename a table's constraints when the table itself is
    # renamed, so the primary key and check constraint would otherwise still
    # carry the old table's name.
    op.execute("ALTER TABLE capture_expectation RENAME CONSTRAINT feed_expectation_pkey TO capture_expectation_pkey")
    op.execute(
        "ALTER TABLE capture_expectation RENAME CONSTRAINT ck_feed_expectation_positive "
        "TO ck_capture_expectation_positive"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE capture_expectation RENAME CONSTRAINT capture_expectation_pkey TO feed_expectation_pkey")
    op.execute(
        "ALTER TABLE capture_expectation RENAME CONSTRAINT ck_capture_expectation_positive "
        "TO ck_feed_expectation_positive"
    )
    op.rename_table("capture_expectation", "feed_expectation")

"""rename the regional connector types off the customer prefix

Revision ID: 29f3e1144ec5
Revises: e369133dda9a
Create Date: 2026-08-05

GO511 and SoCalTransport are public regional feeds, not customer
infrastructure, so they joined the public connector set. A data source row
stores its runner's type() string, so the rows have to move with them.

The map is written out literally rather than imported from
redash.query_runner.legacy_types. A migration describes the schema at its own
point in history; importing a constant would make this file's behaviour change
whenever a later release edits that constant, including after the aliases are
deleted.
"""

from alembic import op
import sqlalchemy as sa

revision = "29f3e1144ec5"
down_revision = "e369133dda9a"
branch_labels = None
depends_on = None

RENAMES = {
    "riits_go511": "go511",
    "riits_socaltransport": "socaltransport",
}


def upgrade():
    connection = op.get_bind()
    for old_type, new_type in RENAMES.items():
        connection.execute(
            sa.text("UPDATE data_sources SET type = :new WHERE type = :old"),
            {"new": new_type, "old": old_type},
        )


def downgrade():
    connection = op.get_bind()
    for old_type, new_type in RENAMES.items():
        connection.execute(
            sa.text("UPDATE data_sources SET type = :old WHERE type = :new"),
            {"old": old_type, "new": new_type},
        )

"""index public reads on events

Revision ID: a41d2c8f9b07
Revises: c3f81de5a4b2
Create Date: 2026-07-30 11:02:44.918204

The events table carries no index at all past its primary key, and nothing ever
deletes from it, so it is the largest table in most installs. The shared links
console reads it once per page load to answer "when was this link last used",
and without an index that read is a sequential scan over the entire history of
the instance.

Partial on the flag record_public_read writes, so the index covers anonymous
reads of share links and nothing else. Those are a vanishingly small share of
all events, which is what keeps this index small on a table that is not.

Built with CREATE INDEX CONCURRENTLY. A plain build takes a lock that holds up
every write to events, and every query execution writes one.

If the concurrent build fails
-----------------------------

CREATE INDEX CONCURRENTLY does not unwind cleanly: a failed build leaves the
index in the catalog marked INVALID, with the right name and no effect on any
plan. Re-running this migration drops whatever is under the name, concurrently,
and rebuilds. Nothing has to be cleaned up by hand.

The definition is compared and not just the name, for the reason revision
c3f81de5a4b2 sets out at length: a name can be occupied by a valid index over
the wrong columns or the wrong predicate, and checking indisvalid alone reports
that as done. This one is not a uniqueness constraint, so a mismatch costs a
slow page rather than a rule that stops being enforced, but it is the same check
and there is no reason to write a weaker one.
"""

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "a41d2c8f9b07"
down_revision = "c3f81de5a4b2"
branch_labels = None
depends_on = None

INDEX_NAME = "events_public_reads"
INDEX_TABLE = "events"
INDEX_COLUMNS = "object_type,object_id,created_at"

# Matched against the catalog after normalisation, because Postgres renders a
# predicate with its own spacing and explicit casts rather than as it was
# written. See normalize_predicate.
INDEX_PREDICATE = "(additional_properties->>'public')='true'"

CREATE_INDEX = """
    CREATE INDEX CONCURRENTLY {}
    ON events (object_type, object_id, created_at)
    WHERE (additional_properties ->> 'public') = 'true'
""".format(INDEX_NAME)

DROP_INDEX = "DROP INDEX CONCURRENTLY IF EXISTS {}".format(INDEX_NAME)

READ_INDEX_DEFINITION = """
    SELECT indexed.relname AS table_name,
           pg_index.indisvalid AS is_valid,
           pg_index.indnatts AS column_count,
           pg_index.indnkeyatts AS key_column_count,
           coalesce(pg_get_expr(pg_index.indpred, pg_index.indrelid), '') AS predicate,
           array_to_string(array(
               SELECT pg_get_indexdef(pg_index.indexrelid, position, true)
               FROM generate_series(1, pg_index.indnatts) AS position
           ), ',') AS columns
    FROM pg_class
    JOIN pg_index ON pg_index.indexrelid = pg_class.oid
    JOIN pg_class AS indexed ON indexed.oid = pg_index.indrelid
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_class.relname = :name
      AND pg_namespace.nspname = current_schema()
"""


def normalize_predicate(predicate):
    """A catalog predicate reduced to something comparable to a literal.

    Postgres stores a parsed expression and renders it back with its own
    spacing, explicit ::text casts on every literal, and a wrapping pair of
    parentheses none of which were typed. Dropping all three leaves the part
    that carries the meaning, so an index built by an earlier version of this
    file still compares equal to one built by hand.
    """
    stripped = predicate.replace("::text", "").replace(" ", "")

    if stripped.startswith("(") and stripped.endswith(")"):
        stripped = stripped[1:-1]

    return stripped


def enforces_what_this_revision_defines(row):
    """Whether the catalog row is the index described in the docstring.

    An index over other columns, or over a wider predicate, is not this one: it
    would leave the console's read unindexed while looking present, which is the
    failure this comparison exists to catch. INCLUDE columns are checked too, so
    an index that covers the same keys with extra payload is rebuilt rather than
    left to drift from what this file says is there.
    """
    return (
        row.column_count == 3
        and row.key_column_count == 3
        and row.columns == INDEX_COLUMNS
        and normalize_predicate(row.predicate) == INDEX_PREDICATE
    )


def index_state(connection):
    """One of "absent", "foreign", "invalid", "mismatched" or "valid"."""
    row = connection.execute(text(READ_INDEX_DEFINITION), {"name": INDEX_NAME}).first()

    if row is None:
        return "absent"

    if row.table_name != INDEX_TABLE:
        return "foreign"

    if not row.is_valid:
        return "invalid"

    return "valid" if enforces_what_this_revision_defines(row) else "mismatched"


def build_index(connection):
    """Build the index on a connection in autocommit.

    Autocommit is required rather than preferred: CREATE INDEX CONCURRENTLY
    cannot run inside a transaction block.

    Split out of upgrade() so a test can drive it against a real database
    without standing up an Alembic environment.
    """
    state = index_state(connection)

    if state == "valid":
        return

    if state == "foreign":
        raise RuntimeError(
            "{} already exists on another table, so this revision cannot build its index and will "
            "not drop an object it does not own. Rename or remove that index, then re-run.".format(INDEX_NAME)
        )

    if state in ("invalid", "mismatched"):
        connection.execute(text(DROP_INDEX))

    connection.execute(text(CREATE_INDEX))

    state = index_state(connection)

    if state != "valid":
        raise RuntimeError(
            "{} was created but came out {}, so the shared links console is still reading events "
            "unindexed. Re-run this migration: it drops the index and rebuilds.".format(INDEX_NAME, state)
        )


def upgrade():
    with op.get_context().autocommit_block():
        build_index(op.get_bind())


def downgrade():
    with op.get_context().autocommit_block():
        op.get_bind().execute(text(DROP_INDEX))

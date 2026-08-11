"""one active api key per object

Revision ID: c3f81de5a4b2
Revises: b7f4a2c19e3d
Create Date: 2026-07-28 21:40:11.512338

Adds the partial unique index that makes one live share token per object a
database rule rather than a convention the application tries to keep. Written to
run against a database that is serving traffic.

Operational sequence
--------------------

1. Deploy the application code that ships with this migration first. It mints
   through ApiKey.get_or_create_for_object under a per object advisory lock and
   so does not produce duplicate active keys. Running the migration against
   older code means reconciling against a writer that is still making the thing
   being reconciled.
2. Run the migration. It reconciles the duplicates a live database can already
   hold, one committed pass at a time, builds the index with CREATE INDEX
   CONCURRENTLY, and then checks that the index came out valid and is the index
   this revision defines.

Nothing here takes a lock that stops api key writes. The reconcile is an UPDATE
that touches only duplicate rows and commits on its own, and CREATE INDEX
CONCURRENTLY takes ShareUpdateExclusive, which lets INSERT and UPDATE through.

The first version of this migration did the opposite on both counts, and both
were outage shaped. It reconciled inside the migration's own long transaction,
so an insert committing after that statement's snapshot recreated a duplicate
that the build then choked on. It built the index without CONCURRENTLY, which
takes Share and blocks every api key write for the length of a full table scan.
The two together were also a deadlock: a writer holding RowExclusive waiting on
a row the reconcile had locked, while the build waited on that same writer.

If the concurrent build fails
-----------------------------

CREATE INDEX CONCURRENTLY does not unwind cleanly. A failed build leaves the
index in the catalog marked INVALID: right name, no enforcement. The usual cause
is a duplicate active key inserted between the last reconcile pass and the
build, which means code older than step 1 is still running somewhere.

The operator cleans up nothing by hand. Re-running this migration drops the
invalid index, concurrently and so still without blocking writes, reconciles
again, and rebuilds. Do step 1 first if it was skipped, or the same race is
still waiting. To read the state directly:

    SELECT indisvalid, indisunique, pg_get_indexdef(indexrelid)
    FROM pg_index
    WHERE indexrelid = 'api_keys_one_active_key_per_object'::regclass;

Why the name alone is not the check
-----------------------------------

Validity is not the only way an index under this name can be enforcing nothing.
A hand-built index from an operator working around an earlier failure, a
partially applied schema, or a restore from a database that had its own version
of this index can all leave the name occupied by something that is valid and
does not constrain what this revision says it constrains: not unique, or unique
over the wrong columns, or partial on a different predicate, or on another table
entirely. Checking indisvalid and stopping there classifies every one of those
as done, returns early, and lets Alembic stamp the revision while duplicate
active keys are still accepted. So the whole definition is read: owning table,
uniqueness, key columns in order, and predicate.

Anything under this name on api_keys that does not match is dropped and rebuilt.
The one case that stops the migration instead is the name belonging to an index
on some other table, because dropping that would be destroying an object this
revision has no claim on, and there is no way to build ours beside it.

The migration refuses to report success on an index that is not valid or is not
the definition below, so a run that finishes green means the constraint is being
enforced. No path here leaves an unenforced constraint behind and says nothing
about it.

"""
from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "c3f81de5a4b2"
down_revision = "b7f4a2c19e3d"
branch_labels = None
depends_on = None

INDEX_NAME = "api_keys_one_active_key_per_object"

# What the index has to be, not just what it has to be called. Compared against
# the catalog, so a name occupied by something weaker is treated as absent
# rather than as done.
INDEX_TABLE = "api_keys"
INDEX_COLUMNS = "object_type,object_id"
INDEX_PREDICATE = "active"

# Each reconcile pass commits on its own, so a pass only has to outrun the
# writers that arrived during the pass before it. A database still holding
# duplicates after this many is still minting them, which is step 1 of the
# sequence above not having happened, and is worth stopping for rather than
# looping on.
RECONCILE_PASSES = 5

# The lowest id is kept because that is the one get_by_object has been handing
# out, and therefore the one whose token people are holding. The rest are
# revoked rather than deleted, so the row stays available to whoever asks later
# what that token was.
DEACTIVATE_DUPLICATES = """
    UPDATE api_keys
    SET active = false
    WHERE active
      AND id NOT IN (
        SELECT min(id)
        FROM api_keys
        WHERE active
        GROUP BY object_type, object_id
      )
"""

COUNT_DUPLICATES = """
    SELECT coalesce(sum(active_keys - 1), 0)
    FROM (
        SELECT count(*) AS active_keys
        FROM api_keys
        WHERE active
        GROUP BY object_type, object_id
        HAVING count(*) > 1
    ) AS duplicated
"""

# indnatts alongside indnkeyatts so that INCLUDE columns cannot pass as key
# columns. pg_get_indexdef with pretty printing renders one column per call and
# leaves out the default operator class, which is what makes the column list
# comparable across server versions.
READ_INDEX_DEFINITION = """
    SELECT indexed.relname AS table_name,
           pg_index.indisvalid AS is_valid,
           pg_index.indisunique AS is_unique,
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

# Partial, so revoked keys accumulate freely and only the live credential is
# unique. This is what makes minting idempotent under concurrency rather than
# only in sequence: without it two share requests that both read nothing both
# insert, and revocation reaches only one of them.
CREATE_INDEX = """
    CREATE UNIQUE INDEX CONCURRENTLY {}
    ON api_keys (object_type, object_id)
    WHERE active
""".format(INDEX_NAME)

DROP_INDEX = "DROP INDEX CONCURRENTLY IF EXISTS {}".format(INDEX_NAME)


def enforces_what_this_revision_defines(row):
    """Whether the catalog row is the constraint described in the docstring.

    Every field is load bearing. Not unique and it rejects nothing. Wrong
    columns and it is unique over the wrong thing. Wrong predicate and it either
    covers rows it should not, which breaks revoked keys accumulating, or misses
    the ones it should cover, which is the duplicate this revision exists to
    stop. An extra INCLUDE column changes nothing about enforcement but does
    mean the index in the database is not the one the model declares, so it is
    rebuilt rather than left to drift.
    """
    return (
        bool(row.is_unique)
        and row.column_count == 2
        and row.key_column_count == 2
        and row.columns == INDEX_COLUMNS
        and row.predicate.strip() == INDEX_PREDICATE
    )


def index_state(connection):
    """One of "absent", "foreign", "invalid", "mismatched" or "valid".

    "invalid" is what a failed CREATE INDEX CONCURRENTLY leaves behind, and it
    is why nothing here uses CREATE INDEX ... IF NOT EXISTS: that would see the
    name, take a failed build for a finished one, and hand back a constraint
    enforcing nothing.

    "mismatched" is the same failure arriving by a different route, and reading
    indisvalid alone cannot tell the two apart from success. "foreign" is the
    name occupied by an index on another table, which is the one state this
    module will not repair on its own. See the module docstring.
    """
    row = connection.execute(text(READ_INDEX_DEFINITION), {"name": INDEX_NAME}).first()

    if row is None:
        return "absent"

    if row.table_name != INDEX_TABLE:
        return "foreign"

    if not row.is_valid:
        return "invalid"

    return "valid" if enforces_what_this_revision_defines(row) else "mismatched"


def build_unique_index(connection):
    """Reconcile duplicates then build the index, on a connection in autocommit.

    Autocommit is the point rather than a detail. CREATE INDEX CONCURRENTLY
    cannot run inside a transaction block at all, and each reconcile pass has to
    commit before the next one reads, or every pass sees the same snapshot and
    retrying means nothing.

    Split out of upgrade() so a test can drive it against a real database
    without standing up an Alembic environment.
    """
    state = index_state(connection)

    if state == "valid":
        # A re-run of a migration that already got this far. The index has been
        # rejecting duplicates since it was created, so there is nothing left to
        # reconcile either.
        return

    if state == "foreign":
        raise RuntimeError(
            "{} already exists on another table, so this revision cannot build its index and will "
            "not drop an object it does not own. Rename or remove that index, then re-run.".format(INDEX_NAME)
        )

    if state in ("invalid", "mismatched"):
        # Concurrently, so even the repair path never blocks api key writes.
        connection.execute(text(DROP_INDEX))

    for _ in range(RECONCILE_PASSES):
        if not connection.execute(text(COUNT_DUPLICATES)).scalar():
            break
        connection.execute(text(DEACTIVATE_DUPLICATES))
    else:
        raise RuntimeError(
            "api_keys still holds duplicate active keys after {} reconcile passes. "
            "Something is still minting them: deploy the application code that goes "
            "with this migration, then re-run it.".format(RECONCILE_PASSES)
        )

    connection.execute(text(CREATE_INDEX))

    state = index_state(connection)

    if state != "valid":
        raise RuntimeError(
            "{} was created but came out {}, so it is enforcing nothing. Re-run this "
            "migration: it drops the index and rebuilds. See the module "
            "docstring.".format(INDEX_NAME, state)
        )


def upgrade():
    # Ends the migration's own transaction for the duration and opens a fresh
    # one afterwards. That is what lets the statements below commit one at a
    # time, and what makes CONCURRENTLY legal here at all.
    with op.get_context().autocommit_block():
        build_unique_index(op.get_bind())


def downgrade():
    with op.get_context().autocommit_block():
        op.get_bind().execute(text(DROP_INDEX))

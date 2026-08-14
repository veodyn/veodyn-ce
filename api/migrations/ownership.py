"""Which tables the community chain is allowed to have an opinion about.

Autogenerate compares the target metadata against everything it reflects out of
the database. Once the enterprise chain exists, that reflection sees both
chains, so without a filter one chain proposes destroying the other's tables.
Nothing goes red: somebody runs `alembic revision --autogenerate`, reads a
plausible looking migration, and commits it.

**Two filters, and the two are not interchangeable.** All four combinations
were measured against a composed Postgres carrying both chains and both version
tables, with this chain's allowlist:

    no filter            drop_table alembic_version_ee
    include_name only    create_table kpi, kpi_history_point, report,
                         external_access, plus 4 create_index
    include_object only  nothing
    both                 nothing

`include_name` gates the names alembic reflects out of the database
(`alembic/autogenerate/compare/tables.py:57`). The metadata side is filtered by
`include_object` (same file, line 123). So `include_name` on its own does not
remove the other chain's tables from the comparison; it moves them from one
side of the difference to the other, and a proposed DROP becomes a proposed
CREATE. That is row 2, and it is why one filter can be worse than none: a
reviewer throws out a migration that drops four tables, and accepts one that
creates four tables that "must have been missed".

Row 3 is the correction to what this pack's first draft claimed.
`include_object` is consulted on the reflected side as well, which is what its
`reflected` argument is for: the removal branch at line 165 passes True. So
`include_object` alone already settles the operation list. `include_name` earns
its place one level earlier, at what gets read at all: without it the sweep
reflects all seven product tables plus `alembic_version_ee`, and the removal
branch does a full `reflect_table` on a table it is about to discard. A chain
that minds only its own tables should not be reading the other chain's.

Each filter has a test that actually goes red when it is deleted, and the two
tests are in different repositories, which is worth knowing before deleting one
and reading a green pipeline as permission. `include_name` is covered by
`tests/test_migration_ownership.py` here. `include_object` cannot be covered
here: with no pack installed this metadata holds only the three tables above,
so there is nothing for it to refuse and deleting it changes no result in this
suite. It is covered in the pack, by
`tests/test_migration_composed_ownership.py`, which is the only place the
enterprise models are attached to this same declarative base.

An ALLOWLIST rather than a denylist of the other chain's tables, for two
reasons. A denylist has to be updated whenever the other side adds a table, and
the failure when nobody remembers is a proposed DROP of that new table. And the
version tables are in no metadata at all: `alembic_version_ee` is exactly what
a filter written against product tables would sweep up, and an allowlist
excludes it without having to name it. Alembic already excludes a chain's own
version table from reflection, so each chain needs the filter for the other's.

Ownership is stated here as a literal set rather than read off
`Base.metadata`, because the enterprise models attach to the same declarative
base. Until they move out, this metadata holds all seven product tables, so
deriving the allowlist from it would filter nothing at all.
"""

from alembic.runtime.environment import NameFilterParentNames, NameFilterType
from sqlalchemy.sql.schema import SchemaItem

CE_TABLES = frozenset({"favorite", "tag_assignment", "feed_expectation", "published_feed", "publish_attempt"})
"""Every table the community chain creates.

Hand maintained, and `tests/test_migration_allowlists.py` holds the ratchet that
keeps it equal to the set of tables the revisions in `versions/` create. Add a
revision creating a table and forget this set, and the filter proposes dropping
your own new table.

The pack restates this set, twice, because it cannot import this tree. Those
copies are held to this one by the pack's `tests/test_allowlists_agree.py`,
which is the only place both trees exist at once.
"""


def include_name(name: str | None, type_: NameFilterType, parent_names: NameFilterParentNames) -> bool:
    """The reflection side: which names are read out of the database at all."""
    if type_ == "table":
        return name in CE_TABLES
    return True


def include_object(
    object_: SchemaItem,
    name: str | None,
    type_: NameFilterType,
    reflected: bool,
    compare_to: SchemaItem | None,
) -> bool:
    """The metadata side: which objects may produce an operation.

    Without this, an enterprise table present in the shared metadata but
    filtered out of the reflection reads as "in the model, missing from the
    database" and autogenerate proposes creating it.
    """
    if type_ == "table":
        return name in CE_TABLES
    return True

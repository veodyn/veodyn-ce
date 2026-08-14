"""The community chain minds only its own tables.

Once the enterprise half ships as its own package with its own revision chain,
both chains run against one database. Autogenerate compares a target metadata
against everything it reflects there, so an unfiltered chain proposes
destroying the other's tables, and nobody finds out from a red build: somebody
runs `alembic revision --autogenerate`, reads a migration that looks like
housekeeping, and commits it.

Everything here runs the community chain's **real** `env.py` through
`alembic check` against a real database, and asserts on the operation list it
comes back with. Asserting that `include_name("kpi", "table", {})` returns
False would be a tautology: it tests the function rather than the behaviour the
function exists to produce, and it stays green when the filter is wired into
neither `context.configure` call.

**Only the community half is here, and that is the whole point of this file's
shape.** This suite installs from `uv.lock`, which the enterprise pack is not
in and must never be in, so anything reaching for the enterprise chain either
fails or skips in the gate that matters, and a skipping test guards nothing.
The composed assertions (the enterprise chain proposing nothing, either chain
ignoring a change to the other's tables, the enterprise half of the version
table property) live in the pack's `tests/test_migration_composed_ownership.py`,
where both chains exist by construction and the pipeline has both checked out.

What survives here needs no pack at all, and none of it is vacuous. A community
deployment sharing a database with an enterprise one still carries
`alembic_version_ee`. That table is in no metadata, and it is precisely what a
filter written against product tables sweeps up.

**It pins `include_name` and it does not pin `include_object`, which was
measured rather than assumed.** Delete `include_object` from
`migrations/ownership.py` and every test in this file stays green, because with
no pack installed the shared metadata holds only the community tables, so
`include_object` has nothing to refuse; and `include_name` has already kept
`alembic_version_ee` out of the reflection, so it never reaches the metadata
side either. `include_object` is load bearing only once the pack has attached
its four models to the same declarative base, and the test that goes red when
it is deleted is in the pack, in `tests/test_migration_composed_ownership.py`
(three of them do). Deleting `include_name` fails
`test_the_community_chain_does_not_read_the_other_chain_out_of_the_database`
below, which is this file's job.

The control test keeps the rest honest. A filter that answered False for
everything, or an `env.py` that filtered the whole comparison away, would
satisfy every "proposes nothing" assertion in the file.
"""

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, Table, inspect, text
from sqlalchemy.engine.reflection import Inspector

from migrations.ownership import CE_TABLES
from tests.migration_chains import (
    CE_VERSION_TABLE,
    EE_VERSION_TABLE,
    ce_config,
    named_in,
    upgrade_operations,
)


@contextmanager
def stray_column(engine: Engine, table: str) -> Iterator[None]:
    """A column in the database that no model declares, committed so the
    connection `alembic check` opens for itself can see it."""
    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN stray_control TEXT"))
    try:
        yield
    finally:
        with engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE {table} DROP COLUMN stray_control"))


@pytest.fixture
def composed(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Engine]:
    """The community chain at head, beside the other chain's bookkeeping table.

    The community chain is stamped because `alembic check` refuses to compare
    anything against a database it considers behind head.

    `alembic_version_ee` is built by hand, unconditionally, and it is not a
    stand-in for a chain that could not be run. It is the real artefact: a
    community deployment sharing a database with an enterprise one carries that
    table, in no metadata, and a filter written against product tables sweeps
    it up. Building it by hand rather than by stamping the enterprise chain is
    also what makes this fixture behave identically whether or not a developer
    happens to have the pack installed, which is the difference this whole task
    exists to remove. The database with all seven product tables in it is the
    pack's, in `tests/test_migration_composed_ownership.py`.
    """
    from veodyn_api.settings import get_settings

    monkeypatch.setenv("VEODYN_DATABASE_URL", engine.url.render_as_string(hide_password=False))
    get_settings.cache_clear()

    def drop_version_tables() -> None:
        with engine.begin() as connection:
            connection.execute(text(f"DROP TABLE IF EXISTS {CE_VERSION_TABLE}"))
            connection.execute(text(f"DROP TABLE IF EXISTS {EE_VERSION_TABLE}"))

    drop_version_tables()
    command.stamp(ce_config(), "head")
    with engine.begin() as connection:
        connection.execute(text(f"CREATE TABLE {EE_VERSION_TABLE} (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
    yield engine
    drop_version_tables()


def test_the_database_carries_the_community_chain_and_the_other_version_table(composed: Engine) -> None:
    # If the fixture quietly built anything less than this, every assertion
    # below would be passing against a database with nothing to filter out.
    # A subset rather than an equality: a developer machine runs this suite
    # against the same Postgres the pack's suite uses, and the enterprise
    # tables may be sitting there from that run.
    present = set(inspect(composed).get_table_names())
    assert CE_TABLES | {CE_VERSION_TABLE, EE_VERSION_TABLE} <= present


def test_the_community_chain_proposes_nothing(composed: Engine) -> None:
    # With include_name alone this is four creates and four indexes, which is
    # the reading a reviewer accepts. See migrations/ownership.py for the
    # measurement of all four filter combinations.
    assert upgrade_operations(ce_config()) == []


def test_the_community_chain_does_not_propose_dropping_the_enterprise_version_table(composed: Engine) -> None:
    # alembic_version_ee is in no metadata at all, so it is the table most
    # likely to be swept up by a filter written only against product tables.
    # Alembic excludes a chain's OWN version table from reflection, which is
    # why each chain needs a filter only for the other's. The mirror of this,
    # the enterprise chain leaving `alembic_version` alone, is the half that
    # needs a second chain, and it is asserted in the pack.
    assert not [diff for diff in upgrade_operations(ce_config()) if EE_VERSION_TABLE in named_in(diff)]


def test_the_community_chain_still_notices_a_change_to_a_table_it_owns(composed: Engine) -> None:
    # The control. Without it, a filter that answered False for everything, or
    # an env.py that passed the filters nowhere useful, would make every test
    # above this one pass.
    with stray_column(composed, "favorite"):
        diffs = upgrade_operations(ce_config())

    assert [diff[0] for diff in diffs] == ["remove_column"]
    assert "favorite" in named_in(diffs[0])


def tables_read_out_of_the_database(config: Config, monkeypatch: pytest.MonkeyPatch) -> set[str]:
    """Which tables the autogenerate sweep actually reflects."""
    reflected: set[str] = set()
    reflect_table = Inspector.reflect_table

    def recording(inspector: Inspector, table: Table, *args: object, **kwargs: object) -> None:
        reflected.add(table.name)
        reflect_table(inspector, table, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(Inspector, "reflect_table", recording)
    upgrade_operations(config)
    return reflected


def test_the_community_chain_does_not_read_the_other_chain_out_of_the_database(
    composed: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """This is what `include_name` is for, and it is the only thing it does.

    Deleting `include_name` leaves the operation list empty, because
    `include_object` is consulted on the reflected side as well (its
    `reflected` argument is exactly that, and the removal branch at
    `alembic/autogenerate/compare/tables.py:165` passes True). What changes is
    one level earlier: the sweep reflects `alembic_version_ee`, and the removal
    branch does a full `reflect_table` on a table it is about to throw away. A
    chain that minds only its own tables should not be reading the other's.
    """
    assert tables_read_out_of_the_database(ce_config(), monkeypatch) == set(CE_TABLES)

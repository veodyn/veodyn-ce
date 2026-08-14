"""Applying the community chain: to an empty database, and to one at head.

`test_migration_chain.py` reads the chains out of their source. This half runs
the community one, because the two questions the split has to answer from this
side are both about what happens when `alembic upgrade head` executes:

- A **fresh** database gets the community chain's tables and no others.
- A database **already stamped at head**, which is what stage and prod are once
  a release lands, runs no revision body at all. That is the assertion with
  production behind it, and it is trivially satisfiable: comparing a current
  revision against an identical target is an empty list whatever the ancestry
  is, and a test written that way is green even after somebody renumbers the
  whole chain. So it does not ask Alembic what it plans. It wraps every revision
  module's `upgrade()` to record its own id, runs the upgrade for real, and
  asserts the recording is empty and the schema did not move.
  `test_the_body_recorder_records` is the control that keeps that from being a
  tautology: the same seed one revision back must record exactly the head id.

  Head is read from `CE_HEAD` rather than written out, so adding a revision does
  not silently turn this pair into a test of an old id. The renumber that
  derivation cannot catch is held separately, by
  `test_migration_chain.py::test_no_shipped_community_revision_id_was_renumbered`.

Each test gets a database of its own rather than the session `engine`. That one
is built with `create_all` and shared by the whole suite, and Alembic has to be
the only thing that has written to the database it is being measured on.
"""

from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from alembic.script.base import Script
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from migrations.ownership import CE_TABLES
from tests.conftest import TEST_DATABASE_URL
from tests.migration_chains import (
    CE_HEAD,
    CE_PREVIOUS,
    CE_VERSION_TABLE,
    ce_config,
)

HEAD_OBJECT = "uq_published_feed_public_slug"
HEAD_OBJECT_DROP = f"DROP INDEX {HEAD_OBJECT}"
"""What the head revision creates, and the statement that takes it back.

Named here rather than inline so the pairing with `CE_HEAD` is one thing to
update when a revision lands, and so a mismatch reads as these constants being
stale rather than as a puzzling `DuplicateTable` inside the upgrade.

It was `HEAD_TABLE = "publish_attempt"` with a hardcoded `DROP TABLE`, which
held only while every revision happened to create a table. 0013 creates an
INDEX, so the drop statement had to become part of what this names: a revision
adding a column or a constraint will move it again, and that is the point.
`relation` in Postgres covers both, which is why the stale version failed as
`DuplicateTable` for an index."""

CHAIN_DATABASE = "veodyn_migration_chain"
"""Its own database, named rather than randomised so a crashed run leaves one
stale database behind instead of one per run."""


@pytest.fixture
def fresh_url(monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    """An empty database, with settings pointed at it.

    `env.py` reads the URL from `veodyn_api.settings`, so pointing the settings
    at it is what makes `alembic upgrade` and `alembic stamp` land here.
    """
    from veodyn_api.settings import get_settings

    admin = make_url(TEST_DATABASE_URL).set(database="postgres")
    url = make_url(TEST_DATABASE_URL).set(database=CHAIN_DATABASE)
    engine = create_engine(admin, isolation_level="AUTOCOMMIT")

    def recreate() -> None:
        with engine.connect() as connection:
            # WITH (FORCE) rather than a polite disconnect: a failed test can
            # leave a session open, and a fixture that hangs on teardown is
            # harder to read than one that evicts.
            connection.execute(text(f'DROP DATABASE IF EXISTS "{CHAIN_DATABASE}" WITH (FORCE)'))

    recreate()
    with engine.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{CHAIN_DATABASE}"'))

    rendered = url.render_as_string(hide_password=False)
    monkeypatch.setenv("VEODYN_DATABASE_URL", rendered)
    get_settings.cache_clear()
    yield rendered
    recreate()
    engine.dispose()


def tables_in(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def columns_in(url: str) -> set[tuple[str, str]]:
    engine = create_engine(url)
    try:
        inspector = inspect(engine)
        return {
            (table, column["name"]) for table in inspector.get_table_names() for column in inspector.get_columns(table)
        }
    finally:
        engine.dispose()


def seed_like_prod(url: str, stamp: str = CE_HEAD) -> None:
    """This chain's product tables and a community stamp.

    Built with `create_all` rather than by running the chain: a seed made by
    the thing under test cannot be evidence about it.

    **Community tables only.** This used to build both chains' tables, because
    both were on the shared declarative base. They are not any more: the
    enterprise models live in the pack, this suite does not import them, and the
    four tables they carry are absent from `Base.metadata` here. So what this
    builds is a database at community head, which is enough for the two tests
    below and is NOT the pre-split shape.

    It builds **head's** shape, whatever head is, because `create_all` reads
    today's metadata. That is why `stamp` defaults to head and why a caller
    passing an earlier stamp has to undo the later revisions by hand.

    The pre-split shape (all seven product tables, one version table, stamped
    `0010`) is the case that can go wrong in production, and it cannot be built
    from this side any more. It is tested in the pack, which is the only place
    both chains exist at once, by `tests/test_migration_split_upgrade.py` and
    documented in its `docs/migration-runbook.md`.
    """
    from veodyn_api.models.base import Base

    engine = create_engine(url)
    try:
        Base.metadata.create_all(engine)
    finally:
        engine.dispose()
    command.stamp(ce_config(), stamp, purge=True)


def run_upgrade_recording_bodies(config: Config, target: str = "head") -> list[str]:
    """Run the upgrade and return the id of every revision body that executed.

    Alembic builds a `Script` per revision file and reads `module.upgrade` off
    it when it assembles the steps, so wrapping the function on the module as
    each `Script` is constructed catches every body that runs and nothing that
    does not. The modules are loaded fresh per `ScriptDirectory`, so the wrapper
    cannot leak into another test.
    """
    ran: list[str] = []
    original = Script.__init__

    def recording(self: Script, module: object, rev_id: str, path: str) -> None:
        original(self, module, rev_id, path)  # type: ignore[arg-type]
        upgrade = module.upgrade  # type: ignore[attr-defined]

        def recorded(*args: object, **kwargs: object) -> object:
            ran.append(rev_id)
            return upgrade(*args, **kwargs)

        module.upgrade = recorded  # type: ignore[attr-defined]

    Script.__init__ = recording  # type: ignore[method-assign, assignment]
    try:
        command.upgrade(config, target)
    finally:
        Script.__init__ = original  # type: ignore[method-assign]
    return ran


def test_a_fresh_community_database_gets_exactly_the_community_tables(fresh_url: str) -> None:
    # Set equality, not a superset: a superset assertion still passes when a
    # wrongly retained fragment of `0001` is still creating `kpi_history_point`
    # over here.
    #
    # Its two neighbours went to the pack. One ran the enterprise chain against
    # a fresh database and one ran both chains against one, and both reached
    # that chain through an `importorskip` that never resolves in this gate, so
    # both skipped every time this suite ran. This one needs no pack, so it
    # stays, and the pack's `tests/test_migration_split_upgrade.py` carries a
    # stronger twin of all three.
    command.upgrade(ce_config(), "head")

    assert tables_in(fresh_url) - {CE_VERSION_TABLE} == set(CE_TABLES)


def test_a_database_already_at_head_runs_no_revision_body(fresh_url: str) -> None:
    # Named for the property rather than for a revision id. It used to say
    # `0010`, which meant every new revision renamed the test or left it
    # asserting something its own name denied.
    seed_like_prod(fresh_url)
    before = columns_in(fresh_url)

    ran = run_upgrade_recording_bodies(ce_config())

    assert ran == [], f"an upgrade of a database at head executed {ran}"
    assert columns_in(fresh_url) == before


def test_the_body_recorder_records(fresh_url: str) -> None:
    """The control, without which the assertion above is a tautology.

    The same seed taken back exactly what the head revision does, stamped one
    revision earlier. Undone by hand rather than by running head's own
    downgrade, so the control does not depend on the chain it instruments.

    `create_all` builds whatever is in `Base.metadata` today, which is head's
    shape, so a seed stamped earlier than head is only consistent once head's
    effect is reversed here. Miss that and the upgrade fails as `DuplicateTable`
    rather than as the assertion this test is making.
    """
    seed_like_prod(fresh_url, stamp=CE_PREVIOUS)
    engine = create_engine(fresh_url)
    with engine.begin() as connection:
        connection.execute(text(HEAD_OBJECT_DROP))
    engine.dispose()

    assert run_upgrade_recording_bodies(ce_config()) == [CE_HEAD]
    assert HEAD_OBJECT in relations_in(fresh_url)


def relations_in(url: str) -> set[str]:
    """Tables AND indexes, because head is not always a table.

    `tables_in` was enough while every revision created one. It silently answers
    "absent" for an index, so using it here would have made the assertion above
    fail for the right reason by accident and then pass for the wrong one the
    moment somebody made it lenient.
    """
    engine = create_engine(url)
    with engine.begin() as connection:
        names = set(connection.execute(text("SELECT relname FROM pg_class")).scalars())
    engine.dispose()
    return names

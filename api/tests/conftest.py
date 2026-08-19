"""Shared fixtures.

This file is owned by the controller, not by any single task: several tasks
depend on these fixtures and none of them may redefine one. If a task needs a
new fixture, add it here rather than shadowing an existing name in a test
module.

The model imports are deliberately inside the fixture bodies. The fixtures are
collected for every test run, including runs from before the models exist, and
a module-level import would make an unrelated test file fail to collect.
"""

import importlib.util
import os
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from veodyn_api.main import create_app

TEST_DATABASE_URL = os.environ.get(
    "VEODYN_TEST_DATABASE_URL", "postgresql+psycopg://postgres@localhost:15432/veodyn_test"
)

REDASH_TEST_URL = "http://redash.test"


@pytest.fixture(autouse=True)
def _reset_caches() -> Iterator[None]:
    """Settings and the Redash client are lru_cached, and the session cache is
    process-local. Without this, a monkeypatched env var from one test leaks
    into the next one."""
    from veodyn_api.settings import get_settings

    get_settings.cache_clear()
    # find_spec rather than a try/except around the import: this must skip the
    # auth caches only while that module does not exist yet, and must not
    # swallow a real ImportError from inside it once it does.
    if importlib.util.find_spec("veodyn_api.auth") is not None:
        from veodyn_api.auth import clear_session_cache, get_redash_client

        clear_session_cache()
        get_redash_client.cache_clear()
    # The model client is lru_cached on settings the same way.
    from veodyn_api.services.llm import get_llm_client

    get_llm_client.cache_clear()
    # The digest cache used to be cleared here. It left with the endpoint that
    # fills it, so there is nothing process-wide to clear in a community build;
    # the pack's own conftest clears it for the tests that moved with it.
    yield
    get_settings.cache_clear()


@pytest.fixture
def client() -> TestClient:
    """The app with no database and no Redash. For /health and error shapes."""
    return TestClient(create_app(), raise_server_exceptions=False)


@pytest.fixture(scope="session")
def engine() -> Engine:
    from tests.fixture_objects import FixtureBase
    from veodyn_api.models.base import Base

    engine = create_engine(TEST_DATABASE_URL)
    for metadata in (FixtureBase.metadata, Base.metadata):
        metadata.drop_all(engine)
    for metadata in (Base.metadata, FixtureBase.metadata):
        metadata.create_all(engine)
    return engine


def created_tables() -> list[str]:
    """Every table the session engine built, children before parents.

    Derived rather than listed. The list it replaced named `kpi`,
    `kpi_history_point`, `report` and `external_access`, and once those tables
    stopped existing in a community build the TRUNCATE raised for EVERY database
    test rather than for the enterprise ones, because one statement naming a
    missing relation fails whole. Reading `sorted_tables` means the fixture
    cleans whatever the installed edition actually created, community tables
    plus the pack's four and the fixture table in a composed run, without this
    docstring having to carry a count that goes stale every time a table lands.
    """
    from tests.fixture_objects import FixtureBase
    from veodyn_api.models.base import Base

    tables = [*Base.metadata.sorted_tables, *FixtureBase.metadata.sorted_tables]
    return [table.name for table in reversed(tables)]


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    maker = sessionmaker(bind=engine, expire_on_commit=False)
    session = maker()
    yield session
    session.close()
    with engine.begin() as connection:
        connection.execute(text(f"TRUNCATE {', '.join(created_tables())} RESTART IDENTITY CASCADE"))


@pytest.fixture
def api(db: Session, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The full app wired to the test database, with Redash pointed at a host
    respx can intercept. Every router test uses this."""
    monkeypatch.setenv("VEODYN_REDASH_URL", REDASH_TEST_URL)
    monkeypatch.setenv("VEODYN_REDASH_SERVICE_API_KEY", "service-key")

    from veodyn_api.db import get_db
    from veodyn_api.settings import get_settings

    get_settings.cache_clear()
    app = create_app()

    def _override_db() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_db] = _override_db
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def fixture_kind() -> Iterator[str]:
    """Register the test-only object kinds and yield the primary one's name.

    Community tags, favorites and hub tests used `kpi` and `report` until those
    kinds left the tree with the pack. These are the replacement, contributed
    through the same registry seam a pack uses, and torn down again so a module
    that does not ask for them still sees the three kinds a community build has.
    """
    from tests.fixture_objects import registered_fixture_kinds

    with registered_fixture_kinds() as (primary, _second):
        yield primary.kind


def session_payload(
    *,
    user_id: int = 7,
    name: str = "Jane Analyst",
    email: str = "jane@example.org",
    permissions: list[str] | None = None,
    org_slug: str = "default",
) -> dict[str, Any]:
    """Redash's GET /api/session shape for a signed-in user."""
    return {
        "user": {
            "id": user_id,
            "name": name,
            "email": email,
            "groups": [1],
            "permissions": permissions if permissions is not None else ["create_query", "execute_query"],
        },
        "org_slug": org_slug,
    }


ALEMBIC_TEST_DATABASE = "veodyn_migration_test"
"""A database of its own for a migration test that needs real rows, separate
from `CHAIN_DATABASE` in tests/test_migration_upgrade.py so the two cannot
collide when run in parallel."""


@pytest.fixture
def alembic_engine_at_0014(monkeypatch: pytest.MonkeyPatch) -> Iterator[Engine]:
    """A fresh database, upgraded through the community chain to 0014 and no
    further, so a test can seed rows under the old schema before running a
    later revision on them."""
    from alembic import command
    from sqlalchemy.engine import make_url

    from tests.migration_chains import ce_config
    from veodyn_api.settings import get_settings

    admin = make_url(TEST_DATABASE_URL).set(database="postgres")
    url = make_url(TEST_DATABASE_URL).set(database=ALEMBIC_TEST_DATABASE)
    admin_engine = create_engine(admin, isolation_level="AUTOCOMMIT")

    def recreate() -> None:
        with admin_engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{ALEMBIC_TEST_DATABASE}" WITH (FORCE)'))

    recreate()
    with admin_engine.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{ALEMBIC_TEST_DATABASE}"'))

    monkeypatch.setenv("VEODYN_DATABASE_URL", url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    command.upgrade(ce_config(), "0014")

    engine = create_engine(url)
    yield engine
    engine.dispose()
    recreate()
    admin_engine.dispose()


def upgrade_to(engine: Engine, target: str) -> None:
    """Advance the database `engine` points at to `target` in the community
    chain. `alembic_engine_at_0014` already pointed settings at it."""
    from alembic import command

    from tests.migration_chains import ce_config

    command.upgrade(ce_config(), target)

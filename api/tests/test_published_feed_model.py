"""The binding row: what it accepts and what it refuses at the database.

Two schemas, deliberately, because the table is written down twice and the two
copies can disagree without anything going red:

- the session `engine` builds `published_feed` from `Base.metadata`, which is
  the model file
- `migrated_engine` below builds it by running the community chain, which is
  `migrations/versions/0011_published_feed.py`

Every test above the migration fixture runs against the first, every test below
it against the second, and the pair of default tests asserts the same answer of
both. That pairing is the point: `migrations/env.py` sets `compare_type` and not
`compare_server_default`, so autogenerate cannot see a default drifting apart,
and a model declaring a Python-side `default=` where the migration declares a
`server_default` reads as agreement everywhere except a raw INSERT.
"""

import json
from collections.abc import Iterator

import pytest
from alembic import command
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import TextClause

from tests.conftest import TEST_DATABASE_URL
from tests.migration_chains import ce_config
from veodyn_api.models.published_feed import PublishedFeed

COLUMNS: dict[str, bool] = {
    "org_slug": False,
    "slug": False,
    "revision": False,
    "query_id": False,
    "standard": False,
    "version": False,
    "entity": False,
    "static_gtfs_ref": False,
    "source_column": True,
    "column_map": False,
    "on_error": False,
    "last_good_max_age_seconds": True,
    "visibility": False,
    "created_by_user_id": False,
    "updated_at": False,
}
"""Column name -> whether it is nullable, written out rather than derived.

Derived from the model it would be comparing the model to itself, and derived
from the migration it would be comparing the migration to itself. Spelled out,
it is a third statement both have to match, so a column dropped from both still
fails here.
"""

CONSTRAINTS = frozenset(
    {
        "ck_published_feed_cap_matches_mode",
        "ck_published_feed_on_error",
        "ck_published_feed_visibility",
    }
)


def _binding(**overrides):
    fields = {
        "org_slug": "acme",
        "slug": "vehicles",
        "revision": 1,
        "query_id": 42,
        "standard": "gtfs-rt",
        "version": "2.0",
        "entity": "vehicle_positions",
        "static_gtfs_ref": "https://example.org/gtfs.zip",
        "source_column": None,
        "column_map": {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"},
        "on_error": "block",
        "last_good_max_age_seconds": None,
        "visibility": "private",
        "created_by_user_id": 7,
    }
    fields.update(overrides)
    return PublishedFeed(**fields)


def _raw_row(**overrides: object) -> tuple[TextClause, dict[str, object]]:
    """An INSERT in SQL rather than through the ORM.

    `revision`, `on_error` and `visibility` are absent from the base row on
    purpose. An ORM insert names every column it maps, so a statement that omits
    them is the only way to ask what the schema itself supplies; a caller
    testing a constraint passes the one it needs as an override.
    """
    row: dict[str, object] = {
        "org_slug": "acme",
        "slug": "vehicles",
        "query_id": 42,
        "standard": "gtfs-rt",
        "version": "2.0",
        "entity": "vehicle_positions",
        "static_gtfs_ref": "https://example.org/gtfs.zip",
        "column_map": json.dumps({"vehicle_id": "bus"}),
        "created_by_user_id": 7,
    }
    row.update(overrides)
    columns = ", ".join(row)
    values = ", ".join(f"CAST(:{name} AS JSONB)" if name == "column_map" else f":{name}" for name in row)
    return text(f"INSERT INTO published_feed ({columns}) VALUES ({values})"), row


DEFAULTED = text("SELECT revision, on_error, visibility FROM published_feed")


def test_binding_round_trips_its_column_map(db):
    db.add(_binding())
    db.commit()

    stored = db.get(PublishedFeed, ("acme", "vehicles"))
    assert stored.column_map == {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"}
    assert stored.on_error == "block"


def test_same_slug_in_two_orgs_is_two_rows(db):
    db.add(_binding())
    db.add(_binding(org_slug="other"))
    db.commit()

    assert db.get(PublishedFeed, ("acme", "vehicles")).query_id == 42
    assert db.get(PublishedFeed, ("other", "vehicles")).query_id == 42


def test_last_good_requires_a_cap(db):
    """`last_good` without a cap has no safety boundary, so the row is refused."""
    db.add(_binding(on_error="last_good", last_good_max_age_seconds=None))
    with pytest.raises(IntegrityError):
        db.commit()


def test_block_may_not_carry_a_cap(db):
    """A cap on `block` would be an uncapped `last_good` wearing the wrong name."""
    db.add(_binding(on_error="block", last_good_max_age_seconds=60))
    with pytest.raises(IntegrityError):
        db.commit()


def test_a_capped_last_good_is_accepted(db):
    """The half the three refusals above cannot show.

    A constraint reading `on_error <> 'last_good'` refuses every row those tests
    submit and passes all of them, so without this one nothing distinguishes the
    binding the design is built around from a mode banned outright.
    """
    db.add(_binding(on_error="last_good", last_good_max_age_seconds=300))
    db.commit()

    stored = db.get(PublishedFeed, ("acme", "vehicles"))
    assert stored.on_error == "last_good"
    assert stored.last_good_max_age_seconds == 300


def test_the_schema_the_model_builds_fills_in_the_three_defaults(db: Session) -> None:
    """`create_all()`'s table, asked the question only a raw INSERT can ask.

    A Python-side `default=` lives in the ORM and never reaches the DDL, so this
    is where a model declaring one and a migration declaring a `server_default`
    stop describing the same table. Paired with
    `test_the_migrated_table_fills_in_the_three_defaults`, which asks the other
    copy of the schema and has to get the same answer.
    """
    db.execute(*_raw_row())
    db.commit()

    assert db.execute(DEFAULTED).one() == (1, "block", "private")


@pytest.fixture(scope="module")
def migrated_engine() -> Iterator[Engine]:
    """An engine on a database built by `alembic upgrade head`, nothing else.

    Its own database, and not the session `engine`: that one is built from
    `Base.metadata` by `create_all`, so no test using it can see the migration
    at all, which is the gap these tests close. Named rather than randomised,
    for the reason `test_migration_upgrade.py` gives, and module scoped because
    the chain is run once and every test below reads a rolled-back transaction.

    `env.py` takes the URL from `veodyn_api.settings`, so pointing the settings
    at this database is what makes the upgrade land here rather than on the
    suite's own. The patch is undone before the first test runs: the upgrade is
    the only thing that may see it.
    """
    from veodyn_api.settings import get_settings

    database = "veodyn_published_feed_chain"
    admin = create_engine(make_url(TEST_DATABASE_URL).set(database="postgres"), isolation_level="AUTOCOMMIT")
    url = make_url(TEST_DATABASE_URL).set(database=database).render_as_string(hide_password=False)

    def drop() -> None:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)'))

    drop()
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{database}"'))

    patch = pytest.MonkeyPatch()
    patch.setenv("VEODYN_DATABASE_URL", url)
    get_settings.cache_clear()
    try:
        command.upgrade(ce_config(), "head")
    finally:
        patch.undo()
        get_settings.cache_clear()

    engine = create_engine(url)
    try:
        yield engine
    finally:
        engine.dispose()
        drop()
        admin.dispose()


def test_the_migration_builds_the_columns_the_model_declares(migrated_engine: Engine) -> None:
    inspector = inspect(migrated_engine)
    migrated = {column["name"]: bool(column["nullable"]) for column in inspector.get_columns("published_feed")}
    declared = {column.name: column.nullable for column in PublishedFeed.__table__.columns}

    # Three-way, and equality rather than a superset in each direction: a
    # superset is green while the migration carries a column the model has never
    # heard of, which is exactly the drift this is here to name.
    assert migrated == COLUMNS
    assert declared == COLUMNS
    assert inspector.get_pk_constraint("published_feed")["constrained_columns"] == ["org_slug", "slug"]


def test_the_migrated_table_fills_in_the_three_defaults(migrated_engine: Engine) -> None:
    """The other half of the pair: the migration's answer to the same INSERT."""
    with migrated_engine.connect() as connection:
        connection.execute(*_raw_row())

        assert connection.execute(DEFAULTED).one() == (1, "block", "private")


def test_the_migrated_table_carries_the_models_check_constraints(migrated_engine: Engine) -> None:
    migrated = {constraint["name"] for constraint in inspect(migrated_engine).get_check_constraints("published_feed")}
    declared = {constraint.name for constraint in PublishedFeed.__table__.constraints} - {None}

    assert migrated == set(CONSTRAINTS)
    assert CONSTRAINTS <= declared


@pytest.mark.parametrize(
    ("constraint", "row"),
    [
        ("ck_published_feed_cap_matches_mode", {"on_error": "last_good", "last_good_max_age_seconds": None}),
        ("ck_published_feed_cap_matches_mode", {"on_error": "block", "last_good_max_age_seconds": 60}),
        ("ck_published_feed_on_error", {"on_error": "warn"}),
        ("ck_published_feed_visibility", {"visibility": "unlisted"}),
    ],
)
def test_the_migrated_table_refuses_the_row_each_constraint_names(
    migrated_engine: Engine, constraint: str, row: dict[str, object]
) -> None:
    """Named, not just counted.

    Asserting `IntegrityError` alone would be satisfied by any of the three
    firing, so a constraint written against the wrong column still reads as
    coverage; Postgres puts the constraint's own name in the message, and each
    row here violates exactly one.
    """
    with migrated_engine.connect() as connection:
        with pytest.raises(IntegrityError) as refused:
            connection.execute(*_raw_row(**row))

    assert constraint in str(refused.value)


def test_the_migrated_table_accepts_what_the_constraints_permit(migrated_engine: Engine) -> None:
    """The positive case again, against the migration's own DDL."""
    with migrated_engine.connect() as connection:
        connection.execute(*_raw_row(on_error="last_good", last_good_max_age_seconds=300, visibility="public"))

        stored = connection.execute(
            text("SELECT on_error, last_good_max_age_seconds, visibility FROM published_feed")
        ).one()

    assert stored == ("last_good", 300, "public")

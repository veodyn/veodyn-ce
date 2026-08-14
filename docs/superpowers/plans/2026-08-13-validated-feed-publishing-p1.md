# Validated Feed Publishing P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A query can be bound to a GTFS-RT VehiclePositions output, and every publish attempt serializes it, validates it against the agency's static GTFS, and stores an artifact whose verdict decides whether the feed publishes.

**Architecture:** Six units in `api/`, all community-edition. A Postgres binding row (`published_feed`) plus a per-attempt artifact row (`publish_attempt`); a pure serializer turning query rows into GTFS-RT protobuf; an HTTP client to the containerized MobilityData validator that normalizes its output into one result schema; and an attempt engine composing those three. Scheduling is deliberately absent: the engine is a callable service function so the enterprise worker can drive it on a poll without this tree owning a queue.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (`Mapped`/`mapped_column`), Alembic, pydantic v2, `gtfs-realtime-bindings` (protobuf), pytest, uv, ruff.

**Spec:** `docs/superpowers/specs/2026-08-13-validated-feed-publishing-design.md`

## Global Constraints

- **Formatting gate is real.** `ci/veodyn-api-test.yaml` runs `ruff check`, **`ruff format --check`**, `mypy veodyn_api`, `pytest`, and an `openapi.json` diff. Run `uv run ruff format .` from `api/` before every commit.
- **Any response-model change obliges `pnpm gen:api-types` from `app/`** or the openapi diff fails the pipeline.
- **Every new module under `veodyn_api/` needs one line in `api/tests/ce_module_allowlist.json` under `retained`.** `tests/test_ce_has_no_ee_code.py` holds it to the tree. Adding a community module "is meant to be a decision."
- **Every new table needs adding to `CE_TABLES` in `api/migrations/ownership.py`** (currently `{"favorite", "tag_assignment", "feed_expectation"}`). `tests/test_migration_allowlists.py` fails otherwise, and the autogenerate filter would propose dropping the new table.
- **Migration chain:** community revisions use `alembic_version`; the latest community revision is `0010_feed_alert_link`. New revisions chain from it. Numbering gaps are the enterprise chain and are intentional.
- **`org_slug` is part of every primary key** (the rule `FeedExpectation`, `Kpi` and `Favorite` all follow), so a cross-tenant row cannot be addressed by id alone.
- **Owner references are Redash user ids, never display names.**
- **`ErrorId` values are never renumbered or reused.** New causes append to the enum in `api/veodyn_api/errors.py`.
- **Land a declaration and its uses in one edit.** `lint-on-edit` runs after every edit with `--max-warnings 0`, so an import added in one edit and used in the next fails on `F401`. In Python, invert the TS rule: add the *usage* first or write the whole file at once, because `ruff --fix` deletes a not-yet-used import.
- **File size blocks at 300 lines.** Split along real seams, not to hit a number.
- **Never run `ruff format` in `node/`.** This plan does not touch `node/` at all.

### Verified conventions (do not substitute your own)

These were checked against the tree on 2026-08-13. Using anything else here will fail.

- **Test fixtures are `db` (a `Session`) and `api` (a `TestClient` wired to the test database).** There is no `db_session`. A bare `client` fixture does exist (`conftest.py:59`) but it is the app with **no** database, for `/health` and error-shape tests; router tests that touch data want `api`, which points Redash at `REDASH_TEST_URL` for respx to intercept.
- **Authentication in router tests is respx-mocked Redash sessions.** Copy `api/tests/test_favorites.py:45-55`: `as_user(session_payload(...))` mocks `GET /api/session`, and `auth(cookie)` builds the header. **One cookie value per identity, never shared** (`require_identity` caches the resolved session against the credential, so a reused cookie hands the second person the first person's identity and the test passes for the wrong reason).
- **Admin permission is `session_payload(permissions=["admin"])`**, read via `identity.is_admin` (`auth.py:26`). **There is no `require_admin` dependency**; guard inside the handler and raise `ApiError(ErrorId.FORBIDDEN, ..., status_code=403)`.
- **`ApiError(error_id, message, status_code=400)` takes no `extra`** (`errors.py:118`). Per-field problems go in the `message` string.
- **The error envelope is `{"error": {"id": ..., "message": ...}}`** (`errors.py:126`). Assert `response.json()["error"]["id"]`, never `["errorId"]`.
- **`caller_credential(cookie, authorization)`** takes the two header values (`auth.py:65`) and returns a tuple; it does not take an `Identity`.
- **`query_result_columns(redash, query_id, api_key)`** takes an API key string (`ai_grounding.py:200`).
- **`Identity` fields** are `user_id`, `name`, `email`, `groups`, `permissions`, `org_slug` (`auth.py:15-23`).

### Corrections from wave 1 (Tasks 1, 2, 4 are built; these were measured, not guessed)

- **mypy runs `strict`.** A bare `dict` or `list` annotation fails
  `disallow_any_generics`. Write `list[dict[str, Any]]`, not `list[dict]`.
- **`protobuf`'s `SerializeToString` is untyped**, so returning it directly
  fails `no-any-return` under strict. Assign to an annotated local and return
  that.
- **`deterministic=True` proves nothing here.** It orders protobuf *map*
  fields, and `FeedMessage` has none anywhere in its tree, so removing it
  leaves every test green. Keep the flag (free, and holds if the schema ever
  gains a map) but do not claim a test covers it. Row **order** is the real
  determinism risk and needs its own test.
- **A new model must be imported in `api/veodyn_api/models/__init__.py`.**
  `migrations/env.py` reaches `target_metadata` through that module and nothing
  else, so a model missing from it is invisible to autogenerate on the metadata
  side while `include_name` still reflects its table out of the database, and
  the sweep proposes dropping the table the chain just created. A test module
  importing the model directly masks this, because collection populates the
  metadata as a side effect.
- **Adding a revision touches migration-chain bookkeeping.** `CE_REVISIONS` in
  `tests/migration_chains.py` is a hand-maintained ratchet (deriving it would
  make `test_the_community_revision_files_are_exactly_the_community_chain`
  compare the files to themselves). Add the new id to it. `CE_HEAD` and
  `CE_PREVIOUS` are derived from it, so the head is named once.
- **`seed_like_prod` builds head's shape**, because `create_all` reads today's
  metadata. Seeding at a stamp earlier than head requires undoing the later
  revisions by hand, or the upgrade fails as `DuplicateTable` rather than as
  the assertion the test is making.
- **`gtfs-realtime-bindings>=1.0` resolves to 2.2.0** (protobuf 7.35.1). The
  floor is looser than the tested version.

### The CE allowlist takes file paths, not module names

`api/tests/ce_module_allowlist.json` has two arrays and they use different
notations, which is the trap. `moved` holds dotted module names
(`veodyn_api.models.kpi`). **`retained` holds file paths relative to
`veodyn_api/`** (`models/kpi.py`), and `tests/test_ce_has_no_ee_code.py:89`
asserts it equals `sorted(...)` over the real tree. So an entry must be a path,
and the array must stay sorted, or the test fails naming the mismatch.


---

### Task 1: The `published_feed` binding table

**Files:**
- Create: `api/veodyn_api/models/published_feed.py`
- Create: `api/migrations/versions/0011_published_feed.py`
- Modify: `api/migrations/ownership.py:64` (add to `CE_TABLES`)
- Modify: `api/tests/ce_module_allowlist.json` (add to `retained`)
- Test: `api/tests/test_published_feed_model.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `PublishedFeed` ORM model with columns `org_slug: str`, `slug: str`, `revision: int`, `query_id: int`, `standard: str`, `version: str`, `entity: str`, `static_gtfs_ref: str`, `source_column: str | None`, `column_map: dict[str, str]`, `on_error: str`, `last_good_max_age_seconds: int | None`, `visibility: str`, `created_by_user_id: int`, `updated_at: datetime`. Table name `published_feed`, PK `(org_slug, slug)`.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_published_feed_model.py`:

```python
"""The binding row: what it accepts and what it refuses at the database."""

import pytest
from sqlalchemy.exc import IntegrityError

from veodyn_api.models.published_feed import PublishedFeed


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
```

- [ ] **Step 2: Run test to verify it fails**

Run from `api/`: `uv run pytest tests/test_published_feed_model.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'veodyn_api.models.published_feed'`

- [ ] **Step 3: Write the model**

Create `api/veodyn_api/models/published_feed.py`:

```python
"""A query declared to publish a standard feed.

Keyed (org_slug, slug) for the reason FeedExpectation is keyed (org_slug,
feed_id): a cross-tenant row must not be addressable by id alone. The slug is
also the public URL path, so the pair is both the identity and the address.

`revision` is bumped by any edit that changes what a feed is validated
against, and it is half of an artifact's identity. Without it a binding edit
would silently reuse an artifact produced under the old mapping, and the
endpoint would serve bytes nothing had validated in its current shape.

One `static_gtfs_ref`, because a node serves one agency. That is the tier
boundary the design turns on: a hub aggregating several agencies needs one
schedule per contributing node, since GTFS trip, route and stop identifiers
are not unique across agencies. Making this column plural is how this table
would become a hub table, and it is deliberately not.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base


class PublishedFeed(Base):
    __tablename__ = "published_feed"
    __table_args__ = (
        # `last_good` without a cap is an unbounded promise to serve stale
        # bytes, and a cap on `block` is that same promise under a name that
        # denies it. Both are refused here rather than in a validator, so a
        # direct database write cannot produce a binding the engine would have
        # to guess about.
        CheckConstraint(
            "(on_error = 'last_good') = (last_good_max_age_seconds IS NOT NULL)",
            name="ck_published_feed_cap_matches_mode",
        ),
        CheckConstraint(
            "on_error IN ('block', 'last_good')",
            name="ck_published_feed_on_error",
        ),
        CheckConstraint(
            "visibility IN ('private', 'public')",
            name="ck_published_feed_visibility",
        ),
    )

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    slug: Mapped[str] = mapped_column(Text, primary_key=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    query_id: Mapped[int] = mapped_column(Integer, nullable=False)

    standard: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(Text, nullable=False)
    entity: Mapped[str] = mapped_column(Text, nullable=False)

    static_gtfs_ref: Mapped[str] = mapped_column(Text, nullable=False)

    # Optional at node tier: provenance here usually names a provider, and a
    # single-provider feed has nothing to partition. It becomes required at
    # the hub, where a source is a node.
    source_column: Mapped[str | None] = mapped_column(Text, nullable=True)

    # spec field -> query column. JSONB rather than a child table: it is read
    # and written whole, never queried into.
    column_map: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False)

    on_error: Mapped[str] = mapped_column(Text, nullable=False, default="block")
    last_good_max_age_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    visibility: Mapped[str] = mapped_column(Text, nullable=False, default="private")

    created_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
```

- [ ] **Step 4: Write the migration**

Create `api/migrations/versions/0011_published_feed.py`:

```python
"""published_feed table

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "published_feed",
        sa.Column("org_slug", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("query_id", sa.Integer(), nullable=False),
        sa.Column("standard", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("entity", sa.Text(), nullable=False),
        sa.Column("static_gtfs_ref", sa.Text(), nullable=False),
        sa.Column("source_column", sa.Text(), nullable=True),
        sa.Column("column_map", postgresql.JSONB(), nullable=False),
        sa.Column("on_error", sa.Text(), nullable=False, server_default="block"),
        sa.Column("last_good_max_age_seconds", sa.Integer(), nullable=True),
        sa.Column("visibility", sa.Text(), nullable=False, server_default="private"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("org_slug", "slug"),
        sa.CheckConstraint(
            "(on_error = 'last_good') = (last_good_max_age_seconds IS NOT NULL)",
            name="ck_published_feed_cap_matches_mode",
        ),
        sa.CheckConstraint("on_error IN ('block', 'last_good')", name="ck_published_feed_on_error"),
        sa.CheckConstraint("visibility IN ('private', 'public')", name="ck_published_feed_visibility"),
    )


def downgrade() -> None:
    op.drop_table("published_feed")
```

- [ ] **Step 5: Register the table and the module**

In `api/migrations/ownership.py` line 64, change:

```python
CE_TABLES = frozenset({"favorite", "tag_assignment", "feed_expectation"})
```

to:

```python
CE_TABLES = frozenset({"favorite", "tag_assignment", "feed_expectation", "published_feed"})
```

In `api/tests/ce_module_allowlist.json`, add `"models/published_feed.py"` to the `retained` array, keeping the array sorted (the test compares it to `sorted(...)` of the real tree, so order is part of the contract).

- [ ] **Step 6: Run the tests**

Run from `api/`: `uv run pytest tests/test_published_feed_model.py tests/test_migration_allowlists.py tests/test_ce_has_no_ee_code.py -v`
Expected: PASS

- [ ] **Step 7: Format, lint, commit**

```bash
cd api && uv run ruff format . && uv run ruff check . && uv run mypy veodyn_api
git add api/veodyn_api/models/published_feed.py api/migrations/versions/0011_published_feed.py api/migrations/ownership.py api/tests/ce_module_allowlist.json api/tests/test_published_feed_model.py
git commit -m "feat(api): add the published_feed binding table"
```

---

### Task 2: GTFS-RT VehiclePositions serializer

**Files:**
- Create: `api/veodyn_api/services/gtfs_rt_serializer.py`
- Modify: `api/pyproject.toml` (add `gtfs-realtime-bindings`)
- Modify: `api/tests/ce_module_allowlist.json`
- Test: `api/tests/test_gtfs_rt_serializer.py`

**Interfaces:**
- Consumes: nothing. Deliberately pure: no database, no HTTP, no clock.
- Produces:
  - `REQUIRED_FIELDS: dict[str, frozenset[str]]` mapping entity name to its required spec fields. For `vehicle_positions`: `{"vehicle_id", "latitude", "longitude"}`.
  - `class SerializationError(Exception)` with attribute `reason: str`.
  - `serialize_vehicle_positions(rows: list[dict], column_map: dict[str, str], feed_timestamp: int) -> bytes`

- [ ] **Step 1: Add the dependency**

In `api/pyproject.toml`, add to the `dependencies` list, after `"psycopg[binary]>=3.2",`:

```toml
    # The official protobuf bindings for GTFS-Realtime. Pure generated Python
    # over `protobuf`; nothing here speaks to a network.
    "gtfs-realtime-bindings>=1.0",
```

Then run from `api/`: `uv lock && uv sync`

- [ ] **Step 2: Write the failing test**

Create `api/tests/test_gtfs_rt_serializer.py`:

```python
"""Rows to GTFS-Realtime bytes: what maps, what is refused, what is dropped."""

import pytest
from google.transit import gtfs_realtime_pb2

from veodyn_api.services.gtfs_rt_serializer import (
    SerializationError,
    serialize_vehicle_positions,
)

COLUMN_MAP = {
    "vehicle_id": "bus",
    "latitude": "lat",
    "longitude": "lon",
    "trip_id": "trip",
}


def _parse(payload: bytes) -> gtfs_realtime_pb2.FeedMessage:
    message = gtfs_realtime_pb2.FeedMessage()
    message.ParseFromString(payload)
    return message


def test_a_row_becomes_an_entity():
    rows = [{"bus": "bus-1", "lat": 34.05, "lon": -118.25, "trip": "t1"}]

    message = _parse(serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700))

    assert message.header.gtfs_realtime_version == "2.0"
    assert message.header.timestamp == 1700
    assert len(message.entity) == 1
    entity = message.entity[0]
    assert entity.id == "bus-1"
    assert entity.vehicle.vehicle.id == "bus-1"
    assert entity.vehicle.trip.trip_id == "t1"
    assert entity.vehicle.position.latitude == pytest.approx(34.05)


def test_numeric_strings_coerce():
    """A warehouse column can arrive as text; a valid number in it is valid."""
    rows = [{"bus": "bus-1", "lat": "34.05", "lon": "-118.25", "trip": "t1"}]

    message = _parse(serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700))

    assert message.entity[0].vehicle.position.latitude == pytest.approx(34.05)


def test_a_row_missing_a_required_value_is_refused_not_dropped():
    """The runner drops these silently today; the publisher must not.

    A dropped row is a feed that is quietly short, which validates clean and
    is wrong. Refusing names the defect while it is still fixable.
    """
    rows = [{"bus": "bus-1", "lat": None, "lon": -118.25, "trip": "t1"}]

    with pytest.raises(SerializationError) as excinfo:
        serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700)

    assert "latitude" in excinfo.value.reason


def test_an_uncoercible_value_is_refused():
    rows = [{"bus": "bus-1", "lat": "north", "lon": -118.25, "trip": "t1"}]

    with pytest.raises(SerializationError) as excinfo:
        serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700)

    assert "latitude" in excinfo.value.reason


def test_a_column_map_missing_a_required_field_is_refused():
    with pytest.raises(SerializationError) as excinfo:
        serialize_vehicle_positions([], {"vehicle_id": "bus"}, feed_timestamp=1700)

    assert "latitude" in excinfo.value.reason
    assert "longitude" in excinfo.value.reason


def test_optional_fields_are_omitted_when_unmapped():
    """An unmapped optional field must be absent, not present-and-default.

    A zero bearing is a real heading, so writing 0.0 for "we do not know"
    publishes an assertion the data never made.
    """
    rows = [{"bus": "bus-1", "lat": 34.05, "lon": -118.25}]
    message = _parse(
        serialize_vehicle_positions(
            rows, {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"}, feed_timestamp=1700
        )
    )

    assert not message.entity[0].vehicle.position.HasField("bearing")
    assert not message.entity[0].vehicle.HasField("trip")


def test_output_is_deterministic():
    """Two runs over equal input must produce equal bytes, or every artifact
    digest and every content-changed rule becomes noise."""
    rows = [
        {"bus": "b2", "lat": 34.06, "lon": -118.26, "trip": "t2"},
        {"bus": "b1", "lat": 34.05, "lon": -118.25, "trip": "t1"},
    ]

    first = serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700)
    second = serialize_vehicle_positions(list(rows), COLUMN_MAP, feed_timestamp=1700)

    assert first == second


def test_duplicate_entity_ids_are_refused():
    rows = [
        {"bus": "b1", "lat": 34.05, "lon": -118.25, "trip": "t1"},
        {"bus": "b1", "lat": 34.06, "lon": -118.26, "trip": "t2"},
    ]

    with pytest.raises(SerializationError) as excinfo:
        serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700)

    assert "b1" in excinfo.value.reason
```

- [ ] **Step 3: Run test to verify it fails**

Run from `api/`: `uv run pytest tests/test_gtfs_rt_serializer.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'veodyn_api.services.gtfs_rt_serializer'`

- [ ] **Step 4: Write the serializer**

Create `api/veodyn_api/services/gtfs_rt_serializer.py`:

```python
"""Query rows to GTFS-Realtime bytes.

Pure by design: no database, no HTTP, no clock. `feed_timestamp` is passed in
because the caller owns the clock, which is also what makes the validator's
freshness rules deterministically testable.

**Nothing is dropped.** The GTFS-Realtime connector on the ingest side skips a
vehicle with no position and moves on, which is right for a sampler reading a
noisy stream. It is wrong here: a publisher that drops rows emits a feed that
is quietly short, and a short feed validates clean. Every refusal below names
the row and the field so the defect is fixable rather than invisible.
"""

from typing import Any

from google.transit import gtfs_realtime_pb2

REQUIRED_FIELDS: dict[str, frozenset[str]] = {
    "vehicle_positions": frozenset({"vehicle_id", "latitude", "longitude"}),
}

# Mapped but absent means "we do not know", and protobuf scalars have no way to
# say that: an unset float reads as 0.0, which is a real bearing and a real
# speed. So an optional field is written only when a value is actually present.
_OPTIONAL_POSITION_FLOATS = ("bearing", "speed")


class SerializationError(Exception):
    """A binding or a row that cannot honestly become a feed entity."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _require_float(value: Any, field: str, entity_hint: str) -> float:
    if value is None or (isinstance(value, str) and not value.strip()):
        raise SerializationError(f"{entity_hint}: {field} is empty, and it is required")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise SerializationError(f"{entity_hint}: {field} value {value!r} is not a number") from exc


def _optional_float(value: Any) -> float | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def serialize_vehicle_positions(
    rows: list[dict[str, Any]],
    column_map: dict[str, str],
    feed_timestamp: int,
) -> bytes:
    """One VehiclePositions FeedMessage, or a SerializationError naming why not."""
    missing = sorted(REQUIRED_FIELDS["vehicle_positions"] - set(column_map))
    if missing:
        raise SerializationError(f"column_map is missing required field(s): {', '.join(missing)}")

    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.incrementality = gtfs_realtime_pb2.FeedHeader.FULL_DATASET
    message.header.timestamp = feed_timestamp

    seen: set[str] = set()
    for index, row in enumerate(rows):
        raw_id = row.get(column_map["vehicle_id"])
        if raw_id is None or str(raw_id).strip() == "":
            raise SerializationError(f"row {index}: vehicle_id is empty, and it is required")
        vehicle_id = str(raw_id)
        if vehicle_id in seen:
            raise SerializationError(f"duplicate vehicle_id {vehicle_id!r}: entity ids must be unique in a feed")
        seen.add(vehicle_id)

        hint = f"row {index} (vehicle_id {vehicle_id})"
        latitude = _require_float(row.get(column_map["latitude"]), "latitude", hint)
        longitude = _require_float(row.get(column_map["longitude"]), "longitude", hint)

        entity = message.entity.add()
        entity.id = vehicle_id
        vehicle = entity.vehicle
        vehicle.vehicle.id = vehicle_id
        vehicle.position.latitude = latitude
        vehicle.position.longitude = longitude

        for field in _OPTIONAL_POSITION_FLOATS:
            column = column_map.get(field)
            if column is None:
                continue
            value = _optional_float(row.get(column))
            if value is not None:
                setattr(vehicle.position, field, value)

        trip_column = column_map.get("trip_id")
        if trip_column is not None:
            trip_id = row.get(trip_column)
            if trip_id is not None and str(trip_id).strip():
                vehicle.trip.trip_id = str(trip_id)

        route_column = column_map.get("route_id")
        if route_column is not None:
            route_id = row.get(route_column)
            if route_id is not None and str(route_id).strip():
                vehicle.trip.route_id = str(route_id)

        timestamp_column = column_map.get("timestamp")
        if timestamp_column is not None:
            stamp = _optional_float(row.get(timestamp_column))
            if stamp is not None:
                vehicle.timestamp = int(stamp)

    # deterministic=True, because two runs over equal input must produce equal
    # bytes: the artifact digest and the validator's content-changed rule both
    # compare serialized output, and protobuf map ordering is otherwise free to
    # vary between runs.
    return message.SerializeToString(deterministic=True)
```

- [ ] **Step 5: Run test to verify it passes**

Run from `api/`: `uv run pytest tests/test_gtfs_rt_serializer.py -v`
Expected: PASS, 8 tests

- [ ] **Step 6: Register the module, format, lint, commit**

Add `"services/gtfs_rt_serializer.py"` to `retained` in `api/tests/ce_module_allowlist.json`.

```bash
cd api && uv run ruff format . && uv run ruff check . && uv run mypy veodyn_api && uv run pytest tests/test_gtfs_rt_serializer.py tests/test_ce_has_no_ee_code.py -q
git add api/veodyn_api/services/gtfs_rt_serializer.py api/tests/test_gtfs_rt_serializer.py api/tests/ce_module_allowlist.json api/pyproject.toml api/uv.lock
git commit -m "feat(api): serialize query rows into GTFS-Realtime VehiclePositions"
```

---

### Task 3: Bind-time validation of a column map

**Files:**
- Create: `api/veodyn_api/services/feed_binding_checks.py`
- Modify: `api/tests/ce_module_allowlist.json`
- Test: `api/tests/test_feed_binding_checks.py`

**Interfaces:**
- Consumes: `REQUIRED_FIELDS` from Task 2 (`veodyn_api.services.gtfs_rt_serializer`).
- Produces:
  - `@dataclass(frozen=True) class BindingCheck` with fields `state: str` (`"ok"` | `"unvalidated"` | `"invalid"`) and `problems: tuple[str, ...]`.
  - `check_column_map(entity: str, column_map: dict[str, str], result_columns: tuple[str, ...]) -> BindingCheck`

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_feed_binding_checks.py`:

```python
"""Whether a binding can be trusted to produce a feed, checked when it is saved."""

from veodyn_api.services.feed_binding_checks import check_column_map

COLUMNS = ("bus", "lat", "lon", "trip")


def test_a_complete_map_over_known_columns_is_ok():
    check = check_column_map(
        "vehicle_positions",
        {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"},
        COLUMNS,
    )

    assert check.state == "ok"
    assert check.problems == ()


def test_a_missing_required_field_is_invalid():
    check = check_column_map("vehicle_positions", {"vehicle_id": "bus"}, COLUMNS)

    assert check.state == "invalid"
    assert any("latitude" in problem for problem in check.problems)
    assert any("longitude" in problem for problem in check.problems)


def test_a_column_the_query_does_not_return_is_invalid():
    check = check_column_map(
        "vehicle_positions",
        {"vehicle_id": "bus", "latitude": "lat", "longitude": "nope"},
        COLUMNS,
    )

    assert check.state == "invalid"
    assert any("nope" in problem for problem in check.problems)


def test_an_unknown_entity_is_invalid():
    check = check_column_map("trip_updates", {"vehicle_id": "bus"}, COLUMNS)

    assert check.state == "invalid"
    assert any("trip_updates" in problem for problem in check.problems)


def test_no_known_columns_means_unvalidated_not_invalid():
    """`query_result_columns` returns () for "could not find out", never for
    "it has none", so a never-run query must not be called broken. It saves
    and cannot publish until a result proves the map."""
    check = check_column_map(
        "vehicle_positions",
        {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"},
        (),
    )

    assert check.state == "unvalidated"
    assert check.problems == ()


def test_a_structurally_broken_map_is_invalid_even_with_no_columns():
    """Missing a required field needs no result to prove: it is wrong on its
    own terms, and deferring it would let a hopeless binding sit as pending."""
    check = check_column_map("vehicle_positions", {"vehicle_id": "bus"}, ())

    assert check.state == "invalid"
```

- [ ] **Step 2: Run test to verify it fails**

Run from `api/`: `uv run pytest tests/test_feed_binding_checks.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'veodyn_api.services.feed_binding_checks'`

- [ ] **Step 3: Write the checks**

Create `api/veodyn_api/services/feed_binding_checks.py`:

```python
"""Is this binding capable of producing a feed at all?

The cheapest gate in the system, and the one that catches most operator error:
it runs when a binding is saved, long before any bytes are produced.

Pure. The caller supplies the query's known column names, because discovering
them costs a whole result body (see `ai_grounding.query_result_columns`) and
that economy is the caller's to make.
"""

from dataclasses import dataclass

from veodyn_api.services.gtfs_rt_serializer import REQUIRED_FIELDS


@dataclass(frozen=True)
class BindingCheck:
    """`ok` may publish, `invalid` never may, `unvalidated` may not yet.

    The three-way split exists because "we could not read the query's columns"
    and "the query does not have those columns" are different facts, and
    treating the first as the second would refuse a binding for a query that
    has simply never run.
    """

    state: str
    problems: tuple[str, ...]


def check_column_map(
    entity: str,
    column_map: dict[str, str],
    result_columns: tuple[str, ...],
) -> BindingCheck:
    """Structure first, then the mapping against real columns."""
    required = REQUIRED_FIELDS.get(entity)
    if required is None:
        supported = ", ".join(sorted(REQUIRED_FIELDS))
        return BindingCheck("invalid", (f"entity {entity!r} is not supported (have: {supported})",))

    problems: list[str] = []

    missing = sorted(required - set(column_map))
    problems.extend(f"required field {field!r} is not mapped" for field in missing)

    # Structural problems are decided without any knowledge of the query, so a
    # hopeless binding is refused now rather than parked as pending forever.
    if problems:
        return BindingCheck("invalid", tuple(problems))

    if not result_columns:
        return BindingCheck("unvalidated", ())

    known = set(result_columns)
    unknown = sorted({column for column in column_map.values() if column not in known})
    problems.extend(f"column {column!r} is not returned by the query" for column in unknown)

    if problems:
        return BindingCheck("invalid", tuple(problems))
    return BindingCheck("ok", ())
```

- [ ] **Step 4: Run test to verify it passes**

Run from `api/`: `uv run pytest tests/test_feed_binding_checks.py -v`
Expected: PASS, 6 tests

- [ ] **Step 5: Register the module, format, lint, commit**

Add `"services/feed_binding_checks.py"` to `retained` in `api/tests/ce_module_allowlist.json`.

```bash
cd api && uv run ruff format . && uv run ruff check . && uv run mypy veodyn_api && uv run pytest tests/test_feed_binding_checks.py tests/test_ce_has_no_ee_code.py -q
git add api/veodyn_api/services/feed_binding_checks.py api/tests/test_feed_binding_checks.py api/tests/ce_module_allowlist.json
git commit -m "feat(api): check a feed binding's column map when it is saved"
```

---

### Task 4: Validator client and the normalized result schema

**Files:**
- Create: `api/veodyn_api/services/feed_validator.py`
- Modify: `api/veodyn_api/settings.py` (add `feed_validator_url`)
- Modify: `api/tests/ce_module_allowlist.json`
- Test: `api/tests/test_feed_validator.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `@dataclass(frozen=True) class Finding` with fields `rule_id: str`, `severity: str`, `title: str`, `locator: str`.
  - `@dataclass(frozen=True) class ValidationOutcome` with fields `findings: tuple[Finding, ...]`, `enabled_rules: tuple[str, ...]`; property `errors -> tuple[Finding, ...]`; property `has_error -> bool`.
  - `class ValidatorUnavailable(Exception)`
  - `normalize_report(report: list[dict]) -> tuple[Finding, ...]`
  - `validate_feed(client: httpx.Client, base_url: str, feed_bytes: bytes, static_gtfs_ref: str, previous_feed: bytes | None) -> ValidationOutcome`

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_feed_validator.py`:

```python
"""The validator boundary: its report shape in, one result schema out."""

import httpx
import pytest

from veodyn_api.services.feed_validator import (
    ValidatorUnavailable,
    normalize_report,
    validate_feed,
)

# The shape the MobilityData batch validator actually emits, measured
# 2026-08-13 against constructed fixtures. A finding is a rule plus a list of
# occurrences whose only locator is a free-text, rule-specific prefix.
REPORT = [
    {
        "errorMessage": {
            "validationRule": {
                "errorId": "E003",
                "severity": "ERROR",
                "title": "GTFS-rt trip_id does not exist in GTFS data",
                "errorDescription": "All trip_ids must exist in the GTFS data",
                "occurrenceSuffix": "does not exist in the GTFS data",
            }
        },
        "occurrenceList": [{"prefix": "vehicle_id bus-2 trip_id GHOST"}],
    },
    {
        "errorMessage": {
            "validationRule": {
                "errorId": "W009",
                "severity": "WARNING",
                "title": "schedule_relationship not populated",
                "errorDescription": "should be populated",
                "occurrenceSuffix": "does not have a schedule_relationship",
            }
        },
        "occurrenceList": [{"prefix": "trip_id t1"}, {"prefix": "trip_id t2"}],
    },
]


def test_each_occurrence_becomes_its_own_finding():
    findings = normalize_report(REPORT)

    assert len(findings) == 3
    assert findings[0].rule_id == "E003"
    assert findings[0].severity == "ERROR"
    assert findings[0].locator == "vehicle_id bus-2 trip_id GHOST"
    assert [f.rule_id for f in findings[1:]] == ["W009", "W009"]


def test_an_empty_report_is_no_findings():
    assert normalize_report([]) == ()


def test_a_rule_with_no_occurrences_is_dropped():
    """A rule that fired against nothing has nothing to report."""
    assert normalize_report([{"errorMessage": {"validationRule": {"errorId": "E1", "severity": "ERROR"}}, "occurrenceList": []}]) == ()


def test_outcome_separates_errors_from_warnings():
    outcome = _outcome_for(REPORT)

    assert outcome.has_error is True
    assert [f.rule_id for f in outcome.errors] == ["E003"]


def test_a_warning_only_report_does_not_block():
    outcome = _outcome_for([REPORT[1]])

    assert outcome.has_error is False


def _outcome_for(report):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"report": report, "enabledRules": ["E003", "W009"]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        return validate_feed(
            client,
            "http://validator:8080",
            feed_bytes=b"\x00",
            static_gtfs_ref="https://example.org/gtfs.zip",
            previous_feed=None,
        )


def test_a_validator_error_status_fails_closed():
    """An absent verdict must never read as a pass."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValidatorUnavailable):
            validate_feed(client, "http://validator:8080", b"\x00", "https://example.org/gtfs.zip", None)


def test_a_transport_failure_fails_closed():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValidatorUnavailable):
            validate_feed(client, "http://validator:8080", b"\x00", "https://example.org/gtfs.zip", None)


def test_malformed_json_fails_closed():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not json")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValidatorUnavailable):
            validate_feed(client, "http://validator:8080", b"\x00", "https://example.org/gtfs.zip", None)


def test_the_previous_feed_is_sent_when_there_is_one():
    """Iteration rules (E017/E018) need the previous artifact, and batch mode
    would otherwise compare against whatever file sorted before it."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content
        return httpx.Response(200, json={"report": [], "enabledRules": []})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        validate_feed(client, "http://validator:8080", b"\x01", "https://example.org/gtfs.zip", b"\x02")

    assert b"previous" in seen["body"]
```

- [ ] **Step 2: Run test to verify it fails**

Run from `api/`: `uv run pytest tests/test_feed_validator.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'veodyn_api.services.feed_validator'`

- [ ] **Step 3: Write the client**

Create `api/veodyn_api/services/feed_validator.py`:

```python
"""The boundary to the integrated GTFS-Realtime validator.

We do not write conformance rules. MobilityData's validator is the rule set
(Apache 2.0), it runs as a container, and this module is the only thing that
knows its report shape.

**Findings carry no structured entity reference.** Measured 2026-08-13: a
finding is a rule plus occurrences whose only locator is a free-text,
rule-specific prefix, like `vehicle_id bus-2 trip_id GHOST` or
`trip_id t2 stop_sequence [2, 1]`. Rendering is prefix + suffix, which is
fine; mapping one back to a source row would need a regex per rule and is not
something this design asks for.

**Every failure here is closed, never absent.** A timeout, a 500 or a body
that will not parse raises rather than returning an empty finding list,
because an empty list is indistinguishable from a clean feed and would publish
unvalidated bytes.
"""

from dataclasses import dataclass

import httpx


class ValidatorUnavailable(Exception):
    """The validator did not return a verdict. Never treat as a pass."""


@dataclass(frozen=True)
class Finding:
    rule_id: str
    severity: str
    title: str
    # Free text, straight from the validator. See the module docstring.
    locator: str


@dataclass(frozen=True)
class ValidationOutcome:
    findings: tuple[Finding, ...]
    # Which rules the validator was configured to run. Recorded so a green
    # verdict states what it actually covered: a rule that never ran is not a
    # rule that passed.
    enabled_rules: tuple[str, ...]

    @property
    def errors(self) -> tuple[Finding, ...]:
        return tuple(finding for finding in self.findings if finding.severity == "ERROR")

    @property
    def has_error(self) -> bool:
        return any(finding.severity == "ERROR" for finding in self.findings)


def normalize_report(report: list[dict]) -> tuple[Finding, ...]:
    """The validator's nested rule-and-occurrences shape, flattened one per occurrence."""
    findings: list[Finding] = []
    for item in report:
        rule = (item.get("errorMessage") or {}).get("validationRule") or {}
        rule_id = rule.get("errorId")
        if not rule_id:
            continue
        severity = rule.get("severity", "ERROR")
        title = rule.get("title", "")
        for occurrence in item.get("occurrenceList") or []:
            findings.append(
                Finding(
                    rule_id=rule_id,
                    severity=severity,
                    title=title,
                    locator=occurrence.get("prefix", ""),
                )
            )
    return tuple(findings)


def validate_feed(
    client: httpx.Client,
    base_url: str,
    feed_bytes: bytes,
    static_gtfs_ref: str,
    previous_feed: bytes | None,
) -> ValidationOutcome:
    """One feed against one schedule. Raises ValidatorUnavailable rather than guessing."""
    files: dict[str, tuple[str, bytes, str]] = {
        "feed": ("feed.pb", feed_bytes, "application/octet-stream"),
    }
    if previous_feed is not None:
        # Supplied explicitly because batch mode's previous-iteration rules
        # otherwise compare against whatever file sorted before this one, which
        # in a mixed directory is a different entity type entirely.
        files["previous"] = ("previous.pb", previous_feed, "application/octet-stream")

    try:
        response = client.post(
            f"{base_url.rstrip('/')}/validate",
            files=files,
            data={"gtfs": static_gtfs_ref},
            timeout=60.0,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ValidatorUnavailable(f"validator did not return a verdict: {exc}") from exc

    return ValidationOutcome(
        findings=normalize_report(payload.get("report") or []),
        enabled_rules=tuple(payload.get("enabledRules") or []),
    )
```

- [ ] **Step 4: Add the setting**

In `api/veodyn_api/settings.py`, add a field to the `Settings` class beside the other service URLs, matching the file's existing style for optional URLs:

```python
    # The containerized MobilityData GTFS-Realtime validator. Empty means no
    # validator is configured, and a publish attempt then fails closed rather
    # than publishing unvalidated bytes.
    feed_validator_url: str = ""
```

- [ ] **Step 5: Run test to verify it passes**

Run from `api/`: `uv run pytest tests/test_feed_validator.py -v`
Expected: PASS, 9 tests

- [ ] **Step 6: Register the module, format, lint, commit**

Add `"services/feed_validator.py"` to `retained` in `api/tests/ce_module_allowlist.json`.

```bash
cd api && uv run ruff format . && uv run ruff check . && uv run mypy veodyn_api && uv run pytest tests/test_feed_validator.py tests/test_ce_has_no_ee_code.py -q
git add api/veodyn_api/services/feed_validator.py api/veodyn_api/settings.py api/tests/test_feed_validator.py api/tests/ce_module_allowlist.json
git commit -m "feat(api): normalize the integrated validator's report into one result schema"
```

---

### Task 5: The publish attempt engine and its artifact

**Files:**
- Create: `api/veodyn_api/models/publish_attempt.py`
- Create: `api/veodyn_api/services/publish_engine.py`
- Create: `api/migrations/versions/0012_publish_attempt.py`
- Modify: `api/migrations/ownership.py` (add `publish_attempt` to `CE_TABLES`)
- Modify: `api/tests/ce_module_allowlist.json`
- Test: `api/tests/test_publish_engine.py`

**Interfaces:**
- Consumes: `PublishedFeed` (Task 1); `serialize_vehicle_positions`, `SerializationError` (Task 2); `validate_feed`, `ValidationOutcome`, `ValidatorUnavailable`, `Finding` (Task 4).
- Produces:
  - `PublishAttempt` ORM model, table `publish_attempt`, PK `(org_slug, slug, attempt_id)`.
  - `@dataclass(frozen=True) class AttemptResult` with fields `decision: str` (`"published"` | `"blocked"` | `"failed"`), `reason: str`, `findings: tuple[Finding, ...]`.
  - `run_attempt(db, feed, rows, query_result_id, feed_timestamp, validate) -> AttemptResult`, where `validate` is a callable `(bytes, str, bytes | None) -> ValidationOutcome` so the engine never owns an HTTP client.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_publish_engine.py`:

```python
"""One publish attempt: serialize, validate, decide, record."""

import pytest

from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.feed_validator import Finding, ValidationOutcome, ValidatorUnavailable
from veodyn_api.services.publish_engine import run_attempt

ROWS = [{"bus": "b1", "lat": 34.05, "lon": -118.25}]
CLEAN = ValidationOutcome(findings=(), enabled_rules=("E003",))
ERRORED = ValidationOutcome(
    findings=(Finding("E003", "ERROR", "trip_id does not exist", "vehicle_id b1 trip_id GHOST"),),
    enabled_rules=("E003",),
)
WARNED = ValidationOutcome(
    findings=(Finding("W009", "WARNING", "schedule_relationship not populated", "trip_id t1"),),
    enabled_rules=("W009",),
)


def _feed(db, **overrides):
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
    feed = PublishedFeed(**fields)
    db.add(feed)
    db.commit()
    return feed


def test_a_clean_feed_publishes(db):
    feed = _feed(db)

    result = run_attempt(db, feed, ROWS, query_result_id=100, feed_timestamp=1700,
                         validate=lambda *_: CLEAN)

    assert result.decision == "published"
    assert result.findings == ()


def test_an_error_blocks(db):
    feed = _feed(db)

    result = run_attempt(db, feed, ROWS, query_result_id=100, feed_timestamp=1700,
                         validate=lambda *_: ERRORED)

    assert result.decision == "blocked"
    assert result.findings[0].rule_id == "E003"


def test_warnings_alone_publish(db):
    feed = _feed(db)

    result = run_attempt(db, feed, ROWS, query_result_id=100, feed_timestamp=1700,
                         validate=lambda *_: WARNED)

    assert result.decision == "published"
    assert result.findings[0].severity == "WARNING"


def test_a_validator_outage_fails_and_does_not_publish(db):
    """Fail closed: an absent verdict is not a pass."""
    feed = _feed(db)

    def unavailable(*_):
        raise ValidatorUnavailable("refused")

    result = run_attempt(db, feed, ROWS, query_result_id=100, feed_timestamp=1700,
                         validate=unavailable)

    assert result.decision == "failed"
    assert "refused" in result.reason


def test_a_serialization_failure_never_reaches_the_validator(db):
    feed = _feed(db)
    called = []

    def spy(*args):
        called.append(args)
        return CLEAN

    result = run_attempt(db, feed, [{"bus": "b1", "lat": None, "lon": -118.25}],
                         query_result_id=100, feed_timestamp=1700, validate=spy)

    assert result.decision == "failed"
    assert called == []


def test_an_older_result_never_regresses_the_pointer(db):
    """Attempts can finish out of order; the endpoint must not go backwards."""
    feed = _feed(db)
    run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1700, validate=lambda *_: CLEAN)

    result = run_attempt(db, feed, ROWS, query_result_id=100, feed_timestamp=1600,
                         validate=lambda *_: CLEAN)

    assert result.decision == "failed"
    assert "older" in result.reason
    assert current_published(db, feed).query_result_id == 200


def test_the_previous_published_feed_is_offered_to_the_validator(db):
    feed = _feed(db)
    run_attempt(db, feed, ROWS, query_result_id=100, feed_timestamp=1700, validate=lambda *_: CLEAN)
    seen = {}

    def spy(feed_bytes, static_ref, previous):
        seen["previous"] = previous
        return CLEAN

    run_attempt(db, feed, ROWS, query_result_id=200, feed_timestamp=1800, validate=spy)

    assert seen["previous"] is not None


def test_a_blocked_attempt_is_recorded_with_its_findings(db):
    feed = _feed(db)

    run_attempt(db, feed, ROWS, query_result_id=100, feed_timestamp=1700, validate=lambda *_: ERRORED)

    from veodyn_api.models.publish_attempt import PublishAttempt

    stored = db.query(PublishAttempt).one()
    assert stored.decision == "blocked"
    assert stored.findings[0]["ruleId"] == "E003"
    assert stored.enabled_rules == ["E003"]


def current_published(db, feed):
    from veodyn_api.services.publish_engine import current_artifact

    return current_artifact(db, feed)
```

- [ ] **Step 2: Run test to verify it fails**

Run from `api/`: `uv run pytest tests/test_publish_engine.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'veodyn_api.models.publish_attempt'`

- [ ] **Step 3: Write the artifact model**

Create `api/veodyn_api/models/publish_attempt.py`:

```python
"""One publish attempt and, when it succeeded, the bytes it produced.

Identity is (binding revision, query_result_id), which is what makes an
artifact traceable to both the mapping that produced it and the data it came
from. A binding edit bumps the revision, so an artifact produced under the old
mapping can never be mistaken for a current one.

`is_current` is the published pointer. Exactly one row per feed may carry it,
enforced by a partial unique index rather than by application care.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Index, Integer, LargeBinary, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base


class PublishAttempt(Base):
    __tablename__ = "publish_attempt"
    __table_args__ = (
        Index(
            "uq_publish_attempt_current",
            "org_slug",
            "slug",
            unique=True,
            postgresql_where=Boolean("is_current"),
        ),
    )

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    slug: Mapped[str] = mapped_column(Text, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    binding_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    query_result_id: Mapped[int] = mapped_column(Integer, nullable=False)

    # published | blocked | failed
    decision: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Null unless the attempt published: blocked and failed attempts are kept
    # for the record, but their bytes were never fit to serve.
    feed_bytes: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    feed_timestamp: Mapped[int | None] = mapped_column(Integer, nullable=True)

    findings: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    # A green verdict has to state what it covered: a rule that never ran is
    # not a rule that passed.
    enabled_rules: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)

    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
```

- [ ] **Step 4: Write the migration**

Create `api/migrations/versions/0012_publish_attempt.py`:

```python
"""publish_attempt table

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "publish_attempt",
        sa.Column("org_slug", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("attempt_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("binding_revision", sa.Integer(), nullable=False),
        sa.Column("query_result_id", sa.Integer(), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("feed_bytes", sa.LargeBinary(), nullable=True),
        sa.Column("feed_timestamp", sa.Integer(), nullable=True),
        sa.Column("findings", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("enabled_rules", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("org_slug", "slug", "attempt_id"),
        sa.CheckConstraint("decision IN ('published', 'blocked', 'failed')", name="ck_publish_attempt_decision"),
        # Bytes exist if and only if the attempt published. A blocked attempt
        # holding servable bytes is one mistake away from being served.
        sa.CheckConstraint(
            "(decision = 'published') = (feed_bytes IS NOT NULL)",
            name="ck_publish_attempt_bytes_match_decision",
        ),
    )
    # One current artifact per feed, enforced by the database rather than by
    # every writer remembering to clear the old one first.
    op.create_index(
        "uq_publish_attempt_current",
        "publish_attempt",
        ["org_slug", "slug"],
        unique=True,
        postgresql_where=sa.text("is_current"),
    )


def downgrade() -> None:
    op.drop_index("uq_publish_attempt_current", table_name="publish_attempt")
    op.drop_table("publish_attempt")
```

- [ ] **Step 5: Write the engine**

Create `api/veodyn_api/services/publish_engine.py`:

```python
"""One publish attempt, start to finish.

Takes `validate` as a callable rather than building an HTTP client, so the
engine has no network of its own and a test can drive every branch without
one. The caller owns the clock too: `feed_timestamp` is passed in, which is
what makes the validator's freshness rules deterministic.

Order matters and is not incidental. Serialization runs first, so a mapping
defect is named before any bytes reach a validator that would report it as
some downstream rule. Then validation. Then, and only for a clean verdict, the
pointer moves.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.feed_validator import Finding, ValidationOutcome, ValidatorUnavailable
from veodyn_api.services.gtfs_rt_serializer import SerializationError, serialize_vehicle_positions

# Deliberately not a registry lookup yet: one entity is supported, and a
# dispatch table over a single entry hides that fact.
_SUPPORTED_ENTITY = "vehicle_positions"


@dataclass(frozen=True)
class AttemptResult:
    decision: str
    reason: str
    findings: tuple[Finding, ...]


def current_artifact(db: Session, feed: PublishedFeed) -> PublishAttempt | None:
    """The artifact the endpoint is serving, or None before the first publish."""
    return db.execute(
        select(PublishAttempt).where(
            PublishAttempt.org_slug == feed.org_slug,
            PublishAttempt.slug == feed.slug,
            PublishAttempt.is_current.is_(True),
        )
    ).scalar_one_or_none()


def _record(
    db: Session,
    feed: PublishedFeed,
    query_result_id: int,
    decision: str,
    reason: str,
    findings: tuple[Finding, ...],
    outcome: ValidationOutcome | None,
    feed_bytes: bytes | None,
    feed_timestamp: int | None,
) -> AttemptResult:
    db.add(
        PublishAttempt(
            org_slug=feed.org_slug,
            slug=feed.slug,
            binding_revision=feed.revision,
            query_result_id=query_result_id,
            decision=decision,
            reason=reason,
            feed_bytes=feed_bytes,
            feed_timestamp=feed_timestamp,
            findings=[
                {
                    "ruleId": finding.rule_id,
                    "severity": finding.severity,
                    "title": finding.title,
                    "locator": finding.locator,
                }
                for finding in findings
            ],
            enabled_rules=list(outcome.enabled_rules) if outcome else [],
            is_current=decision == "published",
        )
    )
    db.commit()
    return AttemptResult(decision=decision, reason=reason, findings=findings)


def run_attempt(
    db: Session,
    feed: PublishedFeed,
    rows: list[dict],
    query_result_id: int,
    feed_timestamp: int,
    validate,
) -> AttemptResult:
    """Serialize, validate, decide, record. Never raises for an expected failure."""
    if feed.entity != _SUPPORTED_ENTITY:
        return _record(db, feed, query_result_id, "failed",
                       f"entity {feed.entity!r} is not supported yet", (), None, None, None)

    previous = current_artifact(db, feed)
    if previous is not None and previous.query_result_id >= query_result_id:
        # Attempts can finish out of order. Serving an older result than the
        # one already published is a regression the endpoint must never make.
        return _record(db, feed, query_result_id, "failed",
                       f"query result {query_result_id} is older than the published "
                       f"{previous.query_result_id}", (), None, None, None)

    try:
        feed_bytes = serialize_vehicle_positions(rows, feed.column_map, feed_timestamp)
    except SerializationError as exc:
        return _record(db, feed, query_result_id, "failed", exc.reason, (), None, None, None)

    try:
        outcome = validate(feed_bytes, feed.static_gtfs_ref, previous.feed_bytes if previous else None)
    except ValidatorUnavailable as exc:
        return _record(db, feed, query_result_id, "failed", str(exc), (), None, None, None)

    if outcome.has_error:
        return _record(db, feed, query_result_id, "blocked",
                       f"{len(outcome.errors)} conformance error(s)", outcome.findings, outcome, None, None)

    if previous is not None:
        # Cleared before the new row is added, because one current artifact per
        # feed is a unique index and two would be a constraint violation, not a
        # silently doubled pointer.
        previous.is_current = False
        db.flush()

    return _record(db, feed, query_result_id, "published", "", outcome.findings, outcome,
                   feed_bytes, feed_timestamp)
```

- [ ] **Step 6: Register the tables and modules**

In `api/migrations/ownership.py`, add `"publish_attempt"` to `CE_TABLES` (which Task 1 already extended with `"published_feed"`).

Add `"models/publish_attempt.py"` and `"services/publish_engine.py"` to `retained` in `api/tests/ce_module_allowlist.json`.

- [ ] **Step 7: Run tests**

Run from `api/`: `uv run pytest tests/test_publish_engine.py tests/test_migration_allowlists.py tests/test_ce_has_no_ee_code.py -v`
Expected: PASS, 8 engine tests

- [ ] **Step 8: Format, lint, commit**

```bash
cd api && uv run ruff format . && uv run ruff check . && uv run mypy veodyn_api
git add api/veodyn_api/models/publish_attempt.py api/veodyn_api/services/publish_engine.py api/migrations/versions/0012_publish_attempt.py api/migrations/ownership.py api/tests/ce_module_allowlist.json api/tests/test_publish_engine.py
git commit -m "feat(api): run and record one publish attempt"
```

---

### Task 6: Binding CRUD endpoints

**Files:**
- Create: `api/veodyn_api/schemas/published_feed.py`
- Create: `api/veodyn_api/routers/published_feeds.py`
- Modify: `api/veodyn_api/routers/__init__.py`
- Modify: `api/veodyn_api/errors.py` (append `ErrorId` members)
- Modify: `api/tests/ce_module_allowlist.json`
- Test: `api/tests/test_published_feeds_route.py`

**Interfaces:**
- Consumes: `PublishedFeed` (Task 1); `check_column_map`, `BindingCheck` (Task 3); `query_result_columns` from `veodyn_api.services.ai_grounding`.
- Produces: `router` at prefix `/published-feeds`, registered in `routers/__init__.py`. Response model `PublishedFeedOut`.

**A decision this task owns, surfaced by the checkpoint-2 review.**

Bumping `revision` on edit is not bookkeeping, it changes what the served feed
means, and the engine and the router have to agree about it.

The engine now scopes the staleness guard and the previous-feed hand-off to one
revision, so an artifact built under the old mapping can neither satisfy the
guard nor be compared against as a previous iteration. What it deliberately does
**not** do is decide whether the old artifact keeps being *served* while the new
revision has not published yet. That is this task's call, because this task
performs the edit:

- **Keep serving it.** Continuity, and it matches `block`'s stated behaviour of
  continuing to serve the last valid artifact. But between the edit and the next
  successful attempt, the endpoint serves bytes that nothing validated against
  the binding's current shape, which is the thing `published_feed.py`'s own
  docstring says must not happen.
- **Clear the pointer on edit.** The feed goes dark until it revalidates, which
  is honest and is what that docstring implies, but a careless edit takes a live
  regional feed down.

Pick one, implement it, and write the reason into the handler. Do not leave it
implicit: whichever is chosen, the other reading is what a future reader will
assume.

- [ ] **Step 1: Append the error causes**

In `api/veodyn_api/errors.py`, append to the `ErrorId` enum (never renumber existing members):

```python
    PUBLISHED_FEED_NOT_FOUND = "VEODYN_PUBLISHED_FEED_NOT_FOUND"
    PUBLISHED_FEED_SLUG_TAKEN = "VEODYN_PUBLISHED_FEED_SLUG_TAKEN"
    # The column map cannot produce this entity. Its own cause rather than
    # INVALID_REQUEST, because the frontend renders the per-field problems.
    PUBLISHED_FEED_BINDING_INVALID = "VEODYN_PUBLISHED_FEED_BINDING_INVALID"
```

- [ ] **Step 2: Write the failing test**

Create `api/tests/test_published_feeds_route.py`:

```python
"""The binding endpoints: creating, listing, and refusing.

Authorization is the assertion several of these make from different angles: a
published feed is an anonymous read surface over query results, so creating one
is admin-only, unlike the cadence expectations on the feed board next door.
"""

from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.conftest import REDASH_TEST_URL, session_payload

REDASH = REDASH_TEST_URL

ADMIN = session_payload(user_id=7, name="Ada Admin", permissions=["admin"])
MEMBER = session_payload(user_id=9, name="Mo Member", permissions=["execute_query"])

BODY: dict[str, Any] = {
    "slug": "vehicles",
    "queryId": 42,
    "standard": "gtfs-rt",
    "version": "2.0",
    "entity": "vehicle_positions",
    "staticGtfsRef": "https://example.org/gtfs.zip",
    "columnMap": {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"},
    "onError": "block",
    "visibility": "private",
}


def as_user(payload: dict[str, Any]) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(200, json=payload))


# One cookie value per identity, never shared: require_identity caches the
# resolved session against the credential, so reusing a cookie hands the second
# person the first person's identity and the test passes for the wrong reason.
def auth(cookie: str = "ada") -> dict[str, str]:
    return {"cookie": f"session={cookie}"}


@pytest.fixture
def columns(monkeypatch: pytest.MonkeyPatch):
    """Stand in for the whole-result-body read that discovers a query's columns."""

    def _set(values: tuple[str, ...]) -> None:
        monkeypatch.setattr(
            "veodyn_api.routers.published_feeds.query_result_columns",
            lambda *args, **kwargs: values,
        )

    return _set


@pytest.fixture(autouse=True)
def _mock_redash() -> Iterator[None]:
    with respx.mock(assert_all_called=False):
        yield


def test_creating_a_binding_returns_it(api: TestClient, columns) -> None:
    as_user(ADMIN)
    columns(("bus", "lat", "lon"))

    response = api.post("/published-feeds", json=BODY, headers=auth())

    assert response.status_code == 201
    body = response.json()
    assert body["slug"] == "vehicles"
    assert body["bindingState"] == "ok"
    assert body["revision"] == 1


def test_a_non_admin_may_not_publish(api: TestClient, columns) -> None:
    as_user(MEMBER)
    columns(("bus", "lat", "lon"))

    response = api.post("/published-feeds", json=BODY, headers=auth("mo"))

    assert response.status_code == 403
    assert response.json()["error"]["id"] == "VEODYN_FORBIDDEN"


def test_a_map_naming_an_absent_column_is_refused(api: TestClient, columns) -> None:
    as_user(ADMIN)
    columns(("bus", "lat"))

    response = api.post("/published-feeds", json=BODY, headers=auth())

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["id"] == "VEODYN_PUBLISHED_FEED_BINDING_INVALID"
    # The offending column is named in the message, because ApiError carries no
    # structured extra and a refusal nobody can act on is barely a refusal.
    assert "lon" in body["error"]["message"]


def test_a_never_run_query_saves_as_unvalidated(api: TestClient, columns) -> None:
    """() means "could not find out", so the binding is pending, not broken."""
    as_user(ADMIN)
    columns(())

    response = api.post("/published-feeds", json=BODY, headers=auth())

    assert response.status_code == 201
    assert response.json()["bindingState"] == "unvalidated"


def test_a_structurally_broken_map_is_refused_even_unvalidated(api: TestClient, columns) -> None:
    as_user(ADMIN)
    columns(())

    response = api.post(
        "/published-feeds", json={**BODY, "columnMap": {"vehicle_id": "bus"}}, headers=auth()
    )

    assert response.status_code == 422


def test_a_duplicate_slug_is_refused(api: TestClient, columns) -> None:
    as_user(ADMIN)
    columns(("bus", "lat", "lon"))
    api.post("/published-feeds", json=BODY, headers=auth())

    response = api.post("/published-feeds", json=BODY, headers=auth())

    assert response.status_code == 409
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_SLUG_TAKEN"


def test_last_good_without_a_cap_is_refused(api: TestClient, columns) -> None:
    as_user(ADMIN)
    columns(("bus", "lat", "lon"))

    response = api.post("/published-feeds", json={**BODY, "onError": "last_good"}, headers=auth())

    assert response.status_code == 422


def test_editing_the_column_map_bumps_the_revision(api: TestClient, columns) -> None:
    as_user(ADMIN)
    columns(("bus", "lat", "lon", "heading"))
    api.post("/published-feeds", json=BODY, headers=auth())

    response = api.put(
        "/published-feeds/vehicles",
        json={**BODY, "columnMap": {**BODY["columnMap"], "bearing": "heading"}},
        headers=auth(),
    )

    assert response.status_code == 200
    assert response.json()["revision"] == 2


def test_listing_returns_the_org_bindings(api: TestClient, columns) -> None:
    as_user(ADMIN)
    columns(("bus", "lat", "lon"))
    api.post("/published-feeds", json=BODY, headers=auth())

    response = api.get("/published-feeds", headers=auth())

    assert response.status_code == 200
    assert [item["slug"] for item in response.json()] == ["vehicles"]


def test_an_unknown_slug_is_not_found(api: TestClient) -> None:
    as_user(ADMIN)

    response = api.get("/published-feeds/nope", headers=auth())

    assert response.status_code == 404
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_NOT_FOUND"
```

The `columns` fixture is local to this file rather than in `conftest.py`: it patches a name only this router imports, and a shared fixture with one consumer is indirection with no payoff.

- [ ] **Step 3: Run test to verify it fails**

Run from `api/`: `uv run pytest tests/test_published_feeds_route.py -v`
Expected: FAIL, 404 on every route

- [ ] **Step 4: Write the schemas**

Create `api/veodyn_api/schemas/published_feed.py`:

```python
"""Wire models for the published-feed binding endpoints.

camelCase on the wire, snake_case in Python, the same rule as schemas/catalog.py.
Changing a field here obliges `pnpm gen:api-types` from `app/`, or the openapi
diff fails the pipeline.
"""

from typing import Literal

from pydantic import Field, model_validator

from veodyn_api.schemas.catalog import CamelModel


class PublishedFeedIn(CamelModel):
    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    query_id: int
    standard: Literal["gtfs-rt"]
    version: str = Field(min_length=1)
    entity: Literal["vehicle_positions"]
    static_gtfs_ref: str = Field(min_length=1)
    source_column: str | None = None
    column_map: dict[str, str]
    on_error: Literal["block", "last_good"] = "block"
    last_good_max_age_seconds: int | None = Field(default=None, gt=0)
    visibility: Literal["private", "public"] = "private"

    @model_validator(mode="after")
    def _cap_matches_mode(self) -> "PublishedFeedIn":
        """Refused here as well as by the check constraint, so the caller gets a
        422 naming the field rather than a 500 from a constraint violation."""
        has_cap = self.last_good_max_age_seconds is not None
        if (self.on_error == "last_good") != has_cap:
            raise ValueError("last_good requires last_good_max_age_seconds, and block forbids it")
        return self


class PublishedFeedOut(CamelModel):
    slug: str
    revision: int
    query_id: int
    standard: str
    version: str
    entity: str
    static_gtfs_ref: str
    source_column: str | None
    column_map: dict[str, str]
    on_error: str
    last_good_max_age_seconds: int | None
    visibility: str
    # ok | unvalidated | invalid. Derived on read from the binding check, not
    # stored: a query gaining or losing a column changes this answer without
    # anything writing to the binding.
    binding_state: str
```

- [ ] **Step 5: Write the router**

Create `api/veodyn_api/routers/published_feeds.py`:

```python
"""Declaring that a query publishes a standard feed.

Authorization is deliberately NOT the catalog's or the feed board's. Setting a
cadence expectation is open to any org member because it changes neither data
nor permissions; creating a published feed does both, so it takes an admin.
The binding is checked when it is saved, which is the cheapest gate there is:
discovering the mapping is wrong at publish time costs an attempt and a stored
failure, and discovering it here costs one call.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from veodyn_api.auth import Identity, get_redash_client, require_identity
from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.schemas.published_feed import PublishedFeedIn, PublishedFeedOut
from veodyn_api.services.ai_grounding import query_result_columns
from veodyn_api.services.feed_binding_checks import check_column_map
from veodyn_api.services.redash import RedashClient
from veodyn_api.settings import Settings, get_settings

router = APIRouter(prefix="/published-feeds", tags=["published-feeds"])

IdentityDep = Annotated[Identity, Depends(require_identity)]
DbDep = Annotated[Session, Depends(get_db)]
RedashDep = Annotated[RedashClient, Depends(get_redash_client)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _require_admin(identity: Identity) -> None:
    """Guarded in the handler, because there is no `require_admin` dependency.

    A published feed is an anonymous read surface over query results, so
    creating one changes both data exposure and permissions. That is the line
    between this and the cadence expectations next door, which any org member
    may set precisely because they change neither.
    """
    if not identity.is_admin:
        raise ApiError(
            ErrorId.FORBIDDEN,
            "publishing a feed requires an administrator",
            status_code=status.HTTP_403_FORBIDDEN,
        )


def _out(feed: PublishedFeed, binding_state: str) -> PublishedFeedOut:
    return PublishedFeedOut(
        slug=feed.slug,
        revision=feed.revision,
        query_id=feed.query_id,
        standard=feed.standard,
        version=feed.version,
        entity=feed.entity,
        static_gtfs_ref=feed.static_gtfs_ref,
        source_column=feed.source_column,
        column_map=feed.column_map,
        on_error=feed.on_error,
        last_good_max_age_seconds=feed.last_good_max_age_seconds,
        visibility=feed.visibility,
        binding_state=binding_state,
    )


def _check(redash: RedashClient, settings: Settings, body: PublishedFeedIn) -> str:
    # The service key, not the caller's: _require_admin has already proven this
    # caller may publish, and the column read is metadata about a query the
    # binding names rather than a row of its data.
    columns = query_result_columns(redash, body.query_id, settings.redash_service_api_key)
    check = check_column_map(body.entity, body.column_map, columns)
    if check.state == "invalid":
        # ApiError carries no structured extra, so the problems go in the
        # message. A refusal nobody can act on is barely a refusal.
        raise ApiError(
            ErrorId.PUBLISHED_FEED_BINDING_INVALID,
            "the column map cannot produce this feed: " + "; ".join(check.problems),
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    return check.state


@router.get("", response_model=list[PublishedFeedOut])
def list_feeds(identity: IdentityDep, db: DbDep) -> list[PublishedFeedOut]:
    rows = db.execute(
        select(PublishedFeed).where(PublishedFeed.org_slug == identity.org_slug).order_by(PublishedFeed.slug)
    ).scalars()
    # Not re-checked per row: listing is a glance, and a check costs a whole
    # result body per binding.
    return [_out(row, "ok") for row in rows]


@router.post("", response_model=PublishedFeedOut, status_code=status.HTTP_201_CREATED)
def create_feed(
    identity: IdentityDep, db: DbDep, redash: RedashDep, settings: SettingsDep, body: PublishedFeedIn
) -> PublishedFeedOut:
    _require_admin(identity)
    existing = db.get(PublishedFeed, (identity.org_slug, body.slug))
    if existing is not None:
        raise ApiError(
            ErrorId.PUBLISHED_FEED_SLUG_TAKEN,
            f"a feed is already published at {body.slug!r}",
            status_code=status.HTTP_409_CONFLICT,
        )

    state = _check(redash, settings, body)
    feed = PublishedFeed(
        org_slug=identity.org_slug,
        slug=body.slug,
        revision=1,
        query_id=body.query_id,
        standard=body.standard,
        version=body.version,
        entity=body.entity,
        static_gtfs_ref=body.static_gtfs_ref,
        source_column=body.source_column,
        column_map=body.column_map,
        on_error=body.on_error,
        last_good_max_age_seconds=body.last_good_max_age_seconds,
        visibility=body.visibility,
        created_by_user_id=identity.user_id,
    )
    db.add(feed)
    db.commit()
    return _out(feed, state)


@router.get("/{slug}", response_model=PublishedFeedOut)
def get_feed(identity: IdentityDep, db: DbDep, slug: str) -> PublishedFeedOut:
    feed = db.get(PublishedFeed, (identity.org_slug, slug))
    if feed is None:
        raise ApiError(
            ErrorId.PUBLISHED_FEED_NOT_FOUND,
            f"no feed published at {slug!r}",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return _out(feed, "ok")


@router.put("/{slug}", response_model=PublishedFeedOut)
def update_feed(
    identity: IdentityDep, db: DbDep, redash: RedashDep, settings: SettingsDep, slug: str, body: PublishedFeedIn
) -> PublishedFeedOut:
    _require_admin(identity)
    feed = db.get(PublishedFeed, (identity.org_slug, slug))
    if feed is None:
        raise ApiError(
            ErrorId.PUBLISHED_FEED_NOT_FOUND,
            f"no feed published at {slug!r}",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    state = _check(redash, settings, body)
    feed.query_id = body.query_id
    feed.version = body.version
    feed.entity = body.entity
    feed.static_gtfs_ref = body.static_gtfs_ref
    feed.source_column = body.source_column
    feed.column_map = body.column_map
    feed.on_error = body.on_error
    feed.last_good_max_age_seconds = body.last_good_max_age_seconds
    feed.visibility = body.visibility
    # Every edit above changes what an artifact was produced against, so the
    # revision moves and no existing artifact can be mistaken for current.
    feed.revision += 1
    db.commit()
    return _out(feed, state)


@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feed(identity: IdentityDep, db: DbDep, slug: str) -> Response:
    _require_admin(identity)
    feed = db.get(PublishedFeed, (identity.org_slug, slug))
    if feed is not None:
        db.delete(feed)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

Every name above was verified against the tree on 2026-08-13. If any of them has since moved, keep the behavior rather than the spelling: admin-only writes, the binding checked before it is stored, and the offending columns named in the refusal.

- [ ] **Step 6: Register the router**

In `api/veodyn_api/routers/__init__.py`, add the import beside the others and the name to the tuple, in one edit (an import added without its use fails `F401`):

```python
from veodyn_api.routers.published_feeds import router as published_feeds_router
```

and add `published_feeds_router,` to the `for _router in (...)` tuple, keeping alphabetical order.

- [ ] **Step 7: Run tests**

Run from `api/`: `uv run pytest tests/test_published_feeds_route.py -v`
Expected: PASS, 8 tests

- [ ] **Step 8: Regenerate types, format, lint, commit**

```bash
cd api && uv run ruff format . && uv run ruff check . && uv run mypy veodyn_api && uv run pytest -q
cd ../app && pnpm gen:api-types
cd .. && git add api/veodyn_api/routers/published_feeds.py api/veodyn_api/schemas/published_feed.py api/veodyn_api/routers/__init__.py api/veodyn_api/errors.py api/tests/ce_module_allowlist.json api/tests/test_published_feeds_route.py api/tests/conftest.py api/openapi.json app/src/types/generated
git commit -m "feat(api): bind a query to a published GTFS-Realtime feed"
```

---

## What P1 deliberately does not build

Both are named in the spec and neither belongs in this tree:

- **The polling worker.** `veodyn_api.worker` ships in the enterprise pack, and `api/README.md:30` states a community deployment runs no worker. `run_attempt` is a plain function precisely so the pack can drive it without this tree owning a queue.
- **The public serving endpoint.** `veodyn_api.routers.public` is already in the enterprise allowlist, so the anonymous read surface follows that precedent rather than opening a second one here.

`last_good` is stored and constrained but has no behavior yet, because behavior belongs to the serving endpoint. The constraint exists now so no binding can be created that the serving endpoint would later have to guess about.

## Task dependency order

Tasks 1, 2, 3 and 4 share no code and can be built in parallel. Task 3 imports `REQUIRED_FIELDS` from Task 2, so it needs Task 2's module to exist but not to be correct beyond that constant. Task 5 needs 1, 2 and 4. Task 6 needs 1 and 3.

```
1 ─┐
2 ─┼─> 5
4 ─┘
1 ─┐
3 ─┴─> 6
```

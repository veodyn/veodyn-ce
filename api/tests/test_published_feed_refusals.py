"""Every way a binding write is refused, and what the refusal costs.

Split out of `test_published_feeds_route.py` (which keeps the contract: what
creating, reading, editing and deleting a binding return) because the refusals
outgrew it, and because they share one claim worth stating once: a refused write
must leave the stored binding untouched. The serving half of that claim -- that a
refusal also leaves the SERVED artifact alone -- is asserted in
`test_published_feed_serving.py`, where the pointer lives.

`@respx.mock` per test rather than an autouse fixture, for the reason
`tag_stubs.py` gives: the decorator wraps the test function, so a fixture would
register its routes on a different router and the session call would escape to
the network.
"""

from typing import Any

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from tests.published_feed_route_stubs import (
    ADMIN,
    BODY,
    BOUND_COLUMNS,
    ORG,
    REBOUND,
    REBOUND_COLUMNS,
    as_user,
    auth,
    binding,
    create,
    query_is_unreadable,
    set_columns,
)
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.schemas.published_feed import PG_INT_MAX


def refusal(api: TestClient, db: Session, body: dict[str, Any], status: int, error_id: str) -> dict[str, Any]:
    """Create with `body`, assert how it was refused, and assert nothing landed.

    The last part is the reason this helper exists rather than each test writing
    two lines: a refusal that still writes the row is the failure mode all of
    these are here to catch, and it is the assertion easiest to forget.
    """
    response = create(api, body)
    assert response.status_code == status
    payload: dict[str, Any] = response.json()
    assert payload["error"]["id"] == error_id
    assert db.get(PublishedFeed, (ORG, body["slug"])) is None
    return payload


@respx.mock
def test_a_map_naming_an_absent_column_is_refused(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, ("bus", "lat"))

    payload = refusal(api, db, BODY, 422, "VEODYN_PUBLISHED_FEED_BINDING_INVALID")

    # The offending column is named in the message, because ApiError carries no
    # structured extra and a refusal nobody can act on is barely a refusal.
    assert "lon" in payload["error"]["message"]


@respx.mock
def test_a_structurally_broken_map_is_refused_even_unvalidated(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Missing a required field needs no result to prove it wrong, so it is
    refused now rather than parked as pending forever."""
    as_user(ADMIN)
    set_columns(monkeypatch, ())

    refusal(api, db, {**BODY, "columnMap": {"vehicle_id": "bus"}}, 422, "VEODYN_PUBLISHED_FEED_BINDING_INVALID")


@respx.mock
def test_a_query_nobody_can_read_is_refused_rather_than_saved_unvalidated(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The distinction the router's existence check exists to make.

    `query_result_columns` answers `()` for a missing query exactly as it does
    for a query that has never run, and `()` is `unvalidated`. Without a separate
    readability read, a typoed `queryId` is accepted with a green-ish state.
    """
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    query_is_unreadable(404)

    payload = refusal(api, db, BODY, 422, "VEODYN_PUBLISHED_FEED_QUERY_UNREADABLE")

    assert "42" in payload["error"]["message"]


@respx.mock
def test_a_query_the_service_may_not_see_is_refused_too(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """403 and 404 are one cause from this side: the binding names a query this
    service cannot build a feed on. Failing closed is the whole point, since the
    permissive reading publishes an anonymous read surface over it."""
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    query_is_unreadable(403)

    refusal(api, db, BODY, 422, "VEODYN_PUBLISHED_FEED_QUERY_UNREADABLE")


@respx.mock
def test_redash_being_down_is_not_a_verdict_about_the_binding(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A 5xx says nothing about whether the query exists, so it keeps its own
    503 rather than being reported as a bad binding. Nothing is written either
    way, which is the property that matters: the old code turned this same blip
    into a 200 that took a live feed dark."""
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    query_is_unreadable(503)

    refusal(api, db, BODY, 503, "VEODYN_REDASH_UNREACHABLE")


@respx.mock
def test_a_version_this_service_does_not_publish_is_refused(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The serializer writes `gtfs_realtime_version = "2.0"` unconditionally, so
    any other value stored here is a binding claiming a version its own bytes
    contradict."""
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)

    payload = refusal(api, db, {**BODY, "version": "1.0"}, 422, "VEODYN_INVALID_REQUEST")

    assert "version" in payload["error"]["message"]


@respx.mock
def test_a_query_id_outside_postgres_integer_is_a_422_not_a_500(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Unbounded, this passes request validation and fails inside psycopg at
    COMMIT, as a 500 naming no field at all."""
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)

    payload = refusal(api, db, {**BODY, "queryId": PG_INT_MAX + 1}, 422, "VEODYN_INVALID_REQUEST")

    assert "queryId" in payload["error"]["message"]


@respx.mock
def test_a_last_good_cap_outside_postgres_integer_is_a_422_not_a_500(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    oversized = {**BODY, "onError": "last_good", "lastGoodMaxAgeSeconds": PG_INT_MAX + 1}

    payload = refusal(api, db, oversized, 422, "VEODYN_INVALID_REQUEST")

    assert "lastGoodMaxAgeSeconds" in payload["error"]["message"]


@respx.mock
def test_last_good_without_a_cap_is_refused(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """The check constraint would refuse this as a 500; the model makes it a 422."""
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)

    refusal(api, db, {**BODY, "onError": "last_good"}, 422, "VEODYN_INVALID_REQUEST")


@respx.mock
def test_block_may_not_carry_a_cap(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """A cap on `block` is an uncapped `last_good` wearing the wrong name."""
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)

    refusal(api, db, {**BODY, "onError": "block", "lastGoodMaxAgeSeconds": 60}, 422, "VEODYN_INVALID_REQUEST")


@respx.mock
def test_an_edit_whose_body_names_a_different_feed_is_refused(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The path selects the row and the body's slug used to be validated and then
    ignored, so a body naming `alerts` edited `vehicles` and returned 200."""
    as_user(ADMIN)
    set_columns(monkeypatch, REBOUND_COLUMNS)
    assert create(api).status_code == 201

    response = api.put("/published-feeds/vehicles", json={**REBOUND, "slug": "alerts"}, headers=auth())

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_INVALID_REQUEST"
    assert "alerts" in response.json()["error"]["message"]
    # The feed the path named is untouched: not rebound, not bumped.
    assert binding(db).revision == 1
    assert binding(db).column_map == BODY["columnMap"]


@respx.mock
def test_losing_the_create_race_is_a_409_not_a_500(
    api: TestClient, db: Session, engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two external Redash reads sit between the "is this slug free" check and the
    INSERT, so both requests can pass the check and only one can hold the key.

    The rival commits from its OWN session, which is what makes this the real
    race rather than a re-entrant flush: the loser's `db.rollback()` must not be
    able to undo it, or the recovery path would find nothing and re-raise.
    """
    as_user(ADMIN)
    rival = sessionmaker(bind=engine, expire_on_commit=False)()

    def _columns(*args: Any, **kwargs: Any) -> tuple[str, ...]:
        # Called after the slug check and before the INSERT. Exactly the window.
        if not rival.get(PublishedFeed, (ORG, "vehicles")):
            rival.add(
                PublishedFeed(
                    org_slug=ORG,
                    slug="vehicles",
                    revision=1,
                    query_id=42,
                    standard="gtfs-rt",
                    version="2.0",
                    entity="vehicle_positions",
                    static_gtfs_ref=BODY["staticGtfsRef"],
                    column_map=BODY["columnMap"],
                    on_error="block",
                    visibility="private",
                    created_by_user_id=99,
                )
            )
            rival.commit()
        return BOUND_COLUMNS

    set_columns(monkeypatch, BOUND_COLUMNS)
    monkeypatch.setattr("veodyn_api.routers.published_feeds.query_result_columns", _columns)

    response = create(api)

    assert response.status_code == 409
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_SLUG_TAKEN"
    # The winner's row is the one that survives, and there is exactly one.
    assert db.query(PublishedFeed).count() == 1
    assert binding(db).created_by_user_id == 99
    rival.close()

"""The binding endpoints: creating, reading, editing, deleting, and refusing.

Authorization is the assertion several of these make from different angles: a
published feed is an anonymous read surface over query results, so writing one
is admin-only, unlike the cadence expectations on the feed board next door.

What an edit does to the artifact the endpoint is already serving is the other
half of this router's contract, and it lives in
`test_published_feed_serving.py`.

`@respx.mock` per test rather than an autouse fixture, for the reason
`tag_stubs.py` gives: the decorator wraps the test function, so a fixture would
register its routes on a different router and the session call would escape to
the network.
"""

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.published_feed_route_stubs import (
    ADMIN,
    BODY,
    BOUND_COLUMNS,
    MEMBER,
    ORG,
    OTHER_ADMIN,
    OTHER_ORG,
    REBOUND,
    REBOUND_COLUMNS,
    as_user,
    auth,
    binding,
    create,
    record_column_reads,
    set_columns,
)
from veodyn_api.models.published_feed import PublishedFeed


@respx.mock
def test_the_column_read_runs_as_the_service_not_the_caller(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """_require_admin has already proven this caller may publish, and the read is
    metadata about a query the binding names rather than a row of its data. The
    caller's own cookie is deliberately not forwarded to it."""
    as_user(ADMIN)
    calls = record_column_reads(monkeypatch, BOUND_COLUMNS)

    assert create(api).status_code == 201

    assert [args[1:] for args in calls] == [(42, "service-key")]


@respx.mock
def test_creating_a_binding_returns_it(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)

    response = create(api)

    assert response.status_code == 201
    body = response.json()
    assert body["slug"] == "vehicles"
    assert body["bindingState"] == "ok"
    assert body["revision"] == 1
    assert body["columnMap"] == BODY["columnMap"]


@respx.mock
def test_a_non_admin_may_not_publish(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(MEMBER)
    set_columns(monkeypatch, BOUND_COLUMNS)

    response = api.post("/published-feeds", json=BODY, headers=auth("mo"))

    assert response.status_code == 403
    assert response.json()["error"]["id"] == "VEODYN_FORBIDDEN"
    assert db.get(PublishedFeed, (ORG, "vehicles")) is None


@respx.mock
def test_a_non_admin_may_not_edit_or_delete(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """The guard is on every write, not only on the one that creates a feed."""
    as_user(ADMIN)
    set_columns(monkeypatch, REBOUND_COLUMNS)
    assert create(api).status_code == 201

    as_user(MEMBER)
    assert api.put("/published-feeds/vehicles", json=REBOUND, headers=auth("mo")).status_code == 403
    assert api.delete("/published-feeds/vehicles", headers=auth("mo")).status_code == 403
    assert binding(db).revision == 1


@respx.mock
def test_a_never_run_query_saves_as_unvalidated(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """The query is READABLE and has simply never run, which is the legitimate
    case `()` was always meant to describe. It still saves as pending, and it is
    the reason the existence check had to be a separate read rather than a
    stricter reading of `()`.
    """
    as_user(ADMIN)
    set_columns(monkeypatch, ())

    response = create(api)

    assert response.status_code == 201
    assert response.json()["bindingState"] == "unvalidated"


@respx.mock
def test_a_duplicate_slug_is_refused(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api).status_code == 201

    response = create(api)

    assert response.status_code == 409
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_SLUG_TAKEN"


@respx.mock
def test_editing_the_column_map_bumps_the_revision(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, REBOUND_COLUMNS)
    assert create(api).status_code == 201

    response = api.put("/published-feeds/vehicles", json=REBOUND, headers=auth())

    assert response.status_code == 200
    assert response.json()["revision"] == 2
    assert response.json()["columnMap"] == REBOUND["columnMap"]


@respx.mock
def test_listing_returns_the_org_bindings(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """A second tenant's binding is created for real and must not be listed.

    Without it this test could not fail: every row it made belonged to the
    caller's org, so deleting the router's `org_slug` predicate outright still
    left the same two slugs in the same order. A cross-tenant leak needs a row on
    the other side of the boundary to leak.

    `bo` rather than `ada` as the cookie, and never both on one value:
    `require_identity` caches the resolved session against the credential alone,
    so a shared cookie would hand Bo Ada's identity and put all three bindings in
    one org, which is the shape that made the old assertion vacuous.
    """
    as_user(OTHER_ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert api.post("/published-feeds", json={**BODY, "slug": "trams"}, headers=auth("bo")).status_code == 201
    assert db.get(PublishedFeed, (OTHER_ORG, "trams")) is not None

    as_user(ADMIN)
    assert create(api).status_code == 201
    assert create(api, {**BODY, "slug": "alerts"}).status_code == 201

    response = api.get("/published-feeds", headers=auth())

    assert response.status_code == 200
    # Sorted by slug, so a board does not reorder itself between reads. `trams`
    # sorts last, so a leak would show up as a third entry rather than as a
    # reordering this assertion could confuse for one.
    assert [item["slug"] for item in response.json()] == ["alerts", "vehicles"]
    # And the other tenant sees only its own, so the predicate is not merely
    # excluding a hardcoded org.
    assert [item["slug"] for item in api.get("/published-feeds", headers=auth("bo")).json()] == ["trams"]


@respx.mock
def test_a_read_does_not_claim_a_binding_is_ok(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """The read paths do not run the check, so they must not report its verdict.

    Reporting `ok` here would put a green tick on a binding whose query may have
    lost the column since, which is the one answer worse than no answer.
    """
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api).status_code == 201

    assert api.get("/published-feeds/vehicles", headers=auth()).json()["bindingState"] == "unknown"
    assert api.get("/published-feeds", headers=auth()).json()[0]["bindingState"] == "unknown"


@respx.mock
def test_getting_a_binding_returns_it(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api).status_code == 201

    response = api.get("/published-feeds/vehicles", headers=auth())

    assert response.status_code == 200
    assert response.json()["queryId"] == 42
    assert response.json()["staticGtfsRef"] == BODY["staticGtfsRef"]


@respx.mock
def test_an_unknown_slug_is_not_found(api: TestClient) -> None:
    as_user(ADMIN)

    response = api.get("/published-feeds/nope", headers=auth())

    assert response.status_code == 404
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_NOT_FOUND"


@respx.mock
def test_deleting_a_binding_removes_it(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api).status_code == 201

    assert api.delete("/published-feeds/vehicles", headers=auth()).status_code == 204

    assert db.get(PublishedFeed, (ORG, "vehicles")) is None
    assert api.get("/published-feeds/vehicles", headers=auth()).status_code == 404

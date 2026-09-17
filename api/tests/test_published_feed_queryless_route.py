from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from typing import Any

import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.published_feed_route_stubs import (
    ADMIN,
    ORG,
    as_user,
    auth,
    binding,
    query_is_readable,
    query_is_unreadable,
)
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services import publish_produce, published_feed_registry
from veodyn_api.services.publish_produce import Needs, Produced, Production

BULLETINS = "bulletins"

BODY: dict[str, Any] = {
    "slug": "bulletins",
    "standard": "gtfs-rt",
    "version": "2.0",
    "entity": BULLETINS,
    "staticGtfsRef": "https://example.org/gtfs.zip",
    "columnMap": {},
    "onError": "block",
    "visibility": "private",
}


def _never_runs(production: Production) -> Produced:
    raise AssertionError("registered to be asked what it needs, never to run")


@contextmanager
def a_fabricated_entity_no_community_build_ships(needs: Needs) -> Iterator[None]:
    with published_feed_registry.restored_entities(), publish_produce.restored_producers():
        published_feed_registry.register_entity(BULLETINS, "gtfs-rt")
        publish_produce.register_producer("gtfs-rt", BULLETINS, _never_runs, needs)
        yield


def bulletins() -> AbstractContextManager[None]:
    return a_fabricated_entity_no_community_build_ships(Needs(query=False, static_reference=True, column_map=False))


def bulletins_from_a_query() -> AbstractContextManager[None]:
    """A producer that reads a query result but maps no spec field to a column
    of it: the combination `_check` used to answer "ok" for before it had proven
    the query is there at all."""
    return a_fabricated_entity_no_community_build_ships(Needs(static_reference=True, column_map=False))


@respx.mock
def test_a_binding_with_no_query_is_created_and_reads_back_as_null(api: TestClient, db: Session) -> None:
    as_user(ADMIN)

    with bulletins():
        response = api.post("/published-feeds", json=BODY, headers=auth())

    assert response.status_code == 201
    assert response.json()["queryId"] is None
    stored = db.get(PublishedFeed, (ORG, "bulletins"))
    assert stored is not None
    assert stored.query_id is None


@respx.mock
def test_a_binding_with_no_query_is_refused_for_an_entity_that_needs_one(api: TestClient) -> None:
    as_user(ADMIN)

    response = api.post(
        "/published-feeds",
        json={**BODY, "slug": "vehicles", "entity": "vehicle_positions", "columnMap": {"vehicle_id": "bus"}},
        headers=auth(),
    )

    assert response.status_code == 422
    assert "needs a query" in response.json()["error"]["message"]


@respx.mock
def test_retire_on_failure_survives_a_get_handed_straight_back_to_the_put(api: TestClient, db: Session) -> None:
    as_user(ADMIN)

    with bulletins():
        created = api.post("/published-feeds", json={**BODY, "retireOnFailure": True}, headers=auth())
        assert created.status_code == 201
        assert created.json()["retireOnFailure"] is True

        handed_back = api.get("/published-feeds/bulletins", headers=auth())
        assert handed_back.json()["retireOnFailure"] is True

        sent_back = api.put("/published-feeds/bulletins", json=handed_back.json(), headers=auth())
        assert sent_back.status_code == 200

    assert binding(db, "bulletins").retire_on_failure is True


@respx.mock
def test_retire_on_failure_is_off_when_the_binding_does_not_ask(api: TestClient, db: Session) -> None:
    as_user(ADMIN)

    with bulletins():
        assert api.post("/published-feeds", json=BODY, headers=auth()).status_code == 201

    assert binding(db, "bulletins").retire_on_failure is False


@respx.mock
def test_a_producer_that_needs_no_query_refuses_a_binding_naming_one(api: TestClient, db: Session) -> None:
    as_user(ADMIN)
    query_is_readable(query_id=9)

    with bulletins():
        response = api.post("/published-feeds", json={**BODY, "queryId": 9}, headers=auth())

    assert response.status_code == 422
    assert "cannot name one" in response.json()["error"]["message"]
    assert db.get(PublishedFeed, (ORG, "bulletins")) is None


@respx.mock
def test_an_unreadable_query_is_refused_even_when_no_column_is_mapped(api: TestClient, db: Session) -> None:
    as_user(ADMIN)
    query_is_unreadable(query_id=9)

    with bulletins_from_a_query():
        response = api.post("/published-feeds", json={**BODY, "queryId": 9}, headers=auth())

    assert response.status_code == 422
    assert "does not exist or this service cannot read it" in response.json()["error"]["message"]
    assert db.get(PublishedFeed, (ORG, "bulletins")) is None


@respx.mock
def test_a_readable_query_behind_an_unmapped_producer_is_accepted(api: TestClient, db: Session) -> None:
    as_user(ADMIN)
    query_is_readable(query_id=9)

    with bulletins_from_a_query():
        response = api.post("/published-feeds", json={**BODY, "queryId": 9}, headers=auth())

    assert response.status_code == 201
    assert response.json()["bindingState"] == "ok"
    assert binding(db, "bulletins").query_id == 9

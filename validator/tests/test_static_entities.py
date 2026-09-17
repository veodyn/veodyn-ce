from __future__ import annotations

from functools import partial
from typing import Any

import httpx
import respx
from fastapi.testclient import TestClient

from tests.fixtures import (
    entity_archive_bytes,
    entity_archive_with_generated_stops_bytes,
    entity_archive_without_a_table_bytes,
)
from validator_service.cache import PreparedFeedCache
from validator_service.dependencies import get_entity_cache
from validator_service.entities import EntityIndex
from validator_service.entity_archive import fetch_entity_index
from validator_service.main import create_app
from validator_service.settings import Settings

GTFS_URL = "https://example.org/gtfs.zip"


def _client(
    *,
    timeout: float = 5.0,
    max_compressed_bytes: int = 200_000_000,
    max_uncompressed_bytes: int = 4_000_000_000,
    ttl_seconds: float = 60.0,
) -> TestClient:
    app = create_app(
        Settings(cache_size=1, cache_ttl_seconds=60.0, static_archive_max_compressed_bytes=max_compressed_bytes)
    )
    cache = PreparedFeedCache[EntityIndex](
        partial(
            fetch_entity_index,
            timeout=timeout,
            max_bytes=max_compressed_bytes,
            max_uncompressed_bytes=max_uncompressed_bytes,
        ),
        max_size=1,
        ttl_seconds=ttl_seconds,
    )
    app.dependency_overrides[get_entity_cache] = lambda: cache
    return TestClient(app)


def _serve(payload: bytes) -> None:
    respx.get(GTFS_URL).mock(return_value=httpx.Response(200, content=payload))


def _get(client: TestClient, **params: Any) -> httpx.Response:
    return client.get("/static-entities", params={"gtfs": GTFS_URL, **params})


@respx.mock
def test_routes_come_back_as_id_and_joined_label_with_the_feed_version() -> None:
    _serve(entity_archive_bytes())

    response = _get(_client(), kind="route")

    assert response.status_code == 200
    assert response.json() == {
        "feedVersion": "2026-08-01",
        "entities": [
            {"kind": "route", "id": "9", "label": "9 Elm Street"},
            {"kind": "route", "id": "10", "label": "Riverside Loop"},
            {"kind": "route", "id": "11", "label": "11"},
            {"kind": "route", "id": "12", "label": "12"},
        ],
    }


@respx.mock
def test_stops_agencies_and_trips_each_answer_their_own_kind() -> None:
    _serve(entity_archive_bytes())
    client = _client()

    stops = _get(client, kind="stop").json()["entities"]
    agencies = _get(client, kind="agency").json()["entities"]
    trips = _get(client, kind="trip").json()["entities"]

    assert [entity["id"] for entity in stops] == ["s2", "s1", "elm-3", "s4", "s5"]
    assert agencies == [
        {"kind": "agency", "id": "a1", "label": "Elmwood Transit"},
        {"kind": "agency", "id": "a2", "label": "a2"},
    ]
    assert trips == [
        {"kind": "trip", "id": "t1", "label": "Elmwood"},
        {"kind": "trip", "id": "t2", "label": "t2"},
    ]


@respx.mock
def test_archive_without_feed_info_answers_with_an_empty_feed_version() -> None:
    _serve(entity_archive_without_a_table_bytes("feed_info.txt"))

    response = _get(_client(), kind="route")

    assert response.status_code == 200
    assert response.json()["feedVersion"] == ""
    assert response.json()["entities"]


@respx.mock
def test_missing_table_answers_with_no_entities_rather_than_an_error() -> None:
    _serve(entity_archive_without_a_table_bytes("trips.txt"))

    response = _get(_client(), kind="trip")

    assert response.status_code == 200
    assert response.json() == {"feedVersion": "2026-08-01", "entities": []}


@respx.mock
def test_q_filters_case_insensitively_over_id_and_label() -> None:
    _serve(entity_archive_bytes())

    response = _get(_client(), kind="stop", q="RIVERSIDE")

    assert [entity["id"] for entity in response.json()["entities"]] == ["elm-3", "s4"]


@respx.mock
def test_q_orders_a_starts_with_match_before_a_contains_match() -> None:
    _serve(entity_archive_bytes())

    response = _get(_client(), kind="stop", q="elm")

    assert [entity["id"] for entity in response.json()["entities"]] == ["s1", "elm-3", "s2"]


@respx.mock
def test_limit_below_one_is_clamped_to_one_rather_than_rejected() -> None:
    _serve(entity_archive_bytes())

    response = _get(_client(), kind="stop", limit=0)

    assert response.status_code == 200
    assert len(response.json()["entities"]) == 1


@respx.mock
def test_limit_above_fifty_is_clamped_to_fifty_rather_than_rejected() -> None:
    _serve(entity_archive_with_generated_stops_bytes(200))

    response = _get(_client(), kind="stop", limit=1000)

    assert response.status_code == 200
    assert len(response.json()["entities"]) == 50


@respx.mock
def test_absent_limit_defaults_to_twenty() -> None:
    _serve(entity_archive_with_generated_stops_bytes(200))

    response = _get(_client(), kind="stop")

    assert len(response.json()["entities"]) == 20


@respx.mock
def test_non_integer_limit_falls_back_to_the_default_instead_of_422() -> None:
    _serve(entity_archive_with_generated_stops_bytes(200))

    response = _get(_client(), kind="stop", limit="not-a-number")

    assert response.status_code == 200
    assert len(response.json()["entities"]) == 20


@respx.mock
def test_unknown_kind_returns_400() -> None:
    _serve(entity_archive_bytes())

    response = _get(_client(), kind="shape")

    assert response.status_code == 400
    assert "kind" in response.json()["error"]


def test_absent_kind_returns_400_not_422() -> None:
    response = _client().get("/static-entities", params={"gtfs": GTFS_URL})

    assert response.status_code == 400
    assert "kind" in response.json()["error"]


def test_blank_gtfs_returns_400_not_422() -> None:
    response = _client().get("/static-entities", params={"gtfs": "  ", "kind": "route"})

    assert response.status_code == 400
    assert "gtfs" in response.json()["error"]


def test_non_http_scheme_returns_400_and_is_never_fetched() -> None:
    response = _client().get("/static-entities", params={"gtfs": "file:///etc/passwd", "kind": "route"})

    assert response.status_code == 400
    assert "http" in response.json()["error"]


@respx.mock
def test_fetch_failure_returns_502() -> None:
    respx.get(GTFS_URL).mock(side_effect=httpx.ConnectError("connection refused"))

    response = _get(_client(), kind="route")

    assert response.status_code == 502
    assert GTFS_URL in response.json()["error"]


@respx.mock
def test_unparseable_archive_returns_502() -> None:
    _serve(b"this is not a zip file")

    response = _get(_client(), kind="route")

    assert response.status_code == 502
    assert response.json()["error"]


@respx.mock
def test_the_archive_is_fetched_once_and_answered_from_the_index_after_that() -> None:
    route = respx.get(GTFS_URL).mock(return_value=httpx.Response(200, content=entity_archive_bytes()))
    client = _client()

    for term in ("e", "el", "elm"):
        assert _get(client, kind="stop", q=term).status_code == 200

    assert route.call_count == 1


@respx.mock
def test_a_concurrent_build_for_the_same_url_answers_503() -> None:
    _serve(entity_archive_bytes())
    client = _client()
    cache = client.app.dependency_overrides[get_entity_cache]()  # type: ignore[attr-defined]
    cache._preparing.add(GTFS_URL)

    response = _get(client, kind="route")

    assert response.status_code == 503

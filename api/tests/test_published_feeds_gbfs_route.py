"""The binding endpoints driven with a gbfs body.

A sibling of `test_published_feeds_route.py` rather than more cases inside it:
that module is at the 300-line ceiling, and a gbfs binding needs its own body,
its own columns and no shared stub in common with the gtfs-rt one beyond the
admin identity.
"""

from typing import Any

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.published_feed_route_stubs import (
    ADMIN,
    BOUND_COLUMNS,
    as_user,
    auth,
    binding,
    set_columns,
)
from tests.published_feed_route_stubs import BODY as GTFS_RT_BODY

SYSTEM_INFO: dict[str, str] = {
    "system_id": "city",
    "language": "en",
    "name": "City Bikes",
    "timezone": "America/New_York",
}

BODY: dict[str, Any] = {
    "slug": "bikes-live",
    "queryId": 42,
    "standard": "gbfs",
    "version": "2.3",
    "entity": "stations",
    "systemInfo": SYSTEM_INFO,
    "columnMap": {
        "station_id": "sid",
        "name": "label",
        "lat": "lat",
        "lon": "lon",
        "num_vehicles_available": "bikes",
        "is_installed": "inst",
        "is_renting": "rent",
        "is_returning": "ret",
        "last_reported": "seen",
    },
    "onError": "block",
    "visibility": "private",
}

COLUMNS = ("sid", "label", "lat", "lon", "bikes", "inst", "rent", "ret", "seen")


def _create(api: TestClient, body: dict[str, Any] | None = None) -> Any:
    return api.post("/published-feeds", json=body if body is not None else BODY, headers=auth())


@respx.mock
def test_creating_a_gbfs_binding_stores_both_of_its_shape_fields(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, COLUMNS)

    response = _create(api)

    assert response.status_code == 201
    body = response.json()
    assert body["bindingState"] == "ok"
    assert body["staticGtfsRef"] is None
    assert body["systemInfo"] == SYSTEM_INFO
    stored = binding(db, "bikes-live")
    assert stored.static_gtfs_ref is None
    assert stored.system_info == SYSTEM_INFO


@respx.mock
def test_a_gbfs_binding_reads_back_with_its_system_info(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, COLUMNS)
    assert _create(api).status_code == 201

    body = api.get("/published-feeds/bikes-live", headers=auth()).json()

    assert body["standard"] == "gbfs"
    assert body["systemInfo"]["timezone"] == "America/New_York"


@respx.mock
def test_editing_a_gbfs_binding_rewrites_its_system_info(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The system declaration is part of the binding, so an edit moves it and
    bumps the revision like any other field."""
    as_user(ADMIN)
    set_columns(monkeypatch, COLUMNS)
    assert _create(api).status_code == 201

    renamed = {**SYSTEM_INFO, "name": "City Bikeshare"}
    response = api.put("/published-feeds/bikes-live", json={**BODY, "systemInfo": renamed}, headers=auth())

    assert response.status_code == 200
    assert response.json()["revision"] == 2
    assert response.json()["systemInfo"]["name"] == "City Bikeshare"
    assert binding(db, "bikes-live").system_info == renamed


@respx.mock
def test_a_gbfs_map_is_checked_against_the_gbfs_vocabulary(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """The router passes the standard through, so the map is measured against
    the serializer that will write it rather than the other one."""
    as_user(ADMIN)
    set_columns(monkeypatch, COLUMNS)

    response = _create(api, {**BODY, "columnMap": {**BODY["columnMap"], "vehicle_id": "sid"}})

    assert response.status_code == 422
    assert "vehicle_id" in response.json()["error"]["message"]


@respx.mock
def test_a_gbfs_body_carrying_a_static_ref_is_refused(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """A 422 naming the field, not the 500 the DB CHECK would give."""
    as_user(ADMIN)
    set_columns(monkeypatch, COLUMNS)

    response = _create(api, {**BODY, "staticGtfsRef": "https://example.org/gtfs.zip"})

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_INVALID_REQUEST"


@respx.mock
def test_an_edit_may_swap_the_standard(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """`standard` gates the two shape columns, so an edit that leaves it behind
    writes a row violating both CHECK constraints and 500s at commit."""
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert api.post("/published-feeds", json=GTFS_RT_BODY, headers=auth()).status_code == 201

    set_columns(monkeypatch, COLUMNS)
    response = api.put("/published-feeds/vehicles", json={**BODY, "slug": GTFS_RT_BODY["slug"]}, headers=auth())

    assert response.status_code == 200
    stored = binding(db, "vehicles")
    assert stored.standard == "gbfs"
    assert stored.static_gtfs_ref is None
    assert stored.system_info == SYSTEM_INFO

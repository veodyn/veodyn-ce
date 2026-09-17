from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.published_feed_route_stubs import (
    ADMIN,
    BODY,
    BOUND_COLUMNS,
    as_user,
    auth,
    create,
    set_columns,
)
from tests.test_published_feeds_gbfs_route import BODY as GBFS_BODY
from tests.test_published_feeds_gbfs_route import COLUMNS as GBFS_COLUMNS
from veodyn_api.settings import get_settings

VALIDATOR = "http://validator.test"

ROUTES: dict[str, Any] = {
    "feedVersion": "2026-08-01",
    "entities": [
        {"kind": "route", "id": "9", "label": "9 Elm Street"},
        {"kind": "route", "id": "14", "label": "14 Harbour"},
    ],
}

NOTHING_MATCHED: dict[str, Any] = {"feedVersion": "2026-08-01", "entities": []}

REF_A_NORMALIZER_WOULD_MANGLE = "HTTPS://Example.ORG/Transit/GTFS.zip/"


def validator_is_configured(monkeypatch: pytest.MonkeyPatch, url: str = VALIDATOR) -> None:
    monkeypatch.setenv("VEODYN_FEED_VALIDATOR_URL", url)
    get_settings.cache_clear()


def validator_answers(payload: Any, status: int = 200) -> respx.Route:
    return respx.get(f"{VALIDATOR}/static-entities").mock(return_value=httpx.Response(status, json=payload))


def a_gtfs_rt_feed(api: TestClient, monkeypatch: pytest.MonkeyPatch, static_gtfs_ref: str | None = None) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    body = BODY if static_gtfs_ref is None else {**BODY, "staticGtfsRef": static_gtfs_ref}
    assert create(api, body).status_code == 201


def a_gbfs_feed(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, GBFS_COLUMNS)
    assert api.post("/published-feeds", json=GBFS_BODY, headers=auth()).status_code == 201


def ask(api: TestClient, query: str = "?kind=route", slug: str = "vehicles", cookie: str = "ada") -> httpx.Response:
    return api.get(f"/published-feeds/{slug}/entities{query}", headers=auth(cookie))

from typing import Any

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.published_feed_entities_stubs import (
    a_gtfs_rt_feed,
    ask,
    validator_answers,
    validator_is_configured,
)

VERSIONLESS_ARCHIVE: dict[str, Any] = {
    "feedVersion": "",
    "entities": [
        {"kind": "route", "id": "9", "label": "9 Elm Street"},
        {"kind": "route", "id": "14", "label": "14 Harbour"},
    ],
}

A_TRIP_OFFERED_AS_A_ROUTE: dict[str, Any] = {
    "feedVersion": "2026-08-01",
    "entities": [{"kind": "trip", "id": "t-4471", "label": "07:12 to Harbour"}],
}

ONE_TRIP_AMONG_THE_ROUTES: dict[str, Any] = {
    "feedVersion": "2026-08-01",
    "entities": [
        {"kind": "route", "id": "9", "label": "9 Elm Street"},
        {"kind": "trip", "id": "t-4471", "label": "07:12 to Harbour"},
    ],
}


@respx.mock
def test_an_archive_carrying_no_feed_info_lists_its_routes_with_an_empty_version(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers(VERSIONLESS_ARCHIVE)

    response = ask(api)

    assert response.status_code == 200
    assert response.json() == {
        "feedVersion": "",
        "entities": [
            {"kind": "route", "id": "9", "label": "9 Elm Street"},
            {"kind": "route", "id": "14", "label": "14 Harbour"},
        ],
    }


@respx.mock
def test_a_versionless_archive_holding_nothing_matching_is_still_an_empty_list_not_a_refusal(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers({"feedVersion": "", "entities": []})

    response = ask(api, query="?kind=stop&q=nowhere")

    assert response.status_code == 200
    assert response.json() == {"feedVersion": "", "entities": []}


@respx.mock
def test_a_feed_version_that_is_not_a_string_is_still_unavailable(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers({"feedVersion": 20260801, "entities": []})

    assert ask(api).status_code == 503


@respx.mock
def test_a_listing_answering_with_another_kind_refuses_rather_than_offering_the_wrong_pick(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers(A_TRIP_OFFERED_AS_A_ROUTE)

    response = ask(api)

    assert response.status_code == 503
    message = response.json()["error"]["message"]
    assert "trip" in message
    assert "route" in message
    assert "t-4471" not in message


@respx.mock
def test_one_entry_of_the_wrong_kind_refuses_the_whole_listing(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers(ONE_TRIP_AMONG_THE_ROUTES)

    assert ask(api).status_code == 503


@respx.mock
def test_the_kind_that_was_asked_for_is_the_kind_that_comes_back(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers({"feedVersion": "2026-08-01", "entities": [{"kind": "trip", "id": "t-4471", "label": "07:12"}]})

    response = ask(api, query="?kind=trip")

    assert response.status_code == 200
    assert response.json()["entities"] == [{"kind": "trip", "id": "t-4471", "label": "07:12"}]

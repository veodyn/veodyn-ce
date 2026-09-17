import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.published_feed_entities_stubs import (
    NOTHING_MATCHED,
    REF_A_NORMALIZER_WOULD_MANGLE,
    ROUTES,
    a_gbfs_feed,
    a_gtfs_rt_feed,
    ask,
    validator_answers,
    validator_is_configured,
)
from tests.published_feed_route_stubs import MEMBER, OTHER_ADMIN, as_user


@respx.mock
def test_the_picker_lists_what_the_paired_static_dataset_holds(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    route = validator_answers(ROUTES)

    response = ask(api)

    assert response.status_code == 200
    assert response.json() == {
        "feedVersion": "2026-08-01",
        "entities": [
            {"kind": "route", "id": "9", "label": "9 Elm Street"},
            {"kind": "route", "id": "14", "label": "14 Harbour"},
        ],
    }
    sent = route.calls.last.request.url.params
    assert sent["kind"] == "route"
    assert "q" not in sent


@respx.mock
def test_a_member_who_is_not_an_admin_may_use_the_picker(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers(ROUTES)
    as_user(MEMBER)

    assert ask(api, cookie="mo").status_code == 200


@respx.mock
def test_another_orgs_slug_reads_as_not_found_rather_than_forbidden(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers(ROUTES)
    as_user(OTHER_ADMIN)

    response = ask(api, cookie="bo")

    assert response.status_code == 404
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_NOT_FOUND"


@respx.mock
def test_a_feed_paired_with_no_static_dataset_reads_as_not_found(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gbfs_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)

    response = ask(api, slug="bikes-live")

    assert response.status_code == 404
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_HAS_NO_STATIC_DATASET"


@respx.mock
def test_an_unconfigured_validator_answers_503_with_a_reason_not_an_empty_list(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)

    response = ask(api)

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["id"] == "VEODYN_PUBLISHED_FEED_ENTITY_LOOKUP_UNAVAILABLE"
    assert "validator" in body["error"]["message"].lower()
    assert "entities" not in body


@respx.mock
def test_a_validator_that_answers_502_becomes_a_503_carrying_what_it_said_went_wrong(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers({"error": "the archive at 'https://example.org/gtfs.zip' could not be fetched"}, status=502)

    response = ask(api)

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["id"] == "VEODYN_PUBLISHED_FEED_ENTITY_LOOKUP_UNAVAILABLE"
    assert "the archive at 'https://example.org/gtfs.zip' could not be fetched" in body["error"]["message"]


@respx.mock
def test_a_validator_still_building_its_index_says_so_rather_than_naming_a_status_code(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers({"error": "an entity index is already being built; retry shortly"}, status=503)

    response = ask(api)

    assert response.status_code == 503
    assert "retry shortly" in response.json()["error"]["message"]


@respx.mock
def test_a_static_dataset_holding_nothing_matching_answers_200_with_an_empty_list(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers(NOTHING_MATCHED)

    response = ask(api, query="?kind=stop&q=nowhere")

    assert response.status_code == 200
    assert response.json() == {"feedVersion": "2026-08-01", "entities": []}


@respx.mock
def test_a_listing_that_cannot_say_which_dataset_version_it_read_is_unavailable(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers({"entities": []})

    assert ask(api).status_code == 503


@respx.mock
def test_a_body_carrying_no_entities_list_is_unavailable_rather_than_empty(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers({"feedVersion": "2026-08-01"})

    assert ask(api).status_code == 503


@respx.mock
def test_the_search_text_is_forwarded_when_the_caller_typed_one(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    route = validator_answers(ROUTES)

    assert ask(api, query="?kind=route&q=elm").status_code == 200
    assert route.calls.last.request.url.params["q"] == "elm"


@respx.mock
def test_a_limit_under_the_floor_is_clamped_rather_than_refused(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    route = validator_answers(ROUTES)

    assert ask(api, query="?kind=route&limit=0").status_code == 200
    assert route.calls.last.request.url.params["limit"] == "1"


@respx.mock
def test_a_limit_over_the_ceiling_is_clamped_rather_than_refused(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    route = validator_answers(ROUTES)

    assert ask(api, query="?kind=route&limit=5000").status_code == 200
    assert route.calls.last.request.url.params["limit"] == "50"


@respx.mock
def test_an_unknown_kind_is_refused_because_there_is_no_value_to_clamp_it_to(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch)
    validator_is_configured(monkeypatch)
    validator_answers(ROUTES)

    assert ask(api, query="?kind=shape").status_code == 422


@respx.mock
def test_the_static_reference_is_forwarded_verbatim(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a_gtfs_rt_feed(api, monkeypatch, static_gtfs_ref=REF_A_NORMALIZER_WOULD_MANGLE)
    validator_is_configured(monkeypatch)
    route = validator_answers(ROUTES)

    assert ask(api).status_code == 200
    assert route.calls.last.request.url.params["gtfs"] == REF_A_NORMALIZER_WOULD_MANGLE

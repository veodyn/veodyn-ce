"""Driving one publish attempt from a request.

A community deployment runs no worker (api/README.md:30), so this endpoint is
the only thing that makes a saved binding do anything. The engine is left to
decide: these tests assert what the endpoint hands it and what it hands back,
not what publishing means.
"""

from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.publish_stubs import attempt_row
from tests.published_feed_route_stubs import (
    ADMIN,
    BOUND_COLUMNS,
    MEMBER,
    REDASH,
    as_user,
    auth,
    create,
    set_columns,
)
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.routers import published_feed_attempts
from veodyn_api.services.feed_validator import Finding, ValidationOutcome
from veodyn_api.services.publish_engine import AttemptResult


def _result(rows: list[Any], result_id: int = 500, retrieved_at: str | None = "2026-08-14T10:00:00.000Z") -> None:
    """Redash answering with a cached result for query 42.

    `retrieved_at` is a parameter because it is what the GTFS header timestamp is
    built from, and its absence is a refusal rather than a detail.
    """
    result: dict[str, Any] = {
        "id": result_id,
        "data": {"columns": [{"name": name} for name in BOUND_COLUMNS], "rows": rows},
    }
    if retrieved_at is not None:
        result["retrieved_at"] = retrieved_at
    respx.get(f"{REDASH}/api/queries/42").mock(
        return_value=httpx.Response(200, json={"id": 42, "latest_query_data_id": result_id})
    )
    respx.get(f"{REDASH}/api/query_results/{result_id}").mock(
        return_value=httpx.Response(200, json={"query_result": result})
    )


def _a_feed(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api).status_code == 201


def _validator(monkeypatch: pytest.MonkeyPatch, outcome: ValidationOutcome) -> None:
    monkeypatch.setattr(
        "veodyn_api.routers.published_feed_attempts.build_validate",
        lambda settings: lambda feed_bytes, static_ref, previous: outcome,
    )


CLEAN = ValidationOutcome(findings=(), enabled_rules=("E003",))
ERRORED = ValidationOutcome(
    findings=(Finding(rule_id="E003", severity="ERROR", title="bad id", locator="entity 0", occurrence_count=1),),
    enabled_rules=("E003",),
)


@respx.mock
def test_an_attempt_publishes_and_comes_back_as_the_current_artifact(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _a_feed(api, monkeypatch)
    _result([{"bus": "b1", "lat": 34.05, "lon": -118.25}])
    _validator(monkeypatch, CLEAN)

    response = api.post("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 201
    body = response.json()
    assert body["decision"] == "published"
    assert body["isCurrent"] is True
    assert body["queryResultId"] == 500


@respx.mock
def test_a_blocked_attempt_is_recorded_and_returned_with_its_findings(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _a_feed(api, monkeypatch)
    _result([{"bus": "b1", "lat": 34.05, "lon": -118.25}])
    _validator(monkeypatch, ERRORED)

    response = api.post("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 201
    body = response.json()
    assert body["decision"] == "blocked"
    assert body["isCurrent"] is False
    assert body["findings"][0]["ruleId"] == "E003"


@respx.mock
def test_a_query_that_has_never_run_is_refused_before_an_attempt_is_recorded(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No result means nothing to publish, which is not a failed attempt."""
    _a_feed(api, monkeypatch)
    respx.get(f"{REDASH}/api/queries/42").mock(return_value=httpx.Response(200, json={"id": 42}))

    response = api.post("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_NO_RESULT"
    assert api.get("/published-feeds/vehicles/attempts", headers=auth()).json() == []


@respx.mock
def test_a_missing_validator_fails_closed_rather_than_publishing(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No VEODYN_FEED_VALIDATOR_URL is the community default, and it must not publish."""
    _a_feed(api, monkeypatch)
    _result([{"bus": "b1", "lat": 34.05, "lon": -118.25}])

    response = api.post("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 201
    body = response.json()
    assert body["decision"] == "failed"
    assert "validator" in body["reason"].lower()
    assert body["isCurrent"] is False


@respx.mock
def test_a_result_that_will_not_say_when_it_was_retrieved_is_refused(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The alternative is a header swearing stale rows were just fetched."""
    _a_feed(api, monkeypatch)
    _result([{"bus": "b1", "lat": 34.05, "lon": -118.25}], retrieved_at=None)
    _validator(monkeypatch, CLEAN)

    response = api.post("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_NO_RESULT"
    assert api.get("/published-feeds/vehicles/attempts", headers=auth()).json() == []


@respx.mock
def test_an_unparseable_retrieved_at_is_refused_too(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _a_feed(api, monkeypatch)
    _result([{"bus": "b1", "lat": 34.05, "lon": -118.25}], retrieved_at="last Tuesday")
    _validator(monkeypatch, CLEAN)

    response = api.post("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_NO_RESULT"


@respx.mock
def test_a_result_carrying_a_row_that_is_not_an_object_is_refused_whole(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Filtering it out would publish a shorter feed that validates cleanly."""
    _a_feed(api, monkeypatch)
    _result([{"bus": "b1", "lat": 34.05, "lon": -118.25}, ["b2", 34.06, -118.26]])
    _validator(monkeypatch, CLEAN)

    response = api.post("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_NO_RESULT"
    assert api.get("/published-feeds/vehicles/attempts", headers=auth()).json() == []


@respx.mock
def test_the_response_is_this_calls_attempt_not_whatever_committed_last(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A second publish landing mid-request must not answer this one.

    The wrapper stands in for that second request: it lets the real engine run,
    then commits another attempt for the same feed, exactly as a concurrent
    publish would. Reading back "the newest row for this feed" returns that one.
    """
    _a_feed(api, monkeypatch)
    _result([{"bus": "b1", "lat": 34.05, "lon": -118.25}])
    _validator(monkeypatch, CLEAN)
    engine_run = published_feed_attempts.run_attempt

    def run_then_let_another_publish_land(
        session: Session, feed: PublishedFeed, rows: list[dict[str, Any]], **kwargs: Any
    ) -> AttemptResult:
        outcome = engine_run(session, feed, rows, **kwargs)
        session.add(attempt_row(feed, decision="failed", feed_bytes=None, is_current=False, query_result_id=900))
        session.commit()
        return outcome

    monkeypatch.setattr(published_feed_attempts, "run_attempt", run_then_let_another_publish_land)

    body = api.post("/published-feeds/vehicles/attempts", headers=auth()).json()

    assert body["queryResultId"] == 500
    assert body["decision"] == "published"


@respx.mock
def test_a_non_admin_may_not_publish(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _a_feed(api, monkeypatch)
    as_user(MEMBER)

    response = api.post("/published-feeds/vehicles/attempts", headers=auth("mo"))

    assert response.status_code == 403
    assert response.json()["error"]["id"] == "VEODYN_FORBIDDEN"


@respx.mock
def test_publishing_an_unknown_feed_is_a_404(api: TestClient) -> None:
    as_user(ADMIN)

    response = api.post("/published-feeds/nothing-here/attempts", headers=auth())

    assert response.status_code == 404

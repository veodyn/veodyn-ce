"""Reading one feed's publish record.

`@respx.mock` is a per-test decorator here for the same reason it is next door
in test_published_feeds_route.py: an autouse fixture would intercept every
call in the module, including the ones a test means to leave alone.
"""

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.publish_stubs import CLEAN, ERRORED, attempt_row, run
from tests.published_feed_route_stubs import ADMIN, BOUND_COLUMNS, MEMBER, as_user, auth, binding, create, set_columns


def _a_feed(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api).status_code == 201


@respx.mock
def test_attempts_come_back_newest_first(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _a_feed(api, db, monkeypatch)
    feed = binding(db)
    run(db, feed, CLEAN, result_id=100)
    run(db, feed, ERRORED, result_id=101)

    response = api.get("/published-feeds/vehicles/attempts", headers=auth())

    assert response.status_code == 200
    body = response.json()
    assert [row["decision"] for row in body] == ["blocked", "published"]
    assert body[0]["queryResultId"] == 101


@respx.mock
def test_the_findings_ship_with_the_attempt(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _a_feed(api, db, monkeypatch)
    run(db, binding(db), ERRORED, result_id=101)

    body = api.get("/published-feeds/vehicles/attempts", headers=auth()).json()

    assert body[0]["findings"], "a blocked attempt with no findings explains nothing"
    finding = body[0]["findings"][0]
    assert set(finding) == {"ruleId", "severity", "title", "locator", "occurrenceCount"}
    assert body[0]["enabledRules"]


@respx.mock
def test_the_served_bytes_never_ship(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """The artifact is up to a few megabytes and nothing on the page renders it."""
    _a_feed(api, db, monkeypatch)
    run(db, binding(db), CLEAN, result_id=100)

    body = api.get("/published-feeds/vehicles/attempts", headers=auth()).json()

    assert body[0]["isCurrent"] is True
    assert "feedBytes" not in body[0]


@respx.mock
def test_a_member_may_read_the_record(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """Reads are open to the org, the same line the list and get endpoints hold."""
    _a_feed(api, db, monkeypatch)
    run(db, binding(db), CLEAN, result_id=100)
    as_user(MEMBER)

    response = api.get("/published-feeds/vehicles/attempts", headers=auth("mo"))

    assert response.status_code == 200
    assert len(response.json()) == 1


@respx.mock
def test_an_unknown_slug_is_a_404_not_an_empty_list(api: TestClient) -> None:
    """A feed that was deleted and a feed with no attempts are different facts."""
    as_user(ADMIN)

    response = api.get("/published-feeds/nothing-here/attempts", headers=auth())

    assert response.status_code == 404
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_NOT_FOUND"


@respx.mock
def test_only_the_most_recent_page_comes_back(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _a_feed(api, db, monkeypatch)
    feed = binding(db)
    for result_id in range(200, 225):
        db.add(attempt_row(feed, decision="failed", feed_bytes=None, is_current=False, query_result_id=result_id))
    db.commit()

    body = api.get("/published-feeds/vehicles/attempts", headers=auth()).json()

    assert len(body) == 20
    assert body[0]["queryResultId"] == 224


@respx.mock
def test_the_served_artifact_survives_the_cap(api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """A page full of refusals must not hide what the endpoint is still handing out.

    The client derives "is this feed on the air" from this list, so an
    `is_current` row that fell off the page reads as a dark feed: it would offer
    to publish over a live artifact, and skip the going-dark warning on an edit.
    """
    _a_feed(api, db, monkeypatch)
    feed = binding(db)
    db.add(attempt_row(feed, decision="published", is_current=True, query_result_id=199))
    for result_id in range(200, 225):
        db.add(attempt_row(feed, decision="failed", feed_bytes=None, is_current=False, query_result_id=result_id))
    db.commit()

    body = api.get("/published-feeds/vehicles/attempts", headers=auth()).json()

    assert [row["queryResultId"] for row in body if row["isCurrent"]] == [199]
    # Still one newest-first sequence with the extra row folded back in.
    attempt_ids = [row["attemptId"] for row in body]
    assert attempt_ids == sorted(attempt_ids, reverse=True)
    assert body[0]["queryResultId"] == 224

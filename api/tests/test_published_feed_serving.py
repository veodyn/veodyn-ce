"""What editing or deleting a binding does to the artifact already being served.

This is the decision `routers/published_feeds.py` owns, and it is a decision
rather than a default because the engine does not make it: the served pointer is
per feed and knows nothing about revisions, so an artifact published under the
old mapping goes on being served unless something clears it. The router clears
it. Every test here exists because the opposite choice would pass every other
test in the suite.

The boundary is the point. An accepted edit and a delete take the feed off the
air; a REFUSED edit must not, or a typo in a column name becomes a way to take a
live regional feed down.
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
    REBOUND,
    REBOUND_COLUMNS,
    as_user,
    auth,
    binding,
    create,
    put_it_on_the_air,
    query_is_unreadable,
    set_columns,
)
from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.services.publish_engine import current_artifact


@respx.mock
def test_editing_a_binding_takes_the_feed_off_the_air(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """THE DECISION THIS ROUTER OWNS.

    The artifact was validated against a declaration this edit has just retired.
    Serving it on would be exactly the "bytes nothing validated in the feed's
    current shape" that `published_feed.py`'s docstring forbids, so the feed goes
    dark until an attempt republishes under the new revision.
    """
    as_user(ADMIN)
    set_columns(monkeypatch, REBOUND_COLUMNS)
    assert create(api).status_code == 201
    feed = binding(db)
    put_it_on_the_air(db, feed)
    assert current_artifact(db, feed) is not None

    assert api.put("/published-feeds/vehicles", json=REBOUND, headers=auth()).status_code == 200

    assert current_artifact(db, feed) is None


@respx.mock
def test_a_cosmetic_edit_takes_the_feed_off_the_air_too(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`visibility` does not change what the bytes are, and it clears the pointer
    anyway.

    A set of artifact-affecting fields would spare this one, and would have to be
    extended by hand every time a field lands. Forgetting to fails silently, with
    a changed feed still serving the old artifact. Clearing unconditionally is
    wrong only in the direction that announces itself.
    """
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api).status_code == 201
    feed = binding(db)
    put_it_on_the_air(db, feed)

    response = api.put("/published-feeds/vehicles", json={**BODY, "visibility": "public"}, headers=auth())

    assert response.status_code == 200
    assert current_artifact(db, feed) is None


@respx.mock
def test_the_artifact_survives_the_edit_that_stopped_serving_it(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Off the air, not erased. The attempt is the record of what this feed once
    served, and deleting it would make that history lie."""
    as_user(ADMIN)
    set_columns(monkeypatch, REBOUND_COLUMNS)
    assert create(api).status_code == 201
    feed = binding(db)
    put_it_on_the_air(db, feed)

    assert api.put("/published-feeds/vehicles", json=REBOUND, headers=auth()).status_code == 200

    stored = db.query(PublishAttempt).one()
    assert stored.decision == "published"
    assert stored.feed_bytes is not None
    assert stored.is_current is False


@respx.mock
def test_a_refused_edit_leaves_the_feed_on_the_air(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The binding check runs before a field moves, so a 422 costs the feed
    nothing: no revision bump, no cleared pointer, no stored change."""
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api).status_code == 201
    feed = binding(db)
    put_it_on_the_air(db, feed)

    set_columns(monkeypatch, ("bus", "lat"))
    response = api.put("/published-feeds/vehicles", json=BODY, headers=auth())

    assert response.status_code == 422
    assert current_artifact(db, feed) is not None
    assert binding(db).revision == 1


@respx.mock
def test_an_edit_naming_an_unreadable_query_leaves_the_feed_on_the_air(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """THE FAILURE THAT USED TO RETURN 200.

    A typoed `queryId`, or a Redash blip on the one read that resolves it, made
    `query_result_columns` answer `()`. `()` is `unvalidated`, which is a state a
    binding is allowed to be saved in, so the edit was ACCEPTED: the revision
    bumped, the pointer cleared, and a working regional feed went dark on a
    success response nobody would look twice at.

    The columns are still stubbed present here, so the only thing refusing this
    write is the separate readability read.
    """
    as_user(ADMIN)
    set_columns(monkeypatch, REBOUND_COLUMNS)
    assert create(api).status_code == 201
    feed = binding(db)
    put_it_on_the_air(db, feed)

    query_is_unreadable(404)
    response = api.put("/published-feeds/vehicles", json=REBOUND, headers=auth())

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_QUERY_UNREADABLE"
    assert current_artifact(db, feed) is not None
    assert binding(db).revision == 1
    assert binding(db).column_map == BODY["columnMap"]


@respx.mock
def test_a_refused_edit_by_a_non_admin_leaves_the_feed_on_the_air(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The admin guard runs before the pointer is touched as well, so a member
    cannot take a feed dark with an edit they were never allowed to make."""
    as_user(ADMIN)
    set_columns(monkeypatch, REBOUND_COLUMNS)
    assert create(api).status_code == 201
    feed = binding(db)
    put_it_on_the_air(db, feed)

    as_user(MEMBER)
    assert api.put("/published-feeds/vehicles", json=REBOUND, headers=auth("mo")).status_code == 403
    assert api.delete("/published-feeds/vehicles", headers=auth("mo")).status_code == 403

    assert current_artifact(db, feed) is not None


@respx.mock
def test_deleting_a_binding_takes_the_feed_off_the_air(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`publish_attempt` has no foreign key to `published_feed`, so the artifact
    outlives the delete. Leave its pointer set and recreating the slug hands a
    brand-new binding the deleted feed's bytes from its very first moment."""
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api).status_code == 201
    put_it_on_the_air(db, binding(db))

    assert api.delete("/published-feeds/vehicles", headers=auth()).status_code == 204

    assert create(api).status_code == 201
    assert current_artifact(db, binding(db)) is None

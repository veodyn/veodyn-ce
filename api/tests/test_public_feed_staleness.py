"""The two on-failure modes, at the endpoint that is the only place they differ.

Design section 6.5: `block` keeps serving the last valid artifact with its
original header timestamp and "never stops serving on age alone"; `last_good` is
the same PLUS its required cap, past which the endpoint answers 503 with
`Retry-After`.

Its own file rather than more of `test_public_feed_route.py`, because that one
is about WHICH artifact a slug resolves to (visibility, collisions, never
published) and this one is about whether an artifact already resolved is fresh
enough to hand over. Both would otherwise read as "the endpoint 404s a lot".

Every case here freezes the clock. Staleness is the one thing this endpoint
measures against wall time, so a test that let the real clock run would be
asserting on how long the suite took.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.publish_stubs import attempt_row, make_feed
from veodyn_api.routers import public_feeds

NOW = 100_000
CAP = 300


def freeze(monkeypatch: pytest.MonkeyPatch, now: int = NOW) -> None:
    monkeypatch.setattr(public_feeds, "_now_epoch", lambda: now)


def published_at(db: Session, *, age: int, on_error: str, cap: int | None) -> None:
    """One public feed holding one current artifact `age` seconds old."""
    feed = make_feed(
        db,
        org_slug="acme",
        slug="vehicles",
        visibility="public",
        on_error=on_error,
        last_good_max_age_seconds=cap,
    )
    db.add(attempt_row(feed, feed_bytes=b"\x0a\x02\x08\x01", feed_timestamp=NOW - age))
    db.commit()


def test_block_serves_an_ancient_artifact_rather_than_going_dark(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The control, and the half that is easy to get backwards.

    `block` has no cap and takes no age branch at all. An artifact a week old
    still serves, because `block`'s promise is about refusing to PUBLISH a bad
    read, not about withdrawing one that already published. Without this case a
    staleness check wrongly applied to both modes would pass every other test in
    this file.
    """
    freeze(monkeypatch)
    published_at(db, age=7 * 24 * 3600, on_error="block", cap=None)

    response = api.get("/public/feeds/vehicles")

    assert response.status_code == 200
    assert response.content == b"\x0a\x02\x08\x01"


def test_last_good_serves_while_the_artifact_is_inside_the_cap(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    freeze(monkeypatch)
    published_at(db, age=CAP - 1, on_error="last_good", cap=CAP)

    response = api.get("/public/feeds/vehicles")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/x-protobuf"


def test_last_good_still_serves_exactly_at_the_cap(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The boundary, pinned because `>` and `>=` are one character apart and the
    cap reads as a maximum permitted age rather than the first forbidden one."""
    freeze(monkeypatch)
    published_at(db, age=CAP, on_error="last_good", cap=CAP)

    assert api.get("/public/feeds/vehicles").status_code == 200


def test_last_good_withholds_the_artifact_once_past_the_cap(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """503 and not 404: the feed exists, is public and has published. What it
    does not have is anything fresh enough, and a consumer has to be able to
    tell "come back" from "there is nothing here"."""
    freeze(monkeypatch)
    published_at(db, age=CAP + 1, on_error="last_good", cap=CAP)

    response = api.get("/public/feeds/vehicles")

    assert response.status_code == 503
    assert response.headers["retry-after"] == str(CAP)
    assert response.json()["error"]["id"] == "VEODYN_PUBLIC_FEED_TOO_STALE"
    # The stale bytes themselves are withheld, which is the entire point.
    assert b"\x0a\x02\x08\x01" not in response.content


def test_the_stale_refusal_does_not_leak_the_bytes_or_claim_the_feed_is_absent(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Separates this refusal from the 404 next door. An unknown slug and a
    stale feed must not answer alike in EITHER direction: collapsing stale into
    404 would tell a live consumer their feed was deleted."""
    freeze(monkeypatch)
    published_at(db, age=CAP + 1, on_error="last_good", cap=CAP)

    stale = api.get("/public/feeds/vehicles")
    unknown = api.get("/public/feeds/no-such-feed")

    assert stale.status_code == 503
    assert unknown.status_code == 404
    assert stale.json() != unknown.json()


def test_an_artifact_with_no_header_timestamp_fails_closed_under_last_good(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Defensive: the publish path derives the header time from the result's own
    `retrieved_at` and refuses when it cannot read one, so a current artifact
    always carries a stamp. If one ever lacks it, freshness cannot be proven,
    and the mode whose whole purpose is bounding staleness must not serve on an
    unprovable claim."""
    freeze(monkeypatch)
    feed = make_feed(
        db,
        org_slug="acme",
        slug="vehicles",
        visibility="public",
        on_error="last_good",
        last_good_max_age_seconds=CAP,
    )
    db.add(attempt_row(feed, feed_bytes=b"\x0a\x02\x08\x01", feed_timestamp=None))
    db.commit()

    response = api.get("/public/feeds/vehicles")

    assert response.status_code == 503
    assert response.json()["error"]["id"] == "VEODYN_PUBLIC_FEED_TOO_STALE"

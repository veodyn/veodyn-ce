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

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.publish_stubs import attempt_row, make_feed
from veodyn_api.routers import public_feeds

NOW = 100_000
CAP = 300

STATION_STATUS: dict[str, Any] = {"last_updated": 1, "ttl": 0, "version": "2.3", "data": {"stations": []}}
GBFS_FILES: dict[str, Any] = {
    "gbfs.json": {"last_updated": 1, "ttl": 0, "version": "2.3", "data": {"en": {"feeds": []}}},
    "station_status.json": STATION_STATUS,
}


def freeze(monkeypatch: pytest.MonkeyPatch, now: int = NOW) -> None:
    monkeypatch.setattr(public_feeds, "_now_epoch", lambda: now)


def gbfs_published_at(db: Session, *, age: int, on_error: str, cap: int | None) -> None:
    """The same arrangement for a gbfs artifact, whose files both routes serve.

    `feed_timestamp` is the discovery document's `last_updated`, so the cap is
    measured against the same field for either standard.
    """
    feed = make_feed(
        db,
        org_slug="acme",
        slug="bikes",
        visibility="public",
        standard="gbfs",
        version="2.3",
        entity="stations",
        static_gtfs_ref=None,
        system_info={"system_id": "acme", "language": "en", "name": "Acme Bikes", "timezone": "UTC"},
        column_map={"station_id": "sid", "name": "nm", "lat": "lat", "lon": "lon"},
        on_error=on_error,
        last_good_max_age_seconds=cap,
    )
    row = attempt_row(feed, feed_bytes=None, feed_timestamp=NOW - age)
    row.feed_files = GBFS_FILES
    db.add(row)
    db.commit()


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


def test_both_gbfs_routes_serve_while_the_artifact_is_inside_the_cap(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    freeze(monkeypatch)
    gbfs_published_at(db, age=CAP - 1, on_error="last_good", cap=CAP)

    assert api.get("/public/feeds/bikes").status_code == 200
    assert api.get("/public/feeds/bikes/station_status.json").json() == STATION_STATUS


def test_the_member_route_withholds_a_stale_file_exactly_as_the_discovery_route_does(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The cap is a promise about the feed, not about one address of it. A
    member route that skipped the branch would hand out the same stale data the
    discovery route just withheld."""
    freeze(monkeypatch)
    gbfs_published_at(db, age=CAP + 1, on_error="last_good", cap=CAP)

    discovery = api.get("/public/feeds/bikes")
    member = api.get("/public/feeds/bikes/station_status.json")

    assert discovery.status_code == member.status_code == 503
    assert member.headers["retry-after"] == str(CAP)
    assert member.json()["error"]["id"] == "VEODYN_PUBLIC_FEED_TOO_STALE"
    assert "stations" not in member.text


def test_an_unknown_file_on_a_stale_feed_is_the_404_and_not_the_503(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The 503 discloses that the slug names a live public feed, so the
    identical 404 has to come first: a name that is not in the set must answer
    the same whether or not the feed behind it is fresh."""
    freeze(monkeypatch)
    unknown_slug = api.get("/public/feeds/bikes/free_bike_status.json")
    gbfs_published_at(db, age=CAP + 1, on_error="last_good", cap=CAP)

    missing_file = api.get("/public/feeds/bikes/free_bike_status.json")

    assert missing_file.status_code == unknown_slug.status_code == 404
    assert missing_file.json() == unknown_slug.json()

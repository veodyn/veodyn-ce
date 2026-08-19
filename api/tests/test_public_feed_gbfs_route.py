"""GET /public/feeds/{slug} and /{slug}/{file_name} for a GBFS artifact.

Split from test_public_feed_route.py at the file-size limit; that file keeps
the GTFS-Realtime cases and the cross-org slug collisions. The two routes are
one surface, so the identical-404 discipline is asserted on both sides.
"""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.publish_stubs import attempt_row, make_feed
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.publish_engine import current_artifact

GBFS_FILES: dict[str, Any] = {
    "gbfs.json": {"last_updated": 1, "ttl": 0, "version": "2.3", "data": {"en": {"feeds": []}}},
    "station_status.json": {"last_updated": 1, "ttl": 0, "version": "2.3", "data": {"stations": []}},
}


def publish_gbfs(
    db: Session,
    *,
    slug: str = "bikes",
    files: dict[str, Any] | None = None,
    visibility: str = "public",
) -> PublishedFeed:
    """A public gbfs binding holding one current file-set artifact.

    Written straight to the table like every other artifact in this file, and
    with `feed_files` instead of `feed_bytes`, which is the whole difference the
    serving routes have to read.
    """
    feed = make_feed(
        db,
        org_slug="acme",
        slug=slug,
        visibility=visibility,
        standard="gbfs",
        version="2.3",
        entity="stations",
        static_gtfs_ref=None,
        system_info={"system_id": "acme", "language": "en", "name": "Acme Bikes", "timezone": "UTC"},
        column_map={"station_id": "sid", "name": "nm", "lat": "lat", "lon": "lon"},
    )
    row = attempt_row(feed, feed_bytes=None)
    row.feed_files = GBFS_FILES if files is None else files
    db.add(row)
    db.commit()
    return feed


def test_a_gbfs_feed_serves_its_discovery_document_as_json(api: TestClient, db: Session) -> None:
    publish_gbfs(db)

    response = api.get("/public/feeds/bikes")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == GBFS_FILES["gbfs.json"]


def test_a_gbfs_feed_serves_one_member_file(api: TestClient, db: Session) -> None:
    publish_gbfs(db)

    response = api.get("/public/feeds/bikes/station_status.json")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == GBFS_FILES["station_status.json"]


def test_an_unknown_slug_and_an_unknown_member_file_answer_the_identical_404(api: TestClient, db: Session) -> None:
    """THE PROPERTY THIS ROUTER EXISTS FOR, now over two path segments.

    One slug, exercised before it exists and then after it does, so the two
    bodies can be compared byte for byte the way the single-segment test above
    does. A refusal that named the file it could not find, or that answered
    differently for a slug nobody has taken, would let a caller enumerate both
    the slugs and the file sets one guess at a time.
    """
    unknown_slug = api.get("/public/feeds/bikes/station_status.json")
    assert unknown_slug.status_code == 404

    publish_gbfs(db)
    missing_file = api.get("/public/feeds/bikes/free_bike_status.json")

    assert missing_file.status_code == unknown_slug.status_code
    assert missing_file.json() == unknown_slug.json()
    assert missing_file.content == unknown_slug.content


def test_the_member_route_refuses_a_gtfs_rt_feed_with_the_same_404(api: TestClient, db: Session) -> None:
    """A gtfs-rt feed has no member files at all, and saying so would say the
    slug is taken. Same slug before and after publishing, same 404 body."""
    unknown_slug = api.get("/public/feeds/vehicles/gbfs.json")
    assert unknown_slug.status_code == 404

    feed = make_feed(db, org_slug="acme", slug="vehicles", visibility="public")
    db.add(attempt_row(feed, feed_bytes=b"\x0a\x02\x08\x01"))
    db.commit()
    assert current_artifact(db, feed) is not None

    refused = api.get("/public/feeds/vehicles/gbfs.json")

    assert refused.status_code == 404
    assert refused.json() == unknown_slug.json()
    assert b"\x0a\x02\x08\x01" not in refused.content


def test_a_private_gbfs_feeds_member_file_answers_the_same_404(api: TestClient, db: Session) -> None:
    unknown_slug = api.get("/public/feeds/bikes/station_status.json")

    publish_gbfs(db, visibility="private")
    private = api.get("/public/feeds/bikes/station_status.json")

    assert private.status_code == 404
    assert private.json() == unknown_slug.json()


def test_a_gbfs_artifact_with_no_discovery_document_is_refused_rather_than_half_served(
    api: TestClient, db: Session
) -> None:
    """`gbfs.json` is the address the binding hands out, so an artifact without
    one has nothing to answer the discovery route with. Refused as a 404 rather
    than as an empty 200 that a consumer would read as a system with no feeds."""
    publish_gbfs(db, files={"station_status.json": GBFS_FILES["station_status.json"]})

    assert api.get("/public/feeds/bikes").status_code == 404
    # The member file itself is still servable: only the discovery view is missing.
    assert api.get("/public/feeds/bikes/station_status.json").status_code == 200


def test_member_files_on_a_gtfs_rt_binding_are_refused_by_the_binding_not_the_artifact(
    api: TestClient, db: Session
) -> None:
    """The database permits a gtfs-rt binding whose current attempt carries
    `feed_files`, since the CHECK only requires one artifact kind. Reading the
    artifact's shape alone would serve GBFS member files off a gtfs-rt feed."""
    feed = make_feed(db, org_slug="acme", slug="buses", visibility="public")
    row = attempt_row(feed, feed_bytes=None)
    row.feed_files = GBFS_FILES
    db.add(row)
    db.commit()

    # Both routes: neither may read the artifact's shape and serve GBFS from it.
    member = api.get("/public/feeds/buses/station_status.json")
    discovery = api.get("/public/feeds/buses")
    assert member.status_code == 404
    assert discovery.status_code == 404
    assert member.json() == discovery.json()


def test_a_never_published_gbfs_binding_serves_neither_route(api: TestClient, db: Session) -> None:
    """The artifact-absent refusal now has two kinds of artifact to find absent,
    and `feed_bytes is None` alone would have called a published gbfs feed
    empty. This is the case that keeps the check spelling both out."""
    make_feed(
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
    )

    assert api.get("/public/feeds/bikes").status_code == 404
    assert api.get("/public/feeds/bikes/station_status.json").status_code == 404


def test_a_stale_artifact_with_no_discovery_document_does_not_answer_differently(api: TestClient, db: Session) -> None:
    """The 503 discloses that a slug names a live public feed. An address with no
    `gbfs.json` to serve has to answer the same 404 whether or not its artifact
    has gone stale, or that disclosure reaches a URL that never had anything."""
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
        on_error="last_good",
        last_good_max_age_seconds=60,
    )
    row = attempt_row(feed, feed_bytes=None)
    row.feed_files = {"station_status.json": GBFS_FILES["station_status.json"]}
    # Far older than the cap, so the staleness branch fires if it runs first.
    row.feed_timestamp = 1
    db.add(row)
    db.commit()

    # `_not_found` echoes the requested slug, so the bodies of two different
    # slugs never match. What must hold is that this is the 404 and not the 503,
    # which is the answer that would confirm the address is live.
    stale = api.get("/public/feeds/bikes")
    assert stale.status_code == 404
    assert stale.json()["error"]["id"] == "VEODYN_PUBLIC_FEED_NOT_FOUND"
    assert "retry-after" not in stale.headers

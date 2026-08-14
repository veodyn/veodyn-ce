"""GET /public/feeds/{slug}: the one unauthenticated route in this service's
community surface.

No cookie, no key, no `as_user`/`auth` stub -- that absence is the point, see
`routers/public_feeds.py`. Built on `publish_stubs.make_feed`/`attempt_row`
rather than `published_feed_route_stubs.create`, because these tests write the
served artifact straight to the table the way `test_published_feed_serving.py`
does: what is under test is what this endpoint reads back, not the write path
that produced it.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tests.publish_stubs import attempt_row, make_feed
from veodyn_api.services.publish_engine import current_artifact

PUBLIC_SLUG_INDEX = "uq_published_feed_public_slug"
RECREATE_PUBLIC_SLUG_INDEX = (
    f"CREATE UNIQUE INDEX {PUBLIC_SLUG_INDEX} ON published_feed (slug) WHERE visibility = 'public'"
)


def test_a_public_feed_serves_its_current_bytes_with_gtfs_rt_content_type(api: TestClient, db: Session) -> None:
    feed = make_feed(db, org_slug="acme", slug="vehicles", visibility="public")
    db.add(attempt_row(feed, feed_bytes=b"\x0a\x02\x08\x01"))
    db.commit()
    assert current_artifact(db, feed) is not None

    response = api.get("/public/feeds/vehicles")

    assert response.status_code == 200
    assert response.content == b"\x0a\x02\x08\x01"
    assert response.headers["content-type"] == "application/x-protobuf"


def test_a_private_feed_an_unknown_slug_and_a_never_published_feed_answer_the_identical_404(
    api: TestClient, db: Session
) -> None:
    """One slug, three causes, exercised one at a time so the response body can
    be compared byte for byte and no case is left standing to mask the next
    one's own query from ever seeing a real candidate row.

    An unknown slug first, with nothing in the table at all. Then a feed
    declared but never published, torn down again before the third case. Then
    a feed that HAS a current artifact but is `private`, proving visibility is
    what gates this and not merely "nothing to serve yet".
    """
    unknown = api.get("/public/feeds/vehicles")
    assert unknown.status_code == 404

    never_published = make_feed(db, org_slug="declared-only", slug="vehicles", visibility="public")
    assert current_artifact(db, never_published) is None
    dark = api.get("/public/feeds/vehicles")
    assert dark.status_code == 404
    assert dark.json() == unknown.json()
    db.delete(never_published)
    db.commit()

    private_but_published = make_feed(db, org_slug="stays-private", slug="vehicles", visibility="private")
    db.add(attempt_row(private_but_published, feed_bytes=b"secret"))
    db.commit()
    assert current_artifact(db, private_but_published) is not None
    private_response = api.get("/public/feeds/vehicles")
    assert private_response.status_code == 404
    assert private_response.json() == unknown.json()


def test_two_orgs_cannot_hold_the_same_public_slug_at_all(api: TestClient, db: Session) -> None:
    """The collision is prevented, not arbitrated.

    A one-segment public path cannot say which org a slug meant, and the
    endpoint's answer to an ambiguous slug is its ordinary 404. That refusal is
    safe but it is also a weapon: whoever creates the SECOND public feed at a
    slug takes the first one dark, from another tenant entirely, without
    publishing anything. Migration 0013's partial unique index removes the
    state, so the endpoint's ambiguity branch is unreachable on a migrated
    database rather than merely well-behaved.

    Asserted against the database, not the router, because that is where the
    guarantee now lives: a direct write cannot produce the collision either.
    """
    first = make_feed(db, org_slug="org-a", slug="shared", visibility="public")
    db.add(attempt_row(first, feed_bytes=b"from-a"))
    db.commit()

    # `make_feed` commits, so the index refuses inside this call rather than at
    # a commit of ours.
    with pytest.raises(IntegrityError, match="uq_published_feed_public_slug"):
        make_feed(db, org_slug="org-b", slug="shared", visibility="public")
    db.rollback()

    # org-a is untouched by the attempt, which is the point of the whole index.
    response = api.get("/public/feeds/shared")
    assert response.status_code == 200
    assert response.content == b"from-a"


def test_a_collision_where_only_one_side_ever_published_is_still_refused(api: TestClient, db: Session) -> None:
    """The case that separates counting BINDINGS from counting ARTIFACTS.

    Two public bindings at one slug, only one of which has ever published. An
    inner join to the current attempt returns exactly one row here and would
    serve that tenant's bytes, which is precisely the arbitrary pick the design
    refuses; the outer join driven from the binding side returns two and
    refuses.

    Migration 0013 makes this state impossible to create through any write
    path, so it is built by dropping the index for the duration. That is the
    only way to exercise the guard at all, and a guard nothing can reach is
    worth knowing about either way: this is what protects a database that
    reached head some other way, which the root CLAUDE.md records as a real
    thing that has happened here.
    """
    db.execute(text(f"DROP INDEX {PUBLIC_SLUG_INDEX}"))
    try:
        published = make_feed(db, org_slug="org-a", slug="shared", visibility="public")
        db.add(attempt_row(published, feed_bytes=b"from-a"))
        make_feed(db, org_slug="org-b", slug="shared", visibility="public")
        db.commit()

        response = api.get("/public/feeds/shared")

        assert response.status_code == 404
        assert response.content != b"from-a"
    finally:
        # The colliding rows are committed, so the index cannot be rebuilt over
        # them: clear them first. The session-level fixture truncates after
        # every test anyway, but the index has to come back BEFORE the next test
        # runs, or dropping it here would silently disable the constraint for
        # the rest of the session and take the other tests in this file with it.
        db.rollback()
        db.execute(text("TRUNCATE publish_attempt, published_feed RESTART IDENTITY CASCADE"))
        db.execute(text(RECREATE_PUBLIC_SLUG_INDEX))
        db.commit()


def test_the_same_slug_stays_free_for_two_orgs_while_both_are_private(api: TestClient, db: Session) -> None:
    """The index is partial, so it constrains only what is anonymously
    addressable. A private feed has no public address to collide over, and
    taking that freedom away would make one org's private naming visible as a
    refusal to another."""
    first = make_feed(db, org_slug="org-a", slug="internal", visibility="private")
    second = make_feed(db, org_slug="org-b", slug="internal", visibility="private")
    db.add_all([attempt_row(first, feed_bytes=b"a"), attempt_row(second, feed_bytes=b"b")])
    db.commit()

    assert api.get("/public/feeds/internal").status_code == 404

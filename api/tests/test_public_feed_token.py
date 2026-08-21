"""GET /public/feeds/{slug} with a feed token: what a resolver's answer buys.

The first two cases are the community build, where nothing is registered: a
token changes nothing in either direction, neither opening a private feed nor
disturbing a public one. The rest register a stand-in resolver and drive what
the route does with what it answers, including answers it does not trust.

How a token may be PRESENTED is `test_public_feed_token_transport.py`, split off
at the file-size limit. The two would otherwise read as one long list of 404s.

`_not_found` echoes the requested slug, so every "identical to an unknown slug"
assertion asks for ONE slug before its row exists and again after, the way
`test_public_feed_route.py` does.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.publish_stubs import attempt_row, make_feed
from tests.published_feed_token_stubs import (
    BYTES,
    CAP,
    GRANT,
    NOW,
    TOKEN,
    WRONG,
    bearer,
    granting,
    never_asked,
    private_feed,
    refusal,
)
from veodyn_api.routers import public_feeds


def test_with_no_resolver_registered_a_token_opens_nothing(api: TestClient, db: Session) -> None:
    """The community build, and the case that has to keep passing forever.

    A private feed answers a presented token with the same 404 an unknown slug
    gets, so a build with no pack installed discloses nothing more than it did
    before this route learned the word token.
    """
    unknown = api.get("/public/feeds/vehicles", params={"token": TOKEN})
    assert unknown.status_code == 404

    private_feed(db)

    refused = api.get("/public/feeds/vehicles", params={"token": TOKEN})
    header = api.get("/public/feeds/vehicles", headers=bearer(TOKEN))

    assert refusal(refused) == refusal(header) == refusal(unknown)
    assert BYTES not in refused.content


def test_a_public_feed_serves_normally_to_a_caller_presenting_a_token(api: TestClient, db: Session) -> None:
    """A token is not a claim the route has to adjudicate. Most consumers poll
    one URL for several feeds and some of them will carry a credential at an
    address that never needed one; refusing that would take a working public
    feed dark on a caller doing nothing wrong."""
    feed = make_feed(db, org_slug="acme", slug="vehicles", visibility="public")
    db.add(attempt_row(feed, feed_bytes=BYTES))
    db.commit()

    # Under a resolver that refuses to be asked, so this pins the ORDER and not
    # merely the outcome: a build that consulted the registry first, or let it
    # override a public hit, would reach the resolver and fail here.
    with never_asked():
        with_query = api.get("/public/feeds/vehicles", params={"token": TOKEN})
        with_header = api.get("/public/feeds/vehicles", headers=bearer(TOKEN))

    assert with_query.status_code == with_header.status_code == 200
    assert with_query.content == with_header.content == BYTES
    assert with_query.headers["content-type"] == "application/x-protobuf"


def test_a_granted_token_in_the_query_string_serves_the_private_feed(api: TestClient, db: Session) -> None:
    """The primary transport. A feed poller is frequently a URL and nothing
    else, with no way to attach a header to it."""
    private_feed(db)

    with granting(GRANT):
        response = api.get("/public/feeds/vehicles", params={"token": TOKEN})

    assert response.status_code == 200
    assert response.content == BYTES
    assert response.headers["content-type"] == "application/x-protobuf"


def test_a_wrong_token_is_indistinguishable_from_an_unknown_slug(api: TestClient, db: Session) -> None:
    """Wrong, revoked and expired are one answer, and it is the answer a slug
    nobody has taken gets. Anything else lets a holder of a dead token learn
    that the feed is still there, one guess at a time."""
    unknown = api.get("/public/feeds/vehicles", params={"token": WRONG})
    private_feed(db)

    with granting(GRANT):
        response = api.get("/public/feeds/vehicles", params={"token": WRONG})

    assert refusal(response) == refusal(unknown)


def test_a_resolver_answering_with_another_feed_is_refused(api: TestClient, db: Session) -> None:
    """The route re-checks the slug it asked about against the feed it is
    handed. A resolver is pack code and a bug in it must not be able to serve
    one tenant's private bytes at another tenant's address."""
    unknown = api.get("/public/feeds/vehicles", params={"token": TOKEN})
    private_feed(db)
    elsewhere = make_feed(db, org_slug="other", slug="internal", visibility="private")
    db.add(attempt_row(elsewhere, feed_bytes=b"someone-elses"))
    db.commit()

    with granting({TOKEN: ("other", "internal")}):
        response = api.get("/public/feeds/vehicles", params={"token": TOKEN})

    # Compared whole, not by status alone. A refusal answered with a different
    # body length or an extra header is still an oracle: it would tell a caller
    # that their token resolved to SOMETHING, just not to this address.
    assert refusal(response) == refusal(unknown)
    assert b"someone-elses" not in response.content


def test_a_granted_feed_that_has_never_published_still_answers_the_404(api: TestClient, db: Session) -> None:
    """A token grants the binding, not bytes that do not exist. Answering
    anything else would make the token path a second way to learn that a slug
    is declared, which the public path is careful not to be."""
    make_feed(db, org_slug="acme", slug="vehicles", visibility="private")

    with granting(GRANT):
        response = api.get("/public/feeds/vehicles", params={"token": TOKEN})

    assert response.status_code == 404


def test_a_granted_feed_whose_current_attempt_holds_no_artifact_is_refused(api: TestClient, db: Session) -> None:
    """The other half of the same check, and the reachable one: `is_current` is
    tied to no decision by any constraint, so a blocked attempt can be the
    current row. Nothing about a token makes an empty artifact servable."""
    feed = make_feed(db, org_slug="acme", slug="vehicles", visibility="private")
    db.add(attempt_row(feed, decision="blocked", feed_bytes=None))
    db.commit()

    with granting(GRANT):
        response = api.get("/public/feeds/vehicles", params={"token": TOKEN})

    assert response.status_code == 404


def test_a_stale_private_feed_answers_a_valid_token_with_the_same_503(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Once the token has resolved, the feed is this caller's feed and gets the
    public path's own answers. `last_good` past its cap is "come back", and a
    404 here would tell a legitimate consumer their feed was deleted."""
    monkeypatch.setattr(public_feeds, "_now_epoch", lambda: NOW)
    private_feed(db, age=CAP + 1, on_error="last_good", cap=CAP)

    with granting(GRANT):
        response = api.get("/public/feeds/vehicles", params={"token": TOKEN})

    assert response.status_code == 503
    assert response.headers["retry-after"] == str(CAP)
    assert response.json()["error"]["id"] == "VEODYN_PUBLIC_FEED_TOO_STALE"
    assert BYTES not in response.content


def test_a_stale_private_feed_answers_a_wrong_token_with_the_404_and_not_the_503(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The ordering rule this module already keeps for missing member files,
    now for the token. The 503 discloses a live feed that has published, so it
    has to sit BEHIND resolution: a wrong token that drew a 503 would confirm
    the slug is real and currently stale."""
    monkeypatch.setattr(public_feeds, "_now_epoch", lambda: NOW)
    unknown = api.get("/public/feeds/vehicles", params={"token": WRONG})
    private_feed(db, age=CAP + 1, on_error="last_good", cap=CAP)

    with granting(GRANT):
        response = api.get("/public/feeds/vehicles", params={"token": WRONG})

    assert refusal(response) == refusal(unknown)
    assert "retry-after" not in response.headers

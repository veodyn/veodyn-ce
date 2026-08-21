"""GET /public/feeds/{slug}/{file_name} with a feed token.

Its own file for the reason `test_public_feed_gbfs_route.py` is: the two routes
are one surface, and a member file that resolved by a different rule than the
discovery document would be a second place to learn which slugs exist. A GBFS
consumer reads the discovery document once and then polls the files it names,
so a token that opens one address and not the other opens nothing usable.
"""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.publish_stubs import attempt_row, gbfs_feed
from tests.published_feed_token_stubs import TOKEN, WRONG, bearer, granting, refusal

STATION_STATUS: dict[str, Any] = {"last_updated": 1, "ttl": 0, "version": "2.3", "data": {"stations": []}}
GBFS_FILES: dict[str, Any] = {
    "gbfs.json": {"last_updated": 1, "ttl": 0, "version": "2.3", "data": {"en": {"feeds": []}}},
    "station_status.json": STATION_STATUS,
}

MEMBER = "/public/feeds/bikes/station_status.json"
GRANT = {TOKEN: ("acme", "bikes")}


def private_gbfs(db: Session) -> None:
    """One private gbfs binding at `acme/bikes` holding one current file set."""
    feed = gbfs_feed(db, org_slug="acme", slug="bikes", visibility="private")
    row = attempt_row(feed, feed_bytes=None)
    row.feed_files = GBFS_FILES
    db.add(row)
    db.commit()


def test_with_no_resolver_registered_a_token_opens_no_member_file(api: TestClient, db: Session) -> None:
    unknown = api.get(MEMBER, params={"token": TOKEN})
    assert unknown.status_code == 404

    private_gbfs(db)

    refused = api.get(MEMBER, params={"token": TOKEN})
    header = api.get(MEMBER, headers={"authorization": f"Bearer {TOKEN}"})

    assert refused.status_code == header.status_code == 404
    assert refused.json() == header.json() == unknown.json()
    assert "stations" not in refused.text


def test_a_granted_token_serves_the_member_file_by_either_transport(api: TestClient, db: Session) -> None:
    private_gbfs(db)

    with granting(GRANT):
        query = api.get(MEMBER, params={"token": TOKEN})
        header = api.get(MEMBER, headers={"authorization": f"Bearer {TOKEN}"})
        discovery = api.get("/public/feeds/bikes", params={"token": TOKEN})

    assert query.status_code == header.status_code == 200
    assert query.json() == header.json() == STATION_STATUS
    assert query.headers["content-type"].startswith("application/json")
    # The document that names the files has to open on the same token, or a
    # consumer has the addresses and no way to have discovered them.
    assert discovery.status_code == 200
    assert discovery.json() == GBFS_FILES["gbfs.json"]


def test_both_transports_at_once_serve_the_member_file_when_they_agree(api: TestClient, db: Session) -> None:
    """The member route resolves through the same helper the discovery route
    does, so today this cannot diverge. Asserted anyway: the helper is one
    refactor away from being inlined into one of the two, and the route that
    then read the token differently would be the one nobody was watching."""
    private_gbfs(db)

    with granting(GRANT):
        response = api.get(MEMBER, params={"token": TOKEN}, headers=bearer(TOKEN))

    assert response.status_code == 200
    assert response.json() == STATION_STATUS


def test_two_different_tokens_on_a_member_file_are_refused(api: TestClient, db: Session) -> None:
    """And the refusal is the unknown-slug 404, not a complaint about the
    request: naming the conflict would confirm the address is real."""
    unknown = api.get(MEMBER, params={"token": TOKEN})
    private_gbfs(db)

    with granting(GRANT):
        response = api.get(MEMBER, params={"token": TOKEN}, headers=bearer(WRONG))

    assert refusal(response) == refusal(unknown)
    assert "stations" not in response.text


def test_a_wrong_token_on_a_member_file_is_the_unknown_slug_404(api: TestClient, db: Session) -> None:
    unknown = api.get(MEMBER, params={"token": WRONG})
    private_gbfs(db)

    with granting(GRANT):
        response = api.get(MEMBER, params={"token": WRONG})

    assert response.status_code == unknown.status_code == 404
    assert response.json() == unknown.json()
    assert response.content == unknown.content


def test_a_granted_token_does_not_open_a_file_outside_the_published_set(api: TestClient, db: Session) -> None:
    """The file set is not enumerable from inside the feed either. A name that
    was never published answers the same 404 a wrong token gets, so the reply
    says nothing about which files exist."""
    private_gbfs(db)

    with granting(GRANT):
        missing = api.get("/public/feeds/bikes/free_bike_status.json", params={"token": TOKEN})
        wrong_token = api.get("/public/feeds/bikes/free_bike_status.json", params={"token": WRONG})

    assert missing.status_code == 404
    assert missing.json() == wrong_token.json()

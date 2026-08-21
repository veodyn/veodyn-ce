"""How a feed token may be PRESENTED, as distinct from what it then opens.

Split from `test_public_feed_token.py` at the file-size limit, and along the
seam the route itself has: `_presented_token` decides what one credential this
request carries, and everything after it is the same code whichever transport
carried it. Both transports are equal here, so neither can quietly become the
second-class one.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.published_feed_token_stubs import (
    BYTES,
    GRANT,
    TOKEN,
    WRONG,
    bearer,
    granting,
    private_feed,
    refusal,
)
from veodyn_api.routers import public_feeds


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (f"Bearer {TOKEN}", TOKEN),
        # RFC 9110 writes the separator as one or more spaces, and a client or a
        # proxy that pads it is sending the same credential. Keeping the pad made
        # this token a different string from the identical one in the query, so a
        # caller presenting both was refused for presenting two.
        (f"Bearer  {TOKEN}", TOKEN),
        (f"Bearer\t{TOKEN}", TOKEN),
        # Trailing whitespace is the same story from the other end, and the half
        # a split alone does not cover: `split(None, 1)` strips what comes before
        # the credential and leaves what comes after it.
        (f"Bearer {TOKEN}  ", TOKEN),
        (f"Bearer  {TOKEN}\t", TOKEN),
        (f"bearer {TOKEN}", TOKEN),
        (f"BEARER {TOKEN}", TOKEN),
        # Nothing after the scheme is nothing presented. Whitespace read as a
        # credential is a token that opens nothing and that conflicts with a real
        # one beside it.
        ("Bearer   ", None),
        ("Bearer", None),
        ("Bearer ", None),
        (f"Key {TOKEN}", None),
        (TOKEN, None),
        ("", None),
    ],
)
def test_the_bearer_credential_is_read_the_way_the_grammar_writes_it(header: str, expected: str | None) -> None:
    """Asserted on the parser, not through a request.

    A transport is free to normalize a header on the way in, so a route-level
    case cannot show which of the two did the normalizing. These are the exact
    strings the parser has to survive.
    """
    assert public_feeds._bearer_token(header) == expected


def test_the_same_token_in_an_authorization_bearer_header_serves_the_same_bytes(api: TestClient, db: Session) -> None:
    private_feed(db)

    with granting(GRANT):
        response = api.get("/public/feeds/vehicles", headers=bearer(TOKEN))

    assert response.status_code == 200
    assert response.content == BYTES


def test_the_same_token_presented_both_ways_serves(api: TestClient, db: Session) -> None:
    """A client that sets a header and templates the URL is presenting one
    credential twice, not two."""
    private_feed(db)

    with granting(GRANT):
        response = api.get("/public/feeds/vehicles", params={"token": TOKEN}, headers=bearer(TOKEN))

    assert response.status_code == 200
    assert response.content == BYTES


def test_a_padded_bearer_header_is_the_same_credential_as_the_query_token(api: TestClient, db: Session) -> None:
    """The route-level half of the parser cases above. A padded header that kept
    its spaces fires the both-present-and-different refusal on one credential
    presented twice, which is the bug those cases pin at the unit level."""
    private_feed(db)

    with granting(GRANT):
        header_only = api.get("/public/feeds/vehicles", headers={"authorization": f"Bearer  {TOKEN}"})
        alongside = api.get(
            "/public/feeds/vehicles",
            params={"token": TOKEN},
            headers={"authorization": f"Bearer  {TOKEN}"},
        )

    assert header_only.status_code == alongside.status_code == 200
    assert header_only.content == alongside.content == BYTES


def test_two_different_tokens_presented_at_once_are_refused_rather_than_arbitrated(
    api: TestClient, db: Session
) -> None:
    """Picking one would make which transport wins part of the contract, and a
    caller whose header is stale would keep reading on a query token they think
    they revoked. Neither is presented, so this is the ordinary 404."""
    unknown = api.get("/public/feeds/vehicles", params={"token": TOKEN})
    private_feed(db)

    with granting(GRANT):
        response = api.get("/public/feeds/vehicles", params={"token": TOKEN}, headers=bearer(WRONG))

    assert refusal(response) == refusal(unknown)
    assert BYTES not in response.content


def test_only_the_bearer_scheme_is_read_as_a_token(api: TestClient, db: Session) -> None:
    """`Key <k>` is this instance's own management-plane scheme, and a header
    meant for a different plane must not be spent as a feed token here."""
    unknown = api.get("/public/feeds/vehicles")
    private_feed(db)

    with granting(GRANT):
        response = api.get("/public/feeds/vehicles", headers={"authorization": f"Key {TOKEN}"})

    assert refusal(response) == refusal(unknown)

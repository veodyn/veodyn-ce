"""A stand-in for the enterprise pack's feed-token resolver.

Shared by the two token test modules so they cannot drift into testing two
different resolvers. A plain function rather than a fixture, for the reason
`published_feed_route_stubs.py` gives: a fixture imported into a test module
reads as an unused import and `F401` fails the lint gate.

Nothing here stores or issues anything. The pack owns that; what community has
to be able to prove is what the serving route does with whatever a resolver
answers, including answers it should refuse.
"""

from collections.abc import Iterator
from contextlib import contextmanager

import httpx
from sqlalchemy.orm import Session

from tests.publish_stubs import attempt_row, make_feed
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services import published_feed_token_registry

TOKEN = "s3cret"
WRONG = "not-the-token"

BYTES = b"\x0a\x02\x08\x01"
NOW = 100_000
CAP = 300

# The grant every gtfs-rt case here uses: TOKEN opens `acme/vehicles`.
GRANT = {TOKEN: ("acme", "vehicles")}


def private_feed(db: Session, *, age: int = 0, on_error: str = "block", cap: int | None = None) -> None:
    """One private binding at `acme/vehicles` holding one current artifact."""
    feed = make_feed(
        db,
        org_slug="acme",
        slug="vehicles",
        visibility="private",
        on_error=on_error,
        last_good_max_age_seconds=cap,
    )
    db.add(attempt_row(feed, feed_bytes=BYTES, feed_timestamp=NOW - age))
    db.commit()


def bearer(token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {token}"}


# Set per response by the test transport, and never a property of the refusal.
VOLATILE_HEADERS = frozenset({"date", "server"})


def refusal(response: httpx.Response) -> tuple[int, bytes, dict[str, str]]:
    """Everything a caller can see of a refusal, minus what varies per request.

    Two refusals that have to be indistinguishable must match on the body BYTES
    and on the headers, not only on a parsed body: a content-length that differs,
    or a header only one of them carries, is as good an oracle as a differing
    error id would be.
    """
    headers = {name: value for name, value in response.headers.items() if name not in VOLATILE_HEADERS}
    return response.status_code, response.content, headers


@contextmanager
def granting(grants: dict[str, tuple[str, str]]) -> Iterator[None]:
    """One resolver for the length of the block, granting each token a feed.

    Keyed by token, valued by the feed's `(org_slug, slug)`. The grant is NOT
    checked against the requested slug, which is what lets a test hand the route
    a resolver answering with the wrong feed and watch it refuse anyway.
    """

    def resolve(db: Session, slug: str, token: str) -> PublishedFeed | None:
        target = grants.get(token)
        return None if target is None else db.get(PublishedFeed, target)

    with published_feed_token_registry.restored_feed_token_resolvers():
        published_feed_token_registry.register_feed_token_resolver(resolve)
        yield


@contextmanager
def never_asked() -> Iterator[None]:
    """A resolver that fails the test if the route ever reaches it.

    The public lookup runs first, so a token presented at a PUBLIC address must
    never be spent. An empty registry cannot show that: with nothing registered
    every ordering passes, so the ordering has to be asserted against a resolver
    that is watching.
    """

    def resolve(db: Session, slug: str, token: str) -> PublishedFeed | None:
        raise AssertionError(f"a public feed at {slug!r} resolved through a token resolver")

    with published_feed_token_registry.restored_feed_token_resolvers():
        published_feed_token_registry.register_feed_token_resolver(resolve)
        yield

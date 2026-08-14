"""Shared setup for the published-feed endpoint tests.

Two test modules drive the same endpoints from different angles -- what the
contract is (`test_published_feeds_route.py`) and what an edit does to the
artifact already being served (`test_published_feed_serving.py`) -- and both
need the same admin, the same binding body and the same stand-in for the column
read. Kept here rather than duplicated, so the two cannot drift into testing two
different feeds. `publish_stubs.py` next door is the same arrangement for the
engine.

Everything here is a plain function, never a fixture. A fixture imported into a
test module reads as an unused import to ruff, and `--max-warnings 0`'s
equivalent here is `F401` failing the lint gate; `monkeypatch` is passed in
instead, since pytest supplies it to the test for free.
"""

from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import REDASH_TEST_URL, session_payload
from tests.publish_stubs import attempt_row
from veodyn_api.models.published_feed import PublishedFeed

REDASH = REDASH_TEST_URL

ADMIN = session_payload(user_id=7, name="Ada Admin", email="ada@x.org", permissions=["admin"])
MEMBER = session_payload(user_id=9, name="Mo Member", email="mo@x.org", permissions=["execute_query"])

# What session_payload reports, so it is the tenant every binding here lands in.
ORG = "default"

# A second tenant, and an admin inside it. The listing test needs a binding that
# genuinely exists and genuinely must not be listed, which is the only way that
# assertion can fail when the org predicate is deleted.
OTHER_ORG = "elsewhere"
OTHER_ADMIN = session_payload(
    user_id=11, name="Bo Border", email="bo@y.org", permissions=["admin"], org_slug=OTHER_ORG
)

BODY: dict[str, Any] = {
    "slug": "vehicles",
    "queryId": 42,
    "standard": "gtfs-rt",
    "version": "2.0",
    "entity": "vehicle_positions",
    "staticGtfsRef": "https://example.org/gtfs.zip",
    "columnMap": {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"},
    "onError": "block",
    "visibility": "private",
}

# The same binding with one more mapped field: a real rebind, and the edit every
# revision and pointer assertion is made against.
REBOUND: dict[str, Any] = {**BODY, "columnMap": {**BODY["columnMap"], "bearing": "heading"}}

# The columns a query would have to return for BODY and for REBOUND.
BOUND_COLUMNS = ("bus", "lat", "lon")
REBOUND_COLUMNS = ("bus", "lat", "lon", "heading")


def as_user(payload: dict[str, Any]) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(200, json=payload))


# One cookie value per identity, never shared: require_identity caches the
# resolved session against the credential, so reusing a cookie hands the second
# person the first person's identity and the test passes for the wrong reason.
def auth(cookie: str = "ada") -> dict[str, str]:
    return {"cookie": f"session={cookie}"}


def query_is_readable(query_id: int = 42) -> None:
    """The existence/readability read a write path makes before the column read.

    Its own stub, and never folded into `set_columns`, because keeping the two
    apart is the whole point of the router's fix: "this query is not there" and
    "this query has no cached result" used to be the same answer, `()`, and a
    test can only tell them apart if it can stub one without the other.

    Registered last wins in respx, so `query_is_unreadable` after a `set_columns`
    replaces this route rather than queueing behind it.
    """
    respx.get(f"{REDASH}/api/queries/{query_id}").mock(return_value=httpx.Response(200, json={"id": query_id}))


def query_is_unreadable(status: int = 404, query_id: int = 42) -> None:
    """No such query, or one the service credential has no permission on.

    404 and 403 are one cause from this service's side, and 500 is a different
    one: Redash being down is not a verdict about the binding.
    """
    respx.get(f"{REDASH}/api/queries/{query_id}").mock(return_value=httpx.Response(status, json={"message": "no"}))


def set_columns(monkeypatch: pytest.MonkeyPatch, values: tuple[str, ...]) -> None:
    """Stand in for the whole-result-body read that discovers a query's columns.

    Patched on the router rather than on `ai_grounding`, because the router is
    the module that decides to spend that call and is what a test is exercising.

    The query is stubbed readable alongside, since that is the ordinary case and
    every write path now proves it first; a test about an unreadable query calls
    `query_is_unreadable` afterwards to replace the route.
    """
    query_is_readable()
    monkeypatch.setattr(
        "veodyn_api.routers.published_feeds.query_result_columns",
        lambda *args, **kwargs: values,
    )


def record_column_reads(monkeypatch: pytest.MonkeyPatch, values: tuple[str, ...]) -> list[tuple[Any, ...]]:
    """Like `set_columns`, but keeps the positional arguments it was called with.

    One test cares WHICH credential the column read runs under, and the argument
    list is the only place that shows.
    """
    calls: list[tuple[Any, ...]] = []

    def _columns(*args: Any, **kwargs: Any) -> tuple[str, ...]:
        calls.append(args)
        return values

    query_is_readable()
    monkeypatch.setattr("veodyn_api.routers.published_feeds.query_result_columns", _columns)
    return calls


def create(api: TestClient, body: dict[str, Any] | None = None) -> httpx.Response:
    return api.post("/published-feeds", json=body if body is not None else BODY, headers=auth())


def binding(db: Session, slug: str = "vehicles") -> PublishedFeed:
    feed = db.get(PublishedFeed, (ORG, slug))
    assert feed is not None
    return feed


def put_it_on_the_air(db: Session, feed: PublishedFeed) -> None:
    """A published artifact for this binding, written straight to the table.

    The engine is not involved: what these tests need is the pointer set, not a
    serializer and a validator run to set it.
    """
    db.add(attempt_row(feed))
    db.commit()

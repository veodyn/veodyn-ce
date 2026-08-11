"""Shared setup for the tag tests.

Three test modules cover tagging (the write, the vocabulary, and datasets) and
all three need the same identities and the same "make something to tag" steps.

The something used to be a KPI, created over `POST /kpis`, and a report beside
it. Both kinds went to the enterprise pack, so the thing being tagged here is
now `tests/fixture_objects.py`'s `widget`: a kind contributed through the same
object-type registry a pack registers through. That is the point rather than a
workaround. These tests are about `routers/tags.py`, and a community build's
tagging has to work for whatever kinds are installed, so testing it against a
kind the community tree does not itself own is a stronger claim than testing it
against one it did.

Rows are made through the session rather than over HTTP, because a widget has no
endpoints. The `api` fixture shares that session with the app, so a row added
here is visible to the next request.
"""

from typing import Any

import httpx
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import REDASH_TEST_URL, session_payload
from tests.fixture_objects import FIXTURE_KIND, SECOND_FIXTURE_KIND, Widget, make_widget
from veodyn_api.services import tags as tag_service

REDASH = REDASH_TEST_URL

JANE = session_payload(user_id=7, name="Jane Analyst", email="jane@x.org")
SAM = session_payload(user_id=9, name="Sam Other", email="sam@x.org")
JANE_ELSEWHERE = session_payload(user_id=7, name="Jane Analyst", email="jane@x.org", org_slug="other")

KIND = FIXTURE_KIND
SECOND_KIND = SECOND_FIXTURE_KIND
OBJECT_ID = "on-time-performance"
SECOND_OBJECT_ID = "q3-review"


def as_user(payload: dict[str, Any]) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(200, json=payload))


# One cookie per identity, never a shared one: require_identity caches the
# resolved session against the credential, so reusing a cookie for a second
# person hands them the first person's identity and the test passes wrongly.
def auth(cookie: str = "jane") -> dict[str, str]:
    return {"cookie": f"session={cookie}"}


def make_object(db: Session, object_id: str = OBJECT_ID, *, owner_user_id: int = 7) -> Widget:
    """One taggable object owned by Jane, in the default org."""
    return make_widget(db, object_id=object_id, owner_user_id=owner_user_id)


def owned_object(db: Session, object_id: str = OBJECT_ID) -> Widget:
    """Jane, signed in, with one object of hers.

    The Redash session mock is set from inside the test body rather than from a
    fixture on purpose: @respx.mock wraps the test function, so a fixture would
    run before any route is registered and the call would escape to the network.
    """
    as_user(JANE)
    return make_object(db, object_id)


def put_tags(api: TestClient, kind: str, object_id: str, tags: list[str], cookie: str = "jane") -> httpx.Response:
    # Bound to a typed name rather than returned straight through: the installed
    # TestClient shim types its verbs as Any, and strict mypy refuses to return
    # that from a declared httpx.Response.
    response: httpx.Response = api.put(f"/tags/{kind}/{object_id}", json={"tags": tags}, headers=auth(cookie))
    return response


def vocabulary(api: TestClient, cookie: str = "jane") -> list[dict[str, Any]]:
    response = api.get("/tags", headers=auth(cookie))
    assert response.status_code == 200
    return list(response.json())


def object_tags(db: Session, object_id: str = OBJECT_ID, org_slug: str = "default") -> list[str]:
    """What is actually stored, read through the service the readers use.

    This used to be `GET /kpis/{id}` and read the `tags` key off the response.
    There is no read endpoint for a widget, and going at the table through
    `tag_service.tags_for` is the stronger half of what that assertion was for
    anyway: it is the rows, not the echo.
    """
    return list(tag_service.tags_for(db, org_slug, KIND, object_id))

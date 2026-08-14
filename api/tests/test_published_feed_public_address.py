"""A public feed's address is claimed across the whole instance, not per org.

Its own file rather than more of `test_published_feed_refusals.py`, because it
is a different kind of refusal. Everything there is the caller's own binding
being wrong in a way the caller can see and fix. These are about a namespace
shared with tenants the caller cannot see at all, which is what makes both the
status code and the wording of the message load-bearing.

The constraint is migration 0013's partial unique index on `slug` where
`visibility = 'public'`. It exists because `GET /public/feeds/<slug>` has no org
segment: without it, two orgs could each hold a `public` feed at one slug and
the endpoint would have no way to say which was meant.
"""

from typing import Any

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.publish_stubs import make_feed
from tests.published_feed_route_stubs import ADMIN, BODY, BOUND_COLUMNS, ORG, as_user, create, set_columns
from veodyn_api.models.published_feed import PublishedFeed


@respx.mock
def test_claiming_another_orgs_public_address_is_a_409_not_a_500(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The colliding row belongs to a DIFFERENT org, so `create_feed`'s
    pre-check on the caller's own primary key finds nothing and the index is
    what refuses. Without the constraint-name branch there, this is a 500 out of
    psycopg naming an index the caller has never heard of.
    """
    make_feed(db, org_slug="someone-else", slug="taken", visibility="public")
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)

    response = create(api, {**BODY, "slug": "taken", "visibility": "public"})

    assert response.status_code == 409
    payload: dict[str, Any] = response.json()
    assert payload["error"]["id"] == "VEODYN_PUBLISHED_FEED_PUBLIC_ADDRESS_TAKEN"
    # Refused, and nothing landed in the caller's own org either.
    assert db.get(PublishedFeed, (ORG, "taken")) is None


@respx.mock
def test_the_refusal_does_not_name_the_org_that_holds_the_address(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A global namespace refusing on behalf of another tenant. Naming that
    tenant would turn this endpoint into an enumerator of which orgs exist, one
    guessed slug at a time. The caller gets what they can act on: the address is
    unavailable."""
    make_feed(db, org_slug="secret-competitor", slug="taken", visibility="public")
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)

    response = create(api, {**BODY, "slug": "taken", "visibility": "public"})

    message = response.json()["error"]["message"]
    assert "taken" in message
    assert "secret-competitor" not in message


@respx.mock
def test_the_same_slug_is_free_while_the_other_orgs_feed_is_private(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The control for both tests above. The index is partial, so a private feed
    elsewhere reserves nothing; without this case, a constraint that wrongly
    locked every slug globally, private ones included, would pass them both."""
    make_feed(db, org_slug="someone-else", slug="taken", visibility="private")
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)

    response = create(api, {**BODY, "slug": "taken", "visibility": "public"})

    assert response.status_code == 201


@respx.mock
def test_going_public_onto_a_taken_address_is_refused_on_edit_too(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An edit can claim the address as surely as a create can, by flipping
    `private` to `public` on a slug someone else already publishes at. That
    path commits separately and had no integrity handling at all, so this was a
    500 leaving the binding mid-edit."""
    make_feed(db, org_slug="someone-else", slug="taken", visibility="public")
    as_user(ADMIN)
    set_columns(monkeypatch, BOUND_COLUMNS)
    assert create(api, {**BODY, "slug": "taken", "visibility": "private"}).status_code == 201

    response = api.put(
        "/published-feeds/taken",
        json={**BODY, "slug": "taken", "visibility": "public"},
        headers={"cookie": "session=ada"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["id"] == "VEODYN_PUBLISHED_FEED_PUBLIC_ADDRESS_TAKEN"
    # The binding is still there and still private: a refused edit changes
    # nothing, rather than leaving a half-applied revision behind. This is the
    # half the status code alone does not prove, and the half that would break
    # if the router raised without rolling back first, since the app and this
    # test share one session.
    feed = db.get(PublishedFeed, (ORG, "taken"))
    assert feed is not None
    assert feed.visibility == "private"

"""Favorites: whose star it is, what it may point at, and when it goes.

A favorite is per PERSON, not per org, which is the assertion most of this file
is making from different angles: two people in one org, and one person in two
orgs, must never see each other's stars.

The starred objects are the two kinds `tests/fixture_objects.py` registers,
because `kpi` and `report` left with the pack. Grouping by kind is a property
this file tests, so it needs two of them; see that module for why they share a
table.
"""

from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import REDASH_TEST_URL, session_payload
from tests.fixture_objects import FIXTURE_KIND, SECOND_FIXTURE_KIND, make_widget
from veodyn_api.services import favorites as favorite_service

REDASH = REDASH_TEST_URL

JANE = session_payload(user_id=7, name="Jane Analyst", email="jane@x.org")
SAM = session_payload(user_id=9, name="Sam Other", email="sam@x.org")
JANE_ELSEWHERE = session_payload(user_id=7, name="Jane Analyst", email="jane@x.org", org_slug="other")

KIND = FIXTURE_KIND
SECOND_KIND = SECOND_FIXTURE_KIND
OBJECT_ID = "on-time-performance"
SECOND_OBJECT_ID = "q3-review"

EMPTY: dict[str, list[str]] = {KIND: [], SECOND_KIND: []}


@pytest.fixture(autouse=True)
def _kinds(fixture_kind: str) -> Iterator[None]:
    yield


def as_user(payload: dict[str, Any]) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(200, json=payload))


# One cookie per identity, never a shared one. require_identity caches the
# resolved session against the credential, so reusing a cookie value for a
# second person hands them the first person's identity and the test passes for
# the wrong reason.
def auth(cookie: str = "jane") -> dict[str, str]:
    return {"cookie": f"session={cookie}"}


def make_object(db: Session, object_id: str = OBJECT_ID) -> None:
    make_widget(db, object_id=object_id)


def favorites(api: TestClient, cookie: str = "jane") -> dict[str, list[str]]:
    response = api.get("/favorites", headers=auth(cookie))
    assert response.status_code == 200
    return dict(response.json())


def sam_favorites(api: TestClient) -> dict[str, list[str]]:
    return favorites(api, "sam")


def elsewhere_favorites(api: TestClient) -> dict[str, list[str]]:
    """Jane again, in the other tenant, so a different session of her own."""
    return favorites(api, "jane-other")


@respx.mock
def test_a_star_is_added_read_back_and_removed(api: TestClient, db: Session) -> None:
    as_user(JANE)
    make_object(db)

    assert favorites(api) == EMPTY

    assert api.post(f"/favorites/{KIND}/{OBJECT_ID}", headers=auth()).status_code == 204
    assert favorites(api) == {KIND: [OBJECT_ID], SECOND_KIND: []}

    assert api.delete(f"/favorites/{KIND}/{OBJECT_ID}", headers=auth()).status_code == 204
    assert favorites(api) == EMPTY


@respx.mock
def test_both_kinds_are_kept_apart(api: TestClient, db: Session) -> None:
    as_user(JANE)
    make_object(db)
    make_object(db, SECOND_OBJECT_ID)

    api.post(f"/favorites/{KIND}/{OBJECT_ID}", headers=auth())
    api.post(f"/favorites/{SECOND_KIND}/{SECOND_OBJECT_ID}", headers=auth())

    # Grouped, not a flat list: one kind's page marks its own rows and must not
    # have to know that another kind happens to share an id with one.
    assert favorites(api) == {KIND: [OBJECT_ID], SECOND_KIND: [SECOND_OBJECT_ID]}


@respx.mock
def test_pressing_the_same_star_twice_is_the_same_state(api: TestClient, db: Session) -> None:
    """Two tabs, or a double click. The second press is not a 409 and does not
    produce a second row."""
    as_user(JANE)
    make_object(db)

    assert api.post(f"/favorites/{KIND}/{OBJECT_ID}", headers=auth()).status_code == 204
    assert api.post(f"/favorites/{KIND}/{OBJECT_ID}", headers=auth()).status_code == 204

    assert favorites(api)[KIND] == [OBJECT_ID]


@respx.mock
def test_unstarring_something_never_starred_is_not_an_error(api: TestClient, db: Session) -> None:
    as_user(JANE)
    make_object(db)

    assert api.delete(f"/favorites/{KIND}/{OBJECT_ID}", headers=auth()).status_code == 204


@respx.mock
def test_a_star_cannot_be_hung_on_an_id_that_does_not_exist(api: TestClient) -> None:
    """The row would be invisible rather than wrong (favorites are read by
    intersecting with a list), which is exactly why it has to be refused here
    instead of discovered later."""
    as_user(JANE)

    response = api.post(f"/favorites/{KIND}/no-such-object", headers=auth())

    assert response.status_code == 404
    assert favorites(api)[KIND] == []


@respx.mock
def test_a_star_belongs_to_the_person_not_the_org(api: TestClient, db: Session) -> None:
    """The load-bearing test. One org, two people: Sam must not inherit Jane's
    star, and must be able to keep his own on the same object."""
    as_user(JANE)
    make_object(db)
    api.post(f"/favorites/{KIND}/{OBJECT_ID}", headers=auth())

    as_user(SAM)
    assert sam_favorites(api)[KIND] == []

    api.post(f"/favorites/{KIND}/{OBJECT_ID}", headers=auth("sam"))
    assert sam_favorites(api)[KIND] == [OBJECT_ID]

    # And Sam unstarring it leaves Jane's alone.
    api.delete(f"/favorites/{KIND}/{OBJECT_ID}", headers=auth("sam"))
    assert sam_favorites(api)[KIND] == []
    as_user(JANE)
    assert favorites(api)[KIND] == [OBJECT_ID]


@respx.mock
def test_a_star_does_not_cross_orgs(api: TestClient, db: Session) -> None:
    """Same Redash user id, different tenant. The object itself is not visible
    there, so neither is the star on it."""
    as_user(JANE)
    make_object(db)
    api.post(f"/favorites/{KIND}/{OBJECT_ID}", headers=auth())

    as_user(JANE_ELSEWHERE)
    assert elsewhere_favorites(api)[KIND] == []


@respx.mock
def test_deleting_the_object_takes_every_star_with_it(api: TestClient, db: Session) -> None:
    """Ids are minted from the name, so an object called the same thing again
    takes the same slug. Without this the new one would arrive pre-starred.

    Through `forget_object` rather than a delete endpoint, because that is the
    call a kind's own handler makes: the KPI and report routers each make it,
    and the community half of that contract is that the service really does
    drop everyone's star.
    """
    as_user(JANE)
    make_object(db)
    api.post(f"/favorites/{KIND}/{OBJECT_ID}", headers=auth())

    favorite_service.forget_object(db, "default", KIND, OBJECT_ID)
    db.commit()

    assert favorites(api)[KIND] == []


def test_favorites_need_a_credential(api: TestClient) -> None:
    assert api.get("/favorites").status_code == 401
    assert api.post(f"/favorites/{KIND}/anything").status_code == 401
    assert api.delete(f"/favorites/{KIND}/anything").status_code == 401


@respx.mock
def test_an_unknown_object_type_is_refused_by_the_route(api: TestClient) -> None:
    """A caller cannot invent a kind. The list is not written down in the router
    any more, it is whatever registered itself, so the refusal is a named 404
    from the registry rather than a 422 from a Literal on the path.

    404 and not 422 on purpose: "this build has no such kind" is the same answer
    as "no such object", and a 422 enumerating the kinds this build accepts
    would tell an unauthenticated caller which packs are installed."""
    as_user(JANE)

    refused = api.post("/favorites/dashboard/1", headers=auth())

    assert refused.status_code == 404
    assert refused.json()["error"]["id"] == "VEODYN_UNKNOWN_OBJECT_TYPE"
    assert api.get("/favorites", headers=auth()).json() == EMPTY


@respx.mock
def test_a_community_build_has_no_kpi_or_report_key_to_star(api: TestClient) -> None:
    """The deletion, from the wire. Those two keys were in every response this
    file used to assert; they are contributed by the pack now, so a community
    build neither lists them nor accepts a star against them."""
    as_user(JANE)

    listed = api.get("/favorites", headers=auth()).json()

    assert "kpi" not in listed
    assert "report" not in listed
    for kind in ("kpi", "report"):
        assert api.post(f"/favorites/{kind}/anything", headers=auth()).status_code == 404

"""Writing tags: replace semantics, normalization, the reserved prefix, and
whose tags they are.

A tag is an ORG-shared fact, which is what several of these assert from
different angles: it is not per person (unlike a favorite) and it never crosses
a tenant. The vocabulary read lives in test_tags_vocabulary.py and the dataset
half in test_tags_datasets.py, which needs the warehouse stubbed.

The object being tagged is the registered fixture kind rather than a KPI. See
tag_stubs.py for why that is the better test and not merely the only one left.
"""

from collections.abc import Iterator

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.tag_stubs import (
    JANE,
    JANE_ELSEWHERE,
    KIND,
    OBJECT_ID,
    SAM,
    as_user,
    make_object,
    object_tags,
    owned_object,
    put_tags,
    vocabulary,
)
from veodyn_api.services import tags as tag_service
from veodyn_api.services.tag_rules import MAX_TAG_LENGTH, MAX_TAGS_PER_OBJECT


@pytest.fixture(autouse=True)
def _kind(fixture_kind: str) -> Iterator[None]:
    """Every test here needs the kind registered, and none of them names it in
    its signature, so it goes on autouse rather than on fourteen parameters."""
    yield


@respx.mock
def test_a_second_put_replaces_the_set_rather_than_adding_to_it(api: TestClient, db: Session) -> None:
    """The load-bearing test for the write. An add-only implementation passes
    "the new tags are there", so the assertion that matters is that the OLD ones
    are gone, in the object AND in the vocabulary."""
    owned_object(db)
    assert put_tags(api, KIND, OBJECT_ID, ["rail", "ridership"]).json() == {"tags": ["rail", "ridership"]}

    second = put_tags(api, KIND, OBJECT_ID, ["bus"])

    assert second.json() == {"tags": ["bus"]}
    assert object_tags(db) == ["bus"]
    # The rows really went, not just the response: a stale row keeps voting here.
    assert [entry["name"] for entry in vocabulary(api)] == ["bus"]


@respx.mock
def test_an_empty_set_clears_every_tag(api: TestClient, db: Session) -> None:
    owned_object(db)
    put_tags(api, KIND, OBJECT_ID, ["rail"])

    assert put_tags(api, KIND, OBJECT_ID, []).json() == {"tags": []}
    assert object_tags(db) == []
    assert vocabulary(api) == []


@respx.mock
def test_a_reserved_domain_tag_is_refused_by_name_and_nothing_is_written(api: TestClient, db: Session) -> None:
    """Refused, not silently dropped: a person who types `domain:rail`, sees it
    vanish and concludes tagging is broken is worse served than one who is told
    the prefix is taken. And the whole write is refused, so the good tag beside
    it is not half-applied."""
    owned_object(db)
    put_tags(api, KIND, OBJECT_ID, ["rail"])

    refused = put_tags(api, KIND, OBJECT_ID, ["bus", "domain:transit"])

    assert refused.status_code == 422
    assert refused.json()["error"]["id"] == "VEODYN_TAG_PREFIX_RESERVED"
    assert "domain:transit" in refused.json()["error"]["message"]
    assert object_tags(db) == ["rail"]


@respx.mock
def test_the_reserved_prefix_is_judged_after_normalization(api: TestClient, db: Session) -> None:
    """Otherwise `  DOMAIN:Transit ` walks straight past the check and lands in
    the table as the very tag the check exists to keep out."""
    owned_object(db)
    refused = put_tags(api, KIND, OBJECT_ID, ["  DOMAIN:Transit "])

    assert refused.status_code == 422
    assert refused.json()["error"]["id"] == "VEODYN_TAG_PREFIX_RESERVED"
    assert object_tags(db) == []


@respx.mock
def test_the_body_refusals_are_three_causes_and_not_one(api: TestClient, db: Session) -> None:
    """The load-bearing test for the wire shape. All three answer 422, so a
    client branching on the status alone cannot tell them apart, and the one it
    guessed was the reserved prefix: somebody who typed a hundred and one
    characters was told `domain:` is taken. Asserting a SET of three distinct
    ids is what fails an implementation that folds the caps back into pydantic's
    generic VEODYN_INVALID_REQUEST, because the set then has two members."""
    owned_object(db)

    causes = [
        put_tags(api, KIND, OBJECT_ID, ["x" * (MAX_TAG_LENGTH + 1)]),
        put_tags(api, KIND, OBJECT_ID, [f"tag-{n}" for n in range(MAX_TAGS_PER_OBJECT + 1)]),
        put_tags(api, KIND, OBJECT_ID, ["domain:transit"]),
    ]

    assert [refused.status_code for refused in causes] == [422, 422, 422]
    assert [refused.json()["error"]["id"] for refused in causes] == [
        "VEODYN_TAG_TOO_LONG",
        "VEODYN_TOO_MANY_TAGS",
        "VEODYN_TAG_PREFIX_RESERVED",
    ]
    # Every one of them through the same envelope, so the client parses one
    # shape whichever rule said no.
    assert all("message" in refused.json()["error"] for refused in causes)
    assert object_tags(db) == []


@respx.mock
def test_a_tag_exactly_at_the_length_cap_is_stored(api: TestClient, db: Session) -> None:
    """The boundary, both sides of it. Without this the cap can be off by one in
    either direction and every other test still passes."""
    owned_object(db)
    at_the_cap = "x" * MAX_TAG_LENGTH

    assert put_tags(api, KIND, OBJECT_ID, [at_the_cap]).json() == {"tags": [at_the_cap]}
    assert put_tags(api, KIND, OBJECT_ID, [at_the_cap + "x"]).status_code == 422
    assert object_tags(db) == [at_the_cap]


@respx.mock
def test_a_padded_tag_is_measured_after_normalization(api: TestClient, db: Session) -> None:
    """The cap bounds what lands in the column, and normalization is what
    decides that. Measured on the raw string, this body is refused for a length
    nobody sent."""
    owned_object(db)
    padded = "  " + "x" * MAX_TAG_LENGTH + "  "

    assert put_tags(api, KIND, OBJECT_ID, [padded]).json() == {"tags": ["x" * MAX_TAG_LENGTH]}


@respx.mock
def test_exactly_the_maximum_number_of_tags_is_stored(api: TestClient, db: Session) -> None:
    owned_object(db)
    at_the_cap = [f"tag-{n:03d}" for n in range(MAX_TAGS_PER_OBJECT)]

    assert put_tags(api, KIND, OBJECT_ID, at_the_cap).json() == {"tags": at_the_cap}
    assert put_tags(api, KIND, OBJECT_ID, [*at_the_cap, "one-too-many"]).status_code == 422
    assert object_tags(db) == at_the_cap


@respx.mock
def test_two_spellings_of_one_tag_become_one_row(api: TestClient, db: Session) -> None:
    """Matching is exact and case-sensitive by design, so `  Rail  ` and `rail`
    stored apart would each find half the objects. The count is the assertion
    that matters: a response that merely dedupes what it echoes would still have
    written two rows."""
    owned_object(db)
    stored = put_tags(api, KIND, OBJECT_ID, ["  Rail  ", "rail", "On   Time", "on time"])

    assert stored.json() == {"tags": ["on time", "rail"]}
    assert vocabulary(api) == [{"name": "on time", "count": 1}, {"name": "rail", "count": 1}]


@respx.mock
def test_a_tag_that_normalizes_to_nothing_is_dropped(api: TestClient, db: Session) -> None:
    """A chip with no text is not a label, and storing one puts a blank in the
    vocabulary that nobody can select or remove."""
    owned_object(db)
    assert put_tags(api, KIND, OBJECT_ID, ["rail", "", "   ", "\t\n"]).json() == {"tags": ["rail"]}


@respx.mock
def test_tagging_something_that_does_not_exist_is_a_404(api: TestClient) -> None:
    """The kind is registered and the object is not there. The cause comes from
    the descriptor's own guard, which is what makes this a 404 before any
    ownership comparison: a 403 would confirm the row exists in another tenant."""
    as_user(JANE)

    missing = put_tags(api, KIND, "no-such-object", ["rail"])

    assert missing.status_code == 404
    assert missing.json()["error"]["id"] == "VEODYN_UNKNOWN_OBJECT_TYPE"
    # And nothing was written on the way to the refusal.
    assert vocabulary(api) == []


@respx.mock
def test_tags_do_not_cross_orgs(api: TestClient, db: Session) -> None:
    """Same Redash user id, different tenant. The object itself is not visible
    there, so neither the tag on it nor the write to it is."""
    as_user(JANE)
    make_object(db)
    put_tags(api, KIND, OBJECT_ID, ["rail"])

    as_user(JANE_ELSEWHERE)
    assert vocabulary(api, "jane-other") == []
    assert put_tags(api, KIND, OBJECT_ID, ["bus"], "jane-other").status_code == 404

    # And the other tenant's refused write did not disturb the real one.
    as_user(JANE)
    assert object_tags(db) == ["rail"]


@respx.mock
def test_deleting_the_object_takes_its_tags_with_it(api: TestClient, db: Session) -> None:
    """Ids are minted from the name, so the same name takes the same slug again.
    A leftover row would both pre-tag the new object and keep inflating the
    vocabulary count for something that no longer exists.

    Through `forget_object` rather than an endpoint, because that is the call a
    kind's own delete handler makes and it is the community half of this: the
    enterprise routers each call it, and this is what says it works.
    """
    as_user(JANE)
    make_object(db)
    put_tags(api, KIND, OBJECT_ID, ["rail"])

    tag_service.forget_object(db, "default", KIND, OBJECT_ID)
    db.commit()

    assert vocabulary(api) == []
    assert object_tags(db) == []


@respx.mock
def test_only_the_owner_or_an_admin_may_tag_an_object(api: TestClient, db: Session) -> None:
    """The descriptor's own rule, applied by the router without knowing it.

    Deleting the `authorize_tag_write` call from `routers/tags.py` is what this
    catches, and the fixture kind's guard is the KPI rule verbatim for exactly
    that reason: a kind whose guard does nothing cannot show that the router
    still asks.
    """
    as_user(JANE)
    make_object(db)

    as_user(SAM)
    refused = put_tags(api, KIND, OBJECT_ID, ["rail"], "sam")

    assert refused.status_code == 403
    assert refused.json()["error"]["id"] == "VEODYN_FORBIDDEN"
    assert object_tags(db) == []


def test_tagging_needs_a_credential(api: TestClient) -> None:
    assert api.get("/tags").status_code == 401
    assert api.put(f"/tags/{KIND}/anything", json={"tags": []}).status_code == 401


@respx.mock
def test_an_unknown_object_type_is_refused_by_the_route(api: TestClient) -> None:
    """A caller cannot invent a taggable kind. The list is not written down in
    the router any more, it is whatever registered itself, so the refusal is a
    named 404 from the registry rather than a 422 from a Literal on the path,
    and nothing is written on the way to it.

    404 and not 422 on purpose: "this build has no such kind" is the same answer
    as "no such object", and a 422 enumerating the kinds this build accepts
    would tell an unauthenticated caller which packs are installed."""
    as_user(JANE)

    refused = put_tags(api, "dashboard", "1", ["rail"])

    assert refused.status_code == 404
    assert refused.json()["error"]["id"] == "VEODYN_UNKNOWN_OBJECT_TYPE"
    assert vocabulary(api) == []


@respx.mock
def test_a_kind_the_pack_owns_is_not_taggable_in_a_community_build(api: TestClient) -> None:
    """The deletion, from the wire. `kpi` and `report` are registered by the
    enterprise pack, so a community build answers the same 404 it answers for a
    kind nobody ever wrote."""
    as_user(JANE)

    for kind in ("kpi", "report"):
        refused = put_tags(api, kind, "anything", ["rail"])

        assert refused.status_code == 404
        assert refused.json()["error"]["id"] == "VEODYN_UNKNOWN_OBJECT_TYPE"

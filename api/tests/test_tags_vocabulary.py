"""The tag vocabulary.

The vocabulary is global rather than per entity type on purpose: tagging one
kind `rail` should suggest the `rail` already sitting on another, which is the
whole point of cross-entity pivoting. That property needs two kinds to be
visible at all, so `tests/fixture_objects.py` registers two.

The half of this file that asserted a KPI or a report response carries its tags
went to the pack with those routers. It is the routers' response shape, not the
vocabulary, and there is nothing in a community build to assert it against.
"""

from collections.abc import Iterator

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.tag_stubs import (
    JANE,
    KIND,
    OBJECT_ID,
    SECOND_KIND,
    SECOND_OBJECT_ID,
    as_user,
    make_object,
    object_tags,
    put_tags,
    vocabulary,
)
from veodyn_api.models import TagAssignment
from veodyn_api.services.tag_rules import normalize_all


@pytest.fixture(autouse=True)
def _kinds(fixture_kind: str) -> Iterator[None]:
    yield


def two_objects(db: Session) -> None:
    """One row per kind. Both kinds sit on the same table, so this is two rows
    with different ids and the object_type is what tells them apart."""
    make_object(db, OBJECT_ID)
    make_object(db, SECOND_OBJECT_ID)


@respx.mock
def test_the_vocabulary_sums_one_tag_across_kinds(api: TestClient, db: Session) -> None:
    """A per-kind count would report two separate ones here and defeat the
    point of a shared vocabulary."""
    as_user(JANE)
    two_objects(db)
    put_tags(api, KIND, OBJECT_ID, ["rail", "ridership"])
    put_tags(api, SECOND_KIND, SECOND_OBJECT_ID, ["rail"])

    assert vocabulary(api) == [
        {"name": "rail", "count": 2},
        {"name": "ridership", "count": 1},
    ]


@respx.mock
def test_the_vocabulary_hides_reserved_tags_that_are_already_stored(api: TestClient, db: Session) -> None:
    """Written straight to the table, because the endpoint refuses to make one.
    A row predating the refusal must still never be suggested: an autocomplete
    offering `domain:transit` invites someone to delete a hub by accident."""
    as_user(JANE)
    make_object(db)
    put_tags(api, KIND, OBJECT_ID, ["rail"])
    db.add(TagAssignment(org_slug="default", object_type=KIND, object_id=OBJECT_ID, tag="domain:transit"))
    db.commit()

    assert vocabulary(api) == [{"name": "rail", "count": 1}]


@respx.mock
def test_the_vocabulary_is_ordered_by_use_then_by_name(api: TestClient, db: Session) -> None:
    as_user(JANE)
    two_objects(db)
    put_tags(api, KIND, OBJECT_ID, ["alpha", "rail"])
    put_tags(api, SECOND_KIND, SECOND_OBJECT_ID, ["rail", "zulu"])

    # rail leads on count; alpha and zulu tie at one and break by name rather
    # than by whatever order the group-by happened to produce.
    assert [entry["name"] for entry in vocabulary(api)] == ["rail", "alpha", "zulu"]


def test_the_set_to_store_is_sorted_deduped_and_stripped_of_blanks() -> None:
    """The sort that decides the wire order, asserted where it can actually
    fail. End to end it cannot: the assignment table's primary key ends in
    `tag`, so Postgres hands the rows back in tag order whether or not anything
    sorted them, and an HTTP-level assertion would pass an implementation that
    dropped every sorted() in the module."""
    assert normalize_all(["  Zebra ", "alpha", "ZEBRA", "", "  ", "On   Time"]) == ["alpha", "on time", "zebra"]


@respx.mock
def test_a_tag_written_outside_the_endpoint_still_reads_back(api: TestClient, db: Session) -> None:
    """The read path does not depend on the write path having normalized or
    ordered anything: it is a plain projection of the rows for that object."""
    as_user(JANE)
    make_object(db)
    for tag in ("zebra", "mango", "alpha"):
        db.add(TagAssignment(org_slug="default", object_type=KIND, object_id=OBJECT_ID, tag=tag))
    db.commit()

    assert object_tags(db) == ["alpha", "mango", "zebra"]

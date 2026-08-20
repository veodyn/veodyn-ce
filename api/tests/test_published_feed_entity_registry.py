"""The entity vocabulary: what `entity` may name per standard, and how a pack
widens it.

`schemas/published_feed.py` validates `entity` against `published_feed_registry` rather
than pinning a `Literal`, because `api/openapi.json` is committed and diffed in
CI and a dynamic `Literal` would make that contract depend on which pack is
installed (design section 4, `2026-08-14-feeds-ce-ee-split-design.md`).

`test_an_unregistered_entity_is_refused_naming_what_is_supported` goes through
the real HTTP path, alongside every other binding refusal in
`test_published_feed_refusals.py`, because that is the pipeline a caller
actually uses. `test_registering_an_entity_through_the_pack_seam_widens_the_
schema` goes straight at the schema instead, because that is the only way to
prove the registration seam actually works rather than merely exists: nothing
in this process registers `trip_updates` at import, so this test is standing in
for an enterprise pack's own registration module.

`test_a_one_argument_registration_still_means_gtfs_rt` guards that same pack
from the other side: it lives in another repository and calls
`register_entity(entity)` with one argument, so the standard parameter's
default is a contract rather than a convenience.
"""

import pytest
import respx
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session

from tests.published_feed_route_stubs import ADMIN, BODY, as_user, auth, set_columns
from veodyn_api.schemas.published_feed import PublishedFeedIn
from veodyn_api.services import published_feed_registry


@respx.mock
def test_an_unregistered_entity_is_refused_naming_what_is_supported(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    as_user(ADMIN)
    set_columns(monkeypatch, ("bus", "lat", "lon"))

    response = api.post("/published-feeds", json={**BODY, "entity": "trip_updates"}, headers=auth())

    assert response.status_code == 422
    payload = response.json()
    assert payload["error"]["id"] == "VEODYN_INVALID_REQUEST"
    message = payload["error"]["message"]
    # A person should read this as "this deployment does not support that
    # entity" and see what it does support, not parse a bare enum mismatch.
    assert "trip_updates" in message
    assert "not a supported entity in this deployment" in message
    assert "vehicle_positions" in message


def test_community_seeds_the_entities_its_serializers_write() -> None:
    assert published_feed_registry.entities("gtfs-rt") == frozenset({"vehicle_positions"})
    assert published_feed_registry.entities("gbfs") == frozenset({"stations", "vehicles"})
    assert published_feed_registry.standards() == frozenset({"gtfs-rt", "gbfs"})


def test_a_name_registered_under_one_standard_is_not_registered_under_the_other() -> None:
    """The point of keying by standard: `stations` is a real GBFS entity and not
    a GTFS-Realtime one, so a flat set would accept it under either."""
    assert published_feed_registry.is_registered("stations", "gbfs")
    assert not published_feed_registry.is_registered("stations", "gtfs-rt")
    assert published_feed_registry.is_registered("vehicle_positions", "gtfs-rt")
    assert not published_feed_registry.is_registered("vehicle_positions", "gbfs")


def test_an_unknown_standard_reads_as_empty_rather_than_raising() -> None:
    assert published_feed_registry.entities("gtfs-static") == frozenset()
    assert not published_feed_registry.is_registered("shapes", "gtfs-static")


def test_versions_are_declared_per_standard() -> None:
    assert published_feed_registry.VERSIONS_BY_STANDARD["gtfs-rt"] == ("2.0",)
    assert published_feed_registry.VERSIONS_BY_STANDARD["gbfs"] == ("2.3", "3.0")


def test_a_one_argument_registration_still_means_gtfs_rt() -> None:
    """The enterprise pack calls `register_entity(entity)` from another
    repository. Dropping the default breaks its build with nothing in this tree
    to notice."""
    with published_feed_registry.restored_entities():
        published_feed_registry.register_entity("trip_updates")

        assert published_feed_registry.is_registered("trip_updates", "gtfs-rt")
        assert not published_feed_registry.is_registered("trip_updates", "gbfs")


def test_restoring_undoes_a_widening_of_an_existing_standard() -> None:
    """A shallow copy of the dict shares its sets, so the restore would keep the
    registration it was meant to drop. Asserted per standard for that reason."""

    def snapshot() -> dict[str, frozenset[str]]:
        standards = published_feed_registry.standards()
        return {standard: published_feed_registry.entities(standard) for standard in standards}

    before = snapshot()

    with published_feed_registry.restored_entities():
        published_feed_registry.register_entity("trip_updates", "gtfs-rt")
        published_feed_registry.register_entity("geofencing_zones", "gbfs")

    assert snapshot() == before


def test_restoring_undoes_a_whole_new_standard() -> None:
    with published_feed_registry.restored_entities():
        published_feed_registry.register_entity("shapes", "gtfs-static")
        assert "gtfs-static" in published_feed_registry.standards()

    assert "gtfs-static" not in published_feed_registry.standards()


def test_registering_an_entity_through_the_pack_seam_widens_the_schema() -> None:
    body = {**BODY, "slug": "alerts", "entity": "trip_updates"}

    # Before: the registry has never heard of trip_updates, so the schema
    # refuses it, matching community's seeded vocabulary of one.
    with pytest.raises(ValidationError, match="trip_updates"):
        PublishedFeedIn(**body)

    with published_feed_registry.restored_entities():
        published_feed_registry.register_entity("trip_updates")
        # During: the same value the line above refused now constructs clean.
        # No exception is the assertion; a raise here fails the test.
        PublishedFeedIn(**body)

    # After: restored_entities() put the registry back exactly as it found it,
    # so the widening was scoped to the `with` rather than leaking into every
    # test collected after this one -- including the vocabulary ratchet in
    # test_gtfs_field_vocabulary.py, which asserts the registry holds exactly
    # community's own seed.
    with pytest.raises(ValidationError, match="trip_updates"):
        PublishedFeedIn(**body)

"""The entity vocabulary: what `entity` may name, and how a pack widens it.

`schemas/published_feed.py` validates `entity` against `feed_registry` rather
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
"""

import pytest
import respx
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session

from tests.published_feed_route_stubs import ADMIN, BODY, as_user, auth, set_columns
from veodyn_api.schemas.published_feed import PublishedFeedIn
from veodyn_api.services import feed_registry


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


def test_registering_an_entity_through_the_pack_seam_widens_the_schema() -> None:
    body = {**BODY, "slug": "alerts", "entity": "trip_updates"}

    # Before: the registry has never heard of trip_updates, so the schema
    # refuses it, matching community's seeded vocabulary of one.
    with pytest.raises(ValidationError, match="trip_updates"):
        PublishedFeedIn(**body)

    with feed_registry.restored_entities():
        feed_registry.register_entity("trip_updates")
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

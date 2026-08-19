"""The binding wire contract, straight at the schema.

The cross-field rules here need `standard` to decide anything, so they cannot be
field validators and cannot be reached one field at a time. Driven without HTTP
because the router adds two Redash reads that say nothing about the shape.
"""

from typing import Any

import pytest
from pydantic import ValidationError

from veodyn_api.schemas.published_feed import PublishedFeedIn

SYSTEM_23 = {
    "system_id": "metro",
    "language": "en",
    "name": "Metro Bikes",
    "timezone": "America/Los_Angeles",
}


def _body(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "slug": "bikes-live",
        "queryId": 7,
        "standard": "gbfs",
        "version": "2.3",
        "entity": "stations",
        "systemInfo": dict(SYSTEM_23),
        "sourceColumn": None,
        "columnMap": {"station_id": "sid"},
        "onError": "block",
        "lastGoodMaxAgeSeconds": None,
        "visibility": "private",
    }
    base.update(overrides)
    return base


def _gtfs_rt(**overrides: Any) -> dict[str, Any]:
    body = _body(
        standard="gtfs-rt",
        version="2.0",
        entity="vehicle_positions",
        systemInfo=None,
        staticGtfsRef="https://example.org/gtfs.zip",
    )
    body.update(overrides)
    return body


def test_gbfs_binding_is_accepted() -> None:
    body = PublishedFeedIn.model_validate(_body())

    assert body.standard == "gbfs"
    assert body.static_gtfs_ref is None
    assert body.system_info == SYSTEM_23


def test_gbfs_refuses_a_static_gtfs_ref() -> None:
    with pytest.raises(ValidationError, match="static"):
        PublishedFeedIn.model_validate(_body(staticGtfsRef="https://x/gtfs.zip"))


def test_gtfs_rt_still_requires_the_static_ref() -> None:
    with pytest.raises(ValidationError, match="static"):
        PublishedFeedIn.model_validate(_gtfs_rt(staticGtfsRef=None))


def test_a_blank_static_ref_is_not_a_static_ref() -> None:
    """The field lost its `min_length=1` when it became optional, so the model
    validator is now the only thing between a whitespace ref and the DB CHECK,
    which reads it as present."""
    with pytest.raises(ValidationError, match="static"):
        PublishedFeedIn.model_validate(_gtfs_rt(staticGtfsRef="   "))


def test_a_blank_static_ref_on_a_gbfs_body_is_stored_as_null() -> None:
    """A blank read as absent HERE and as NOT NULL in PostgreSQL is a 500 out of
    ck_published_feed_static_ref_matches_standard at COMMIT. It has to collapse
    to None so the value that reaches the column is the one this judged."""
    for blank in ("", "   "):
        parsed = PublishedFeedIn.model_validate(_body(staticGtfsRef=blank))
        assert parsed.static_gtfs_ref is None


def test_gtfs_rt_is_accepted_unchanged() -> None:
    body = PublishedFeedIn.model_validate(_gtfs_rt())

    assert body.system_info is None
    assert body.static_gtfs_ref == "https://example.org/gtfs.zip"


def test_gtfs_rt_refuses_system_info() -> None:
    with pytest.raises(ValidationError, match="system information"):
        PublishedFeedIn.model_validate(_gtfs_rt(systemInfo=dict(SYSTEM_23)))


def test_gbfs_requires_system_info() -> None:
    with pytest.raises(ValidationError, match="system information"):
        PublishedFeedIn.model_validate(_body(systemInfo=None))


def test_version_is_validated_per_standard() -> None:
    with pytest.raises(ValidationError, match="2.3, 3.0"):
        PublishedFeedIn.model_validate(_body(version="2.0"))


def test_the_gtfs_rt_version_set_is_still_one_value() -> None:
    with pytest.raises(ValidationError, match="2.0"):
        PublishedFeedIn.model_validate(_gtfs_rt(version="2.3"))


def test_three_zero_is_accepted_with_its_extra_system_fields() -> None:
    info = dict(SYSTEM_23, opening_hours="24/7", feed_contact_email="ops@metro.example")

    body = PublishedFeedIn.model_validate(_body(version="3.0", systemInfo=info))

    assert body.version == "3.0"
    # The binding declares one `language`; the 3.0 serializer writes it out as
    # `languages`. The input key is the singular one.
    assert body.system_info is not None and body.system_info["language"] == "en"


def test_three_zero_requires_the_two_extra_system_fields() -> None:
    with pytest.raises(ValidationError, match="feed_contact_email"):
        PublishedFeedIn.model_validate(_body(version="3.0"))


def test_a_blank_system_field_reads_as_missing() -> None:
    with pytest.raises(ValidationError, match="timezone"):
        PublishedFeedIn.model_validate(_body(systemInfo=dict(SYSTEM_23, timezone="  ")))


def test_system_info_refuses_unknown_keys() -> None:
    info = dict(SYSTEM_23, colour="red")

    with pytest.raises(ValidationError, match="colour"):
        PublishedFeedIn.model_validate(_body(systemInfo=info))


def test_a_two_three_binding_may_not_carry_the_three_zero_extras() -> None:
    """2.3's `system_information.json` has no place to put them, so accepting
    them would store a declaration nothing ever serves."""
    info = dict(SYSTEM_23, opening_hours="24/7", feed_contact_email="ops@metro.example")

    with pytest.raises(ValidationError, match="opening_hours"):
        PublishedFeedIn.model_validate(_body(systemInfo=info))


def test_entity_is_validated_within_the_standard() -> None:
    with pytest.raises(ValidationError, match="stations"):
        PublishedFeedIn.model_validate(_body(entity="vehicle_positions"))

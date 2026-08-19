"""What 0014 makes optional, what it adds, and what the two tables refuse.

Both halves are asserted against `Base.metadata`, because that is the schema
every database test is built from while production gets its own from the
migration. `test_published_feed_model.py` runs the chain and compares the two
copies, so a constraint declared here and not there is named there.
"""

from typing import Any

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed

SYSTEM_INFO = {
    "system_id": "acme_bikes",
    "language": "en",
    "name": "Acme Bikes",
    "timezone": "America/New_York",
}

FILES: dict[str, Any] = {"gbfs.json": {"version": "2.3"}}


def _binding(**overrides: Any) -> PublishedFeed:
    fields: dict[str, Any] = {
        "org_slug": "acme",
        "slug": "vehicles",
        "revision": 1,
        "query_id": 42,
        "standard": "gtfs-rt",
        "version": "2.0",
        "entity": "vehicle_positions",
        "static_gtfs_ref": "https://example.org/gtfs.zip",
        "system_info": None,
        "source_column": None,
        "column_map": {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"},
        "on_error": "block",
        "last_good_max_age_seconds": None,
        "visibility": "private",
        "created_by_user_id": 7,
    }
    fields.update(overrides)
    return PublishedFeed(**fields)


def _gbfs_binding(**overrides: Any) -> PublishedFeed:
    fields: dict[str, Any] = {
        "standard": "gbfs",
        "version": "2.3",
        "entity": "stations",
        "static_gtfs_ref": None,
        "system_info": SYSTEM_INFO,
        "column_map": {"station_id": "id", "name": "label", "lat": "lat", "lon": "lon"},
    }
    fields.update(overrides)
    return _binding(**fields)


def _attempt(**overrides: Any) -> PublishAttempt:
    fields: dict[str, Any] = {
        "org_slug": "acme",
        "slug": "vehicles",
        "binding_revision": 1,
        "query_result_id": 999,
        "decision": "published",
        "reason": "",
        "feed_bytes": None,
        "feed_files": None,
        "feed_timestamp": 1800,
        "is_current": False,
    }
    fields.update(overrides)
    return PublishAttempt(**fields)


def test_static_gtfs_ref_is_nullable_and_gated_by_standard() -> None:
    names = {constraint.name for constraint in PublishedFeed.__table__.constraints}

    assert PublishedFeed.__table__.c.static_gtfs_ref.nullable is True
    assert "ck_published_feed_static_ref_matches_standard" in names
    assert "ck_published_feed_system_info_matches_standard" in names


def test_system_info_column_exists_and_is_nullable() -> None:
    assert PublishedFeed.__table__.c.system_info.nullable is True


def test_attempt_artifact_checks_cover_both_kinds() -> None:
    names = {constraint.name for constraint in PublishAttempt.__table__.constraints}

    assert "ck_publish_attempt_artifact_matches_decision" in names
    assert "ck_publish_attempt_one_artifact_kind" in names
    assert "ck_publish_attempt_bytes_match_decision" not in names
    assert PublishAttempt.__table__.c.feed_files.nullable is True


def test_a_gbfs_binding_without_system_info_is_refused(db: Session) -> None:
    db.add(_gbfs_binding(system_info=None))
    with pytest.raises(IntegrityError):
        db.commit()


def test_a_gbfs_binding_carrying_a_static_ref_is_refused(db: Session) -> None:
    """The ref is not merely optional for gbfs, it is meaningless there."""
    db.add(_gbfs_binding(static_gtfs_ref="https://example.org/gtfs.zip"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_a_gtfs_rt_binding_still_requires_its_static_ref(db: Session) -> None:
    db.add(_binding(static_gtfs_ref=None))
    with pytest.raises(IntegrityError):
        db.commit()


def test_a_gtfs_rt_binding_may_not_carry_system_info(db: Session) -> None:
    db.add(_binding(system_info=SYSTEM_INFO))
    with pytest.raises(IntegrityError):
        db.commit()


def test_a_gbfs_binding_is_accepted(db: Session) -> None:
    """The half the four refusals cannot show: a constraint refusing every gbfs
    row would satisfy all of them."""
    db.add(_gbfs_binding())
    db.commit()

    stored = db.get(PublishedFeed, ("acme", "vehicles"))
    assert stored is not None
    assert stored.static_gtfs_ref is None
    assert stored.system_info == SYSTEM_INFO


def test_a_published_attempt_may_carry_files_instead_of_bytes(db: Session) -> None:
    db.add(_gbfs_binding())
    db.add(_attempt(feed_files=FILES))
    db.commit()

    stored = db.query(PublishAttempt).one()
    assert stored.feed_bytes is None
    assert stored.feed_files == FILES


def test_a_published_attempt_holding_neither_artifact_is_refused(db: Session) -> None:
    db.add(_binding())
    db.add(_attempt())
    with pytest.raises(IntegrityError):
        db.commit()


def test_files_on_a_blocked_attempt_are_refused(db: Session) -> None:
    """Same doctrine as bytes: a blocked attempt holding a servable artifact is
    one mistake away from being served."""
    db.add(_gbfs_binding())
    db.add(_attempt(decision="blocked", feed_files=FILES))
    with pytest.raises(IntegrityError):
        db.commit()


def test_an_attempt_carrying_both_artifact_kinds_is_refused(db: Session) -> None:
    db.add(_binding())
    db.add(_attempt(feed_bytes=b"\x01", feed_files=FILES))
    with pytest.raises(IntegrityError):
        db.commit()


def test_a_published_attempt_may_still_carry_bytes_alone(db: Session) -> None:
    db.add(_binding())
    db.add(_attempt(feed_bytes=b"\x01"))
    db.commit()

    stored = db.query(PublishAttempt).one()
    assert stored.feed_files is None

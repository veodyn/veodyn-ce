"""Reading and writing how often a capture is expected to deliver.

Separate from services/captures.py because that module is pure by design: every
lookup it needs is passed in, which is what makes the whole board testable
without a ClickHouse or a Redash. This one touches the database, so it stays out
of it.
"""

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.capture_expectation import CaptureExpectation

# One minute is the floor because it is the shortest cadence `cadence_label`
# has a name for, and an expectation the board cannot render is one nobody can
# check. The ceiling is thirty days: past that "late" stops being a useful
# statement about a capture and the row would only ever suppress the signal.
MIN_INTERVAL_SECONDS = 60
MAX_INTERVAL_SECONDS = 30 * 24 * 3600


def read_row(db: Session, *, org_slug: str, capture_id: str) -> CaptureExpectation | None:
    """The stored expectation for one capture, or None."""
    return db.get(CaptureExpectation, (org_slug, capture_id))


def read_alert_links(db: Session, org_slug: str) -> dict[str, int]:
    """Armed captures and their alert ids, keyed by capture id.

    One query for the whole board, same reason as read_expectations: a per-row
    read would be an N+1 on a page whose job is to load fast enough to glance
    at.
    """
    rows = db.execute(
        select(CaptureExpectation.feed_id, CaptureExpectation.alert_id).where(
            CaptureExpectation.org_slug == org_slug, CaptureExpectation.alert_id.is_not(None)
        )
    ).all()
    return {capture_id: alert_id for capture_id, alert_id in rows if alert_id is not None}


def read_expectations(db: Session, org_slug: str) -> dict[str, int]:
    """Every declared interval in this org, keyed by capture id.

    One query for the whole board rather than one per row: the list endpoint
    renders every capture, and a per-capture read would be an N+1 on a page
    whose entire job is to load fast enough to be glanced at.
    """
    rows = db.execute(
        select(CaptureExpectation.feed_id, CaptureExpectation.expected_interval_seconds).where(
            CaptureExpectation.org_slug == org_slug
        )
    ).all()
    return {capture_id: seconds for capture_id, seconds in rows}


def set_expectation(db: Session, *, org_slug: str, capture_id: str, seconds: int, user_id: int) -> None:
    """Declare, or redeclare, how often this capture should deliver.

    An upsert rather than a read-then-write: two operators setting an
    expectation on the same capture at once is a race the primary key can
    settle, and the loser's value being overwritten is the correct outcome for
    a field that holds one opinion.
    """
    if seconds < MIN_INTERVAL_SECONDS or seconds > MAX_INTERVAL_SECONDS:
        raise ApiError(
            ErrorId.CAPTURE_INTERVAL_INVALID,
            f"an expected interval has to be between {MIN_INTERVAL_SECONDS} and "
            f"{MAX_INTERVAL_SECONDS} seconds; got {seconds}",
            status_code=422,
        )
    statement = insert(CaptureExpectation).values(
        org_slug=org_slug,
        feed_id=capture_id,
        expected_interval_seconds=seconds,
        set_by_user_id=user_id,
    )
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[CaptureExpectation.org_slug, CaptureExpectation.feed_id],
            set_={
                "expected_interval_seconds": statement.excluded.expected_interval_seconds,
                "set_by_user_id": statement.excluded.set_by_user_id,
            },
        )
    )
    db.commit()


def store_alert_link(db: Session, *, org_slug: str, capture_id: str, query_id: int, alert_id: int) -> None:
    """Record the armed alert AFTER Redash has accepted it.

    Alert first, then this commit: the reverse order leaves a row claiming an
    alert that was never created, and nothing afterwards can tell that apart
    from an alert someone deleted. Same ordering rule as kpi_alert_sync.
    """
    row = db.get(CaptureExpectation, (org_slug, capture_id))
    if row is None:  # pragma: no cover - the caller wrote it a moment ago
        return
    row.alert_id = alert_id
    row.alert_query_id = query_id
    db.commit()


def clear_expectation(db: Session, *, org_slug: str, capture_id: str) -> None:
    """Drop the declaration, returning the capture to its Redash schedule.

    A delete rather than a zero, so "no expectation" has exactly one
    representation and nothing downstream has to decide whether a stored 0 means
    "not declared" or "declared as never".
    """
    db.execute(
        delete(CaptureExpectation).where(
            CaptureExpectation.org_slug == org_slug, CaptureExpectation.feed_id == capture_id
        )
    )
    db.commit()

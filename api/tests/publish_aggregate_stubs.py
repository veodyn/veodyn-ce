"""A feed with no query behind it, and the producer that builds one.

`publish_stubs.py` holds the query-backed binding every earlier publish module
drives. This holds its opposite number, shared by `test_publish_source_version.py`
and `test_publish_retire_on_failure.py` so the two cannot drift into testing
different feeds.
"""

from typing import Any

from sqlalchemy.orm import Session

from tests.publish_stubs import CLEAN, ROWS, make_feed
from tests.published_feed_route_stubs import ORG
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.publish_engine import AttemptResult, run_attempt
from veodyn_api.services.publish_produce import Produced, Production, Refused
from veodyn_api.services.published_feed_validator import ValidationOutcome

AGGREGATE_ENTITY = "fabricated_alerts"
AGGREGATE_BYTES = b"aggregate-artifact"


def never_validated(feed_bytes: bytes, static_ref: str, previous: bytes | None) -> ValidationOutcome:
    raise AssertionError("an aggregate producer builds and judges its own artifact")


class AggregateProducer:
    """A producer with no query and no validator seam, built from plain rows.

    It reads `production.rows` and nothing else, which is the whole point: the
    engine hands it the same argument it hands the query-backed one and does not
    know the difference.
    """

    def __init__(self, outcome: ValidationOutcome = CLEAN, refusal: str | None = None) -> None:
        self.outcome = outcome
        self.refusal = refusal

    def __call__(self, production: Production) -> Produced:
        if self.refusal is not None:
            raise Refused(self.refusal)
        return self.outcome, AGGREGATE_BYTES + str(len(production.rows)).encode(), None


def aggregate_feed(db: Session, **overrides: Any) -> PublishedFeed:
    fields: dict[str, Any] = {
        "org_slug": ORG,
        "slug": "alerts",
        "query_id": None,
        "entity": AGGREGATE_ENTITY,
        "column_map": {},
    }
    fields.update(overrides)
    return make_feed(db, **fields)


def publish_version(
    db: Session,
    feed: PublishedFeed,
    version: int,
    rows: list[dict[str, Any]] | None = None,
) -> AttemptResult:
    return run_attempt(
        db,
        feed,
        ROWS if rows is None else rows,
        query_result_id=None,
        feed_timestamp=1700,
        validate=never_validated,
        source_version=version,
    )

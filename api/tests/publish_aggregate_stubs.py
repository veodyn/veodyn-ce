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

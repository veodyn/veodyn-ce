from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.finding_json import findings_as_json
from veodyn_api.services.published_feed_validator import Finding, ValidationOutcome


@dataclass(frozen=True)
class AttemptResult:
    decision: str
    reason: str
    findings: tuple[Finding, ...]


@dataclass(frozen=True)
class AttemptSource:
    version: int
    query_result_id: int | None


def current_artifact(db: Session, feed: PublishedFeed) -> PublishAttempt | None:
    return db.execute(
        select(PublishAttempt).where(
            PublishAttempt.org_slug == feed.org_slug,
            PublishAttempt.slug == feed.slug,
            PublishAttempt.is_current.is_(True),
        )
    ).scalar_one_or_none()


def of_current_revision(artifact: PublishAttempt | None, feed: PublishedFeed) -> PublishAttempt | None:
    if artifact is None or artifact.binding_revision != feed.revision:
        return None
    return artifact


def previous_artifact_of_revision(db: Session, feed: PublishedFeed) -> PublishAttempt | None:
    return of_current_revision(current_artifact(db, feed), feed)


def published_high_water_mark(db: Session, feed: PublishedFeed) -> int | None:
    return db.execute(
        select(func.max(PublishAttempt.source_version)).where(
            PublishAttempt.org_slug == feed.org_slug,
            PublishAttempt.slug == feed.slug,
            PublishAttempt.binding_revision == feed.revision,
            PublishAttempt.decision == "published",
        )
    ).scalar()


def published_feed_timestamp_high_water_mark(db: Session, feed: PublishedFeed) -> int | None:
    return db.execute(
        select(func.max(PublishAttempt.feed_timestamp)).where(
            PublishAttempt.org_slug == feed.org_slug,
            PublishAttempt.slug == feed.slug,
            PublishAttempt.decision == "published",
        )
    ).scalar()


def a_header_timestamp_that_never_goes_backwards(db: Session, feed: PublishedFeed, generated_at: int) -> int:
    served = published_feed_timestamp_high_water_mark(db, feed)
    return generated_at if served is None else max(generated_at, served + 1)


def record(
    db: Session,
    feed: PublishedFeed,
    source: AttemptSource,
    decision: str,
    reason: str,
    outcome: ValidationOutcome | None = None,
    feed_bytes: bytes | None = None,
    feed_timestamp: int | None = None,
    feed_files: dict[str, Any] | None = None,
) -> AttemptResult:
    findings = outcome.findings if outcome is not None else ()
    db.add(
        PublishAttempt(
            org_slug=feed.org_slug,
            slug=feed.slug,
            binding_revision=feed.revision,
            query_result_id=source.query_result_id,
            source_version=source.version,
            decision=decision,
            reason=reason,
            feed_bytes=feed_bytes,
            feed_files=feed_files,
            feed_timestamp=feed_timestamp,
            findings=findings_as_json(findings),
            enabled_rules=list(outcome.enabled_rules) if outcome is not None else [],
            is_current=decision == "published",
        )
    )
    db.commit()
    return AttemptResult(decision=decision, reason=reason, findings=findings)


def the_artifact_this_attempt_is_entitled_to_retire(
    db: Session, feed: PublishedFeed, source: AttemptSource
) -> PublishAttempt | None:
    served = current_artifact(db, feed)
    if served is None or served.binding_revision != feed.revision:
        return None
    if served.source_version > source.version:
        return None
    return served


def record_and_retire_if_the_binding_says_to(
    db: Session,
    feed: PublishedFeed,
    source: AttemptSource,
    decision: str,
    reason: str,
    outcome: ValidationOutcome | None = None,
) -> AttemptResult:
    if feed.retire_on_failure:
        served = the_artifact_this_attempt_is_entitled_to_retire(db, feed, source)
        if served is not None:
            served.is_current = False
            db.flush()
    return record(db, feed, source, decision, reason, outcome)

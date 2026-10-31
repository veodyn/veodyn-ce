import logging
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import ColumnElement, Select, delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.settings import Settings, get_settings

logger = logging.getLogger(__name__)

PRUNE_BATCH_ROWS = 500

PUBLISHED = "published"

KeptAttempts = Callable[[str, str], Select[tuple[int]]]

ForgetAttempts = Callable[[Session, str, str, Sequence[int]], None]


@dataclass(frozen=True)
class RetentionNeeds:
    history: timedelta = timedelta(0)
    keeps: KeptAttempts | None = None
    forgets: ForgetAttempts | None = None


_NEEDS: list[RetentionNeeds] = []


def register_retention_needs(needs: RetentionNeeds) -> None:
    _NEEDS.append(needs)


def registered_retention_needs() -> tuple[RetentionNeeds, ...]:
    return tuple(_NEEDS)


@contextmanager
def restored_retention_needs() -> Iterator[None]:
    saved = list(_NEEDS)
    try:
        yield
    finally:
        _NEEDS[:] = saved


def retention_window(settings: Settings) -> timedelta | None:
    days = settings.publish_attempt_retention_days
    if days is None:
        return None
    return max([timedelta(days=days), *(needs.history for needs in _NEEDS)])


def _of_this_feed(org_slug: str, slug: str) -> tuple[ColumnElement[bool], ColumnElement[bool]]:
    return (PublishAttempt.org_slug == org_slug, PublishAttempt.slug == slug)


def the_newest_version_published_under_each_revision(org_slug: str, slug: str) -> Select[tuple[int]]:
    return (
        select(PublishAttempt.attempt_id)
        .where(*_of_this_feed(org_slug, slug), PublishAttempt.decision == PUBLISHED)
        .distinct(PublishAttempt.binding_revision)
        .order_by(
            PublishAttempt.binding_revision,
            PublishAttempt.source_version.desc(),
            PublishAttempt.attempt_id.desc(),
        )
    )


def the_newest_header_timestamp_published(org_slug: str, slug: str) -> Select[tuple[int]]:
    return (
        select(PublishAttempt.attempt_id)
        .where(
            *_of_this_feed(org_slug, slug),
            PublishAttempt.decision == PUBLISHED,
            PublishAttempt.feed_timestamp.is_not(None),
        )
        .order_by(PublishAttempt.feed_timestamp.desc(), PublishAttempt.attempt_id.desc())
        .limit(1)
    )


def _every_keeper() -> list[KeptAttempts]:
    packs = [needs.keeps for needs in _NEEDS if needs.keeps is not None]
    return [the_newest_version_published_under_each_revision, the_newest_header_timestamp_published, *packs]


def _expired_batch(db: Session, org_slug: str, slug: str, cutoff: datetime) -> list[int]:
    kept = [PublishAttempt.attempt_id.not_in(keeper(org_slug, slug)) for keeper in _every_keeper()]
    return list(
        db.scalars(
            select(PublishAttempt.attempt_id)
            .where(
                *_of_this_feed(org_slug, slug),
                PublishAttempt.created_at < cutoff,
                PublishAttempt.is_current.is_(False),
                *kept,
            )
            .order_by(PublishAttempt.attempt_id)
            .limit(PRUNE_BATCH_ROWS)
            .with_for_update(skip_locked=True)
        )
    )


def prune_expired_attempts(db: Session, org_slug: str, slug: str, *, now: datetime | None = None) -> int:
    window = retention_window(get_settings())
    if window is None:
        return 0
    cutoff = (now or datetime.now(UTC)) - window
    expired = _expired_batch(db, org_slug, slug, cutoff)
    if expired:
        for needs in _NEEDS:
            if needs.forgets is not None:
                needs.forgets(db, org_slug, slug, expired)
        doomed = PublishAttempt.attempt_id.in_(expired)
        db.execute(delete(PublishAttempt).where(*_of_this_feed(org_slug, slug), doomed))
    db.commit()
    return len(expired)


def prune_without_failing_the_attempt(db: Session, org_slug: str, slug: str) -> None:
    try:
        prune_expired_attempts(db, org_slug, slug)
    except SQLAlchemyError:
        db.rollback()
        logger.exception("pruning expired publish attempts for %s/%s failed", org_slug, slug)

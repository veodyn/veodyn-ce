"""Rows to a validated artifact, per standard.

Split from `publish_engine.py` at the file-size limit, and this is the seam
because it is the half with no database in it: each function takes rows and a
binding and answers with a verdict plus exactly one artifact kind, or refuses.

The engine keeps the decisions that need the table (ordering, the locked
revision re-read, the pointer move). What lives here is the part a second
standard duplicates, which is why adding one had to move it.

Both halves hold the same two rules. Serialization runs BEFORE validation, so a
mapping defect is named as a mapping defect rather than as whatever conformance
rule the bad bytes happen to trip. And every expected failure is a `Refused`
carrying the sentence to record, never an exception the worker has to catch.
"""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.gtfs_rt_serializer import SerializationError, serialize_vehicle_positions
from veodyn_api.services.published_feed_validator import ValidationOutcome, ValidatorUnavailable

# (feed_bytes, static_gtfs_ref, previous_feed) -> outcome.
Validate = Callable[[bytes, str, bytes | None], ValidationOutcome]

# The verdict, and exactly one of the two artifact kinds.
Produced = tuple[ValidationOutcome, bytes | None, dict[str, Any] | None]


@dataclass(frozen=True)
class GbfsPublisher:
    """The gbfs half of an attempt, injected the way `validate` is.

    Two callables rather than one so a mapping fault stays a mapping fault: a
    `SerializationError` out of `serialize` means `validate` was never called.
    """

    serialize: Callable[[list[dict[str, Any]], PublishedFeed, int], dict[str, Any]]
    # (files, version, shape): the shape decides which member files the
    # validator requires of the set.
    validate: Callable[[dict[str, Any], str, str], ValidationOutcome]


@dataclass(frozen=True)
class Production:
    feed: PublishedFeed
    rows: list[dict[str, Any]]
    feed_timestamp: int
    previous_artifact_of_this_revision: PublishAttempt | None
    validate: Validate
    gbfs: GbfsPublisher | None


Producer = Callable[[Production], Produced]

_PRODUCERS: dict[str, dict[str, Producer]] = {}


class Refused(Exception):
    """An expected failure carrying the sentence the attempt records."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class AlreadyRegistered(Exception):
    pass


def register_producer(standard: str, entity: str, producer: Producer) -> None:
    registered = _PRODUCERS.setdefault(standard, {})
    if entity in registered:
        raise AlreadyRegistered(
            f"{standard} {entity} is already built by {registered[entity]!r}, and {producer!r} would replace it. "
            "Two producers under one entity are two lineages of source version, "
            "which the ordering guard would compare as one."
        )
    registered[entity] = producer


def producer_for(standard: str, entity: str) -> Producer | None:
    return _PRODUCERS.get(standard, {}).get(entity)


def anything_is_registered_under(standard: str) -> bool:
    return bool(_PRODUCERS.get(standard))


@contextmanager
def restored_producers() -> Iterator[None]:
    saved = {standard: dict(producers) for standard, producers in _PRODUCERS.items()}
    try:
        yield
    finally:
        _PRODUCERS.clear()
        _PRODUCERS.update(saved)


def produce_gtfs_rt(production: Production) -> Produced:
    """One GTFS-Realtime message, validated against the binding's static schedule."""
    feed = production.feed
    try:
        feed_bytes = serialize_vehicle_positions(production.rows, feed.column_map, production.feed_timestamp)
    except SerializationError as exc:
        raise Refused(exc.reason) from exc

    if feed.static_gtfs_ref is None:
        # ck_published_feed_static_ref_matches_standard rules this out, so it is
        # a refusal rather than an assert: a bad row must not take the worker down.
        raise Refused("this gtfs-rt binding carries no static GTFS reference")

    previous = production.previous_artifact_of_this_revision
    try:
        outcome = production.validate(
            feed_bytes, feed.static_gtfs_ref, previous.feed_bytes if previous is not None else None
        )
    except ValidatorUnavailable as exc:
        raise Refused(str(exc)) from exc
    return outcome, feed_bytes, None


def produce_gbfs(production: Production) -> Produced:
    """One GBFS file set, validated whole. No previous artifact is passed: GBFS
    has no iteration rules to compare one against."""
    gbfs = production.gbfs
    if gbfs is None:
        # A worker that was never given a publisher. Recorded rather than raised,
        # so the tick leaves a trace and the feed stays off the air.
        raise Refused("this worker cannot publish gbfs feeds")

    feed = production.feed
    try:
        feed_files = gbfs.serialize(production.rows, feed, production.feed_timestamp)
    except SerializationError as exc:
        raise Refused(exc.reason) from exc

    if not feed_files:
        # An injected serializer that answered with nothing. Refused here rather
        # than carried into the shared tail, where a `published` row with no
        # artifact is a CHECK violation and so a 500 instead of a recorded fault.
        raise Refused("the gbfs serializer produced no files")

    try:
        outcome = gbfs.validate(feed_files, feed.version, feed.entity)
    except ValidatorUnavailable as exc:
        raise Refused(str(exc)) from exc
    return outcome, None, feed_files


_GBFS_STANDARD = "gbfs"

# The entities each standard can publish in a community build. A pack widens the
# binding vocabulary, and an entity nothing has registered a producer for is a
# failed attempt rather than an exception.
_SUPPORTED_ENTITIES: dict[str, frozenset[str]] = {
    "gtfs-rt": frozenset({"vehicle_positions"}),
    _GBFS_STANDARD: frozenset({"stations", "vehicles"}),
}


def _register_the_community_producers() -> None:
    for standard, entities in _SUPPORTED_ENTITIES.items():
        producer = produce_gbfs if standard == _GBFS_STANDARD else produce_gtfs_rt
        for entity in entities:
            register_producer(standard, entity, producer)


_register_the_community_producers()

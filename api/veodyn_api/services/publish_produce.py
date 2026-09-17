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


@dataclass(frozen=True)
class Needs:
    query: bool = True
    static_reference: bool = False
    column_map: bool = True
    retirement_on_failure: bool = False


def retirement_is_not_optional_error(standard: str, entity: str) -> str:
    return (
        f"{entity!r} under {standard} may not keep serving an artifact a later attempt failed to replace, "
        "because the rows behind it can be withdrawn and a retained artifact would keep a withdrawn row on "
        "the air. Set onError to 'block' and retireOnFailure to true."
    )


def keeps_a_stale_artifact(*, on_error: str, retire_on_failure: bool) -> bool:
    return on_error != "block" or not retire_on_failure


@dataclass(frozen=True)
class Registration:
    producer: Producer
    needs: Needs


_PRODUCERS: dict[str, dict[str, Registration]] = {}

_NEEDS_BY_STANDARD: dict[str, Needs] = {
    "gtfs-rt": Needs(static_reference=True),
    "gbfs": Needs(),
}

STANDARDS_WHOSE_BINDING_CAN_HOLD_A_STATIC_REFERENCE = frozenset({"gtfs-rt"})
"""Which standards `published_feed.static_gtfs_ref` may be non-null for.

`ck_published_feed_static_ref_matches_standard` reads
`(standard = 'gtfs-rt') = (static_gtfs_ref IS NOT NULL)`, so this is the one
part of `Needs` a producer is not free to choose: a declaration the column
cannot hold would be honoured by the request validator and then refused by
PostgreSQL at COMMIT, as a 500 naming no field. Held at registration instead,
which is the declaration layer and the last point where the contradiction can
still be reported to the person who wrote it.
"""


class Refused(Exception):
    """An expected failure carrying the sentence the attempt records."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class AlreadyRegistered(Exception):
    pass


class UnstorableNeeds(Exception):
    pass


def _refuse_needs_the_table_cannot_hold(standard: str, entity: str, needs: Needs) -> None:
    storable = standard in STANDARDS_WHOSE_BINDING_CAN_HOLD_A_STATIC_REFERENCE
    if needs.static_reference == storable:
        return
    raise UnstorableNeeds(
        f"{standard} {entity} declares static_reference={needs.static_reference}, and "
        f"ck_published_feed_static_ref_matches_standard holds static_gtfs_ref non-null for {standard} exactly "
        f"when it is {storable}. Every other field of Needs is the producer's to choose; this one is the "
        "column's, and accepting the declaration would trade a 422 naming the field for an IntegrityError at COMMIT."
    )


def register_producer(standard: str, entity: str, producer: Producer, needs: Needs | None = None) -> None:
    registered = _PRODUCERS.setdefault(standard, {})
    if entity in registered:
        raise AlreadyRegistered(
            f"{standard} {entity} is already built by {registered[entity].producer!r}, and {producer!r} would "
            "replace it. Two producers under one entity are two lineages of source version, "
            "which the ordering guard would compare as one."
        )
    declared = needs if needs is not None else needs_of_standard(standard)
    _refuse_needs_the_table_cannot_hold(standard, entity, declared)
    registered[entity] = Registration(producer, declared)


def producer_for(standard: str, entity: str) -> Producer | None:
    registration = _PRODUCERS.get(standard, {}).get(entity)
    return None if registration is None else registration.producer


def needs_of_standard(standard: str) -> Needs:
    return _NEEDS_BY_STANDARD.get(standard, Needs())


def needs_for(standard: str, entity: str) -> Needs:
    registration = _PRODUCERS.get(standard, {}).get(entity)
    return needs_of_standard(standard) if registration is None else registration.needs


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

_SUPPORTED_ENTITIES: dict[str, frozenset[str]] = {
    "gtfs-rt": frozenset({"vehicle_positions", "service_alerts"}),
    _GBFS_STANDARD: frozenset({"stations", "vehicles"}),
}

_ENTITIES_A_COMMUNITY_BUILD_PRODUCES: dict[str, frozenset[str]] = {
    "gtfs-rt": frozenset({"vehicle_positions"}),
    _GBFS_STANDARD: frozenset({"stations", "vehicles"}),
}


def entities_of_standard(standard: str) -> frozenset[str]:
    return _SUPPORTED_ENTITIES.get(standard, frozenset())


def unbuildable_reason(standard: str, entity: str) -> str:
    if entity in entities_of_standard(standard):
        return f"entity {entity!r} has no producer installed in this deployment"
    return f"entity {entity!r} is not supported yet"


def _register_the_community_producers() -> None:
    for standard, entities in _ENTITIES_A_COMMUNITY_BUILD_PRODUCES.items():
        producer = produce_gbfs if standard == _GBFS_STANDARD else produce_gtfs_rt
        for entity in entities:
            register_producer(standard, entity, producer)


_register_the_community_producers()

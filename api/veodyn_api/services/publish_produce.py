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

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.feed_validator import ValidationOutcome, ValidatorUnavailable
from veodyn_api.services.gtfs_rt_serializer import SerializationError, serialize_vehicle_positions

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
    validate: Callable[[dict[str, Any], str], ValidationOutcome]


class Refused(Exception):
    """An expected failure carrying the sentence the attempt records."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def produce_gtfs_rt(
    feed: PublishedFeed,
    rows: list[dict[str, Any]],
    feed_timestamp: int,
    previous: PublishAttempt | None,
    validate: Validate,
) -> Produced:
    """One GTFS-Realtime message, validated against the binding's static schedule."""
    try:
        feed_bytes = serialize_vehicle_positions(rows, feed.column_map, feed_timestamp)
    except SerializationError as exc:
        raise Refused(exc.reason) from exc

    if feed.static_gtfs_ref is None:
        # ck_published_feed_static_ref_matches_standard rules this out, so it is
        # a refusal rather than an assert: a bad row must not take the worker down.
        raise Refused("this gtfs-rt binding carries no static GTFS reference")

    try:
        outcome = validate(feed_bytes, feed.static_gtfs_ref, previous.feed_bytes if previous is not None else None)
    except ValidatorUnavailable as exc:
        raise Refused(str(exc)) from exc
    return outcome, feed_bytes, None


def produce_gbfs(
    feed: PublishedFeed,
    rows: list[dict[str, Any]],
    feed_timestamp: int,
    gbfs: GbfsPublisher | None,
) -> Produced:
    """One GBFS file set, validated whole. No previous artifact is passed: GBFS
    has no iteration rules to compare one against."""
    if gbfs is None:
        # A worker that was never given a publisher. Recorded rather than raised,
        # so the tick leaves a trace and the feed stays off the air.
        raise Refused("this worker cannot publish gbfs feeds")

    try:
        feed_files = gbfs.serialize(rows, feed, feed_timestamp)
    except SerializationError as exc:
        raise Refused(exc.reason) from exc

    if not feed_files:
        # An injected serializer that answered with nothing. Refused here rather
        # than carried into the shared tail, where a `published` row with no
        # artifact is a CHECK violation and so a 500 instead of a recorded fault.
        raise Refused("the gbfs serializer produced no files")

    try:
        outcome = gbfs.validate(feed_files, feed.version)
    except ValidatorUnavailable as exc:
        raise Refused(str(exc)) from exc
    return outcome, None, feed_files

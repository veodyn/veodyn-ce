"""The production halves the engine is given, one per standard.

The engine takes both as parameters so a test can pass its own. Nothing had
ever built the real one, because the worker that would have needed it ships in
the enterprise pack. The publish-now endpoint needs them, so they live here
rather than in the router: what a verdict costs and how it fails closed is a
service decision, not a routing one.

Both fail closed on missing configuration, and each does it through its own
standard's error type, so the engine names the fault the same way it names any
other: an unreachable validator is not a verdict, and an unknown public origin
is not a feed anyone can resolve.
"""

from typing import Any

import httpx

from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.feed_validator import (
    VALIDATE_TIMEOUT_SECONDS,
    ValidationOutcome,
    ValidatorUnavailable,
    validate_feed,
)
from veodyn_api.services.gbfs_serializer import serialize_gbfs_stations
from veodyn_api.services.gbfs_validation import validate_gbfs_files
from veodyn_api.services.gtfs_rt_serializer import SerializationError
from veodyn_api.services.publish_engine import GbfsPublisher, Validate
from veodyn_api.settings import Settings


def build_validate(settings: Settings) -> Validate:
    """A validator bound to this deployment's configuration.

    An unset URL raises rather than returning a clean verdict. The engine turns
    that into a `failed` attempt, which is the whole point: a community
    deployment with no validator configured must not publish bytes nothing
    checked, and `settings.py` already says so about this field.
    """
    base_url = settings.feed_validator_url

    def validate(feed_bytes: bytes, static_gtfs_ref: str, previous_feed: bytes | None) -> ValidationOutcome:
        if not base_url:
            raise ValidatorUnavailable("no feed validator is configured for this deployment")
        with httpx.Client(timeout=VALIDATE_TIMEOUT_SECONDS) as client:
            return validate_feed(client, base_url, feed_bytes, static_gtfs_ref, previous_feed)

    return validate


def build_gbfs_publisher(settings: Settings) -> GbfsPublisher:
    """The gbfs half, bound to this deployment's public origin.

    An unset origin is a `SerializationError` rather than a validator failure:
    the discovery document embeds that origin in every member url, so what is
    wrong is the artifact this deployment can build, not the verdict on it.
    """
    origin = settings.feed_public_origin.rstrip("/")

    def serialize(rows: list[dict[str, Any]], feed: PublishedFeed, feed_timestamp: int) -> dict[str, Any]:
        if not origin:
            raise SerializationError(
                "no public feed origin is configured for this deployment (VEODYN_FEED_PUBLIC_ORIGIN), "
                "so a discovery document would name member files nothing can resolve"
            )
        if feed.system_info is None:
            # ck_published_feed_system_info_matches_standard rules this out.
            raise SerializationError("this gbfs binding carries no system information")
        return serialize_gbfs_stations(
            rows,
            feed.column_map,
            feed.system_info,
            feed.version,
            slug=feed.slug,
            origin=origin,
            feed_timestamp=feed_timestamp,
        )

    return GbfsPublisher(serialize=serialize, validate=validate_gbfs_files)

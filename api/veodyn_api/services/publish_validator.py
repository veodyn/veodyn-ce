"""The `Validate` the engine is given in production.

The engine takes validation as a parameter so a test can pass one. Nothing had
ever built the real one, because the worker that would have needed it ships in
the enterprise pack. The publish-now endpoint needs it, so it lives here rather
than in the router: what a verdict costs and how it fails closed is a service
decision, not a routing one.
"""

import httpx

from veodyn_api.services.feed_validator import (
    VALIDATE_TIMEOUT_SECONDS,
    ValidationOutcome,
    ValidatorUnavailable,
    validate_feed,
)
from veodyn_api.services.publish_engine import Validate
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

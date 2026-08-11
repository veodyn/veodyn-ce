"""Server-side PostHog capture. Fail-open in every path.

distinct_id is the Redash user id as a string, which is exactly what the browser
identifies with, so a server 500 and the click that caused it land on one person
timeline without anything being passed in a header.
"""

import logging
from typing import Any

from posthog import Posthog

from veodyn_api.errors import ApiError
from veodyn_api.settings import Settings, get_settings

logger = logging.getLogger(__name__)

_posthog: Any = None


def telemetry_enabled(settings: Settings) -> bool:
    return not settings.disable_telemetry and bool(settings.posthog_key) and bool(settings.posthog_host)


def _client() -> Any:
    global _posthog
    settings = get_settings()
    if not telemetry_enabled(settings):
        return None
    if _posthog is None:
        _posthog = Posthog(settings.posthog_key, host=settings.posthog_host)
    return _posthog


def reset_client() -> None:
    """Test seam. The client is process-local and deliberately not shared."""
    global _posthog
    _posthog = None


def capture_api_error(actor_id: int | None, error: BaseException, props: dict[str, object]) -> None:
    """Report a failure this service could not handle.

    Only 5xx reach here. A 4xx ApiError is a deliberate refusal, not an incident,
    and capturing those would bury the real failures under validation noise.
    """
    client = _client()
    if client is None:
        return
    error_id = error.error_id.value if isinstance(error, ApiError) else ""
    try:
        client.capture_exception(
            error,
            distinct_id=str(actor_id) if actor_id is not None else "anonymous",
            properties={**props, "errorId": error_id},
        )
    except Exception:
        # Telemetry must never turn a handled failure into an unhandled one.
        logger.warning("telemetry capture failed", exc_info=True)

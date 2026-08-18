import hashlib
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

from fastapi import Depends, Header

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash import RedashClient
from veodyn_api.settings import Settings, get_settings


@dataclass(frozen=True)
class Identity:
    """Who the caller is, as Redash sees them. This service stores no users."""

    user_id: int
    name: str
    email: str
    groups: list[int]
    permissions: list[str]
    org_slug: str

    @property
    def is_admin(self) -> bool:
        return "admin" in self.permissions


def identity_credential(cookie: str | None, authorization: str | None) -> tuple[str | None, str | None]:
    """Pick the ONE credential that establishes identity, as (cookie, authorization).

    Exactly one wins, and only that one is ever forwarded to Redash for a later
    authorization check. That closes a real bypass: Redash resolves an API key
    against the *route* it is used on, so a saved query's key is unresolvable on
    /api/session (it falls back to the session cookie) but fully resolvable on
    /api/queries/<id>, where it grants that query's groups. Sending both
    authenticated the caller as the cookie user while the source check passed on
    the query key, letting anyone attach a query their identity cannot read.

    The cookie wins when both are present because that is the browser path
    through the Next.js proxy. A user API key resolves to a real user on
    /api/session, so a caller with only a key still authenticates.
    """
    if cookie:
        return cookie, None
    return None, authorization


def caller_api_key(authorization: str | None) -> str | None:
    """The bare token out of an Authorization header.

    RedashClient re-adds the `Key ` scheme Redash expects, so passing the
    header through verbatim would send `Key Key <token>`. Any scheme is
    stripped; a header with no scheme is taken as the token itself.
    """
    if not authorization:
        return None
    header = authorization.strip()
    _, _, token = header.partition(" ")
    return token.strip() or header


def caller_credential(cookie: str | None, authorization: str | None) -> tuple[str | None, str | None]:
    """The (api_key, cookie) pair to run a Redash call as this caller.

    Applies the same one-credential rule that established the identity, so a
    credential that did NOT authenticate the caller is never forwarded. See the
    bypass `identity_credential` closes.
    """
    session_cookie, session_authorization = identity_credential(cookie, authorization)
    return caller_api_key(session_authorization), session_cookie


@lru_cache
def get_redash_client() -> RedashClient:
    return RedashClient(get_settings().redash_url)


# Keyed on a hash of the credential, never the credential itself, so a heap
# dump or a log of this dict does not hand out sessions.
_session_cache: dict[str, tuple[float, Identity]] = {}

# One entry per distinct credential, and a long-lived process sees a lot of them.
# Nothing reads an expired entry, but without a sweep they accumulate for the life
# of the process, so prune on a miss once the dict crosses this.
_SESSION_CACHE_PRUNE_AT = 1024


def _cache_key(cookie: str | None, authorization: str | None) -> str:
    return hashlib.sha256(f"{cookie or ''}|{authorization or ''}".encode()).hexdigest()


def _store_identity(key: str, identity: Identity, ttl_seconds: float, now: float) -> None:
    if len(_session_cache) >= _SESSION_CACHE_PRUNE_AT:
        expired = [cached_key for cached_key, (expires_at, _) in _session_cache.items() if expires_at <= now]
        for cached_key in expired:
            del _session_cache[cached_key]
    _session_cache[key] = (now + ttl_seconds, identity)


def _identity_from_payload(payload: dict[str, Any]) -> Identity:
    user = payload.get("user") or {}
    user_id = user.get("id")
    if user_id is None:
        # A query API key resolves to an ApiUser with no id. It can read query
        # results, but nothing here can be attributed to it.
        raise ApiError(
            ErrorId.FORBIDDEN,
            "this credential has no user identity; use a signed-in session or a user API key",
            status_code=403,
        )
    org_slug = payload.get("org_slug")
    if not org_slug:
        # Never fall back to "default". Every row is scoped by org_slug, so
        # guessing the tenant on a malformed session would silently hand the
        # caller another tenant's KPIs.
        raise ApiError(
            ErrorId.FORBIDDEN,
            "redash did not report an organization for this credential",
            status_code=403,
        )
    return Identity(
        user_id=int(user_id),
        name=str(user.get("name", "")),
        email=str(user.get("email", "")),
        groups=[int(group) for group in user.get("groups", [])],
        permissions=[str(permission) for permission in user.get("permissions", [])],
        org_slug=str(org_slug),
    )


def require_identity(
    settings: Annotated[Settings, Depends(get_settings)],
    redash: Annotated[RedashClient, Depends(get_redash_client)],
    cookie: Annotated[str | None, Header()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> Identity:
    if not cookie and not authorization:
        raise ApiError(ErrorId.UNAUTHENTICATED, "no credential on the request", status_code=401)

    # Resolve against the one identity credential, and cache on that alone, so a
    # varying second header can neither change the identity nor multiply entries.
    session_cookie, session_authorization = identity_credential(cookie, authorization)
    key = _cache_key(session_cookie, session_authorization)
    now = time.monotonic()
    cached = _session_cache.get(key)
    if cached is not None and cached[0] > now:
        return cached[1]

    identity = _identity_from_payload(redash.get_session(session_cookie, session_authorization))
    _store_identity(key, identity, settings.session_cache_ttl_seconds, now)
    return identity


def clear_session_cache() -> None:
    """Test seam. The cache is process-local and intentionally not shared."""
    _session_cache.clear()

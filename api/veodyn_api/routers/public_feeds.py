"""The unauthenticated routes in this service's community surface.

No `Identity` dependency, no cookie, no key: a public GTFS-Realtime or GBFS feed
is meant to be read by anything that speaks the format. The single exception is
a feed token, which a private feed's consumer presents as `?token=` or as
`Authorization: Bearer <token>` and which `services/published_feed_token_registry.py`
resolves. It is not an identity: it names a feed, not a person, and nothing here
learns who is reading. Community registers no resolver, so a community build
serves no private feed to anybody and a presented token changes nothing at all.

Every refusal answers 404 with the same body whatever caused it: unknown slug,
private feed with no token, private feed with a wrong, revoked or expired one,
nothing published yet, no such member file. A caller cannot learn which slugs
are taken one guess at a time.
`app/src/app/api/public/visualizations/[token]/route.ts` draws the same line.

Resolution comes first and the staleness 503 second, on both routes. The 503
does disclose a live feed that has published before, so a caller who has not
resolved the feed must not be able to draw one.

Which binding a slug resolves to, and what it currently serves, is
`services/public_feed_lookup.py`.
"""

import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from veodyn_api.db import get_db
from veodyn_api.errors import ErrorId
from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.public_feed_lookup import not_found, served

router = APIRouter(prefix="/public/feeds", tags=["public-feeds"])

DbDep = Annotated[Session, Depends(get_db)]

TokenParam = Annotated[
    str | None,
    Query(description="A token issued for a private feed. A public feed serves without one."),
]

GTFS_RT_CONTENT_TYPE = "application/x-protobuf"
GBFS_CONTENT_TYPE = "application/json"

# The one member file a GBFS system is addressed by; the rest hang off it.
GBFS_DISCOVERY_FILE = "gbfs.json"
GBFS_STANDARD = "gbfs"

BEARER_SCHEME = "bearer"


def _now_epoch() -> int:
    """The clock, behind a name so a test can freeze it.

    Unlike `publish_engine`, which takes `feed_timestamp` from its caller, a
    read endpoint has to look: staleness is a fact about the request's moment.
    """
    return int(time.time())


def _bearer_token(header: str | None) -> str | None:
    """The token out of `Authorization: Bearer <t>`, or None for anything else.

    That scheme only. `Key <k>` is this instance's management-plane credential,
    and a header meant for a different plane must not be spent here.

    Split on a whitespace RUN, not on one space: RFC 9110 writes the separator
    as one or more, so a padded header carries the same credential as a tight
    one. Taking the pad along made it a different string from the identical
    token in the query, which fired the both-present-and-different refusal on
    one credential presented twice. An empty credential is no token at all.
    """
    if header is None:
        return None
    parts = header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != BEARER_SCHEME:
        return None
    return parts[1].strip() or None


def _presented_token(request: Request, query_token: str | None) -> str | None:
    """The one token this request presents, over either transport.

    Both transports are equal: many feed pollers are a URL and nothing else, so
    the query parameter cannot be the second-class one.

    Two DIFFERENT tokens is nothing presented rather than a choice to arbitrate.
    Picking one would put which transport wins into the contract, and a caller
    whose header is stale would go on reading through a query token they believe
    they revoked.
    """
    header_token = _bearer_token(request.headers.get("authorization"))
    if query_token and header_token and query_token != header_token:
        return None
    return query_token or header_token or None


def _too_stale(slug: str, cap_seconds: int | None) -> JSONResponse:
    """503 with `Retry-After`, per design section 6.5, and NOT an `ApiError`.

    `ApiError` carries no headers, and the handler in `errors.py` sends every
    `status_code >= 500` to telemetry as a service fault, which this is not.

    Unlike the identical 404s, this does disclose that the slug names a feed
    which has published before and is currently stale, which is what section 6.5
    asks for. It is only ever reached by a caller who has already resolved the
    feed, anonymously or with a token. `Retry-After` is the feed's own
    configured cap, the only interval anybody has stated about its tolerable
    staleness.

    `cap_seconds` is None only for a `last_good` binding carrying no cap, which
    `ck_published_feed_cap_matches_mode` forbids in both directions. That case
    fails closed and sends no `Retry-After` rather than reporting a cap of zero.
    """
    if cap_seconds is None:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "id": ErrorId.PUBLIC_FEED_TOO_STALE.value,
                    "message": (
                        f"the feed at {slug!r} is set to last_good but carries no age cap, "
                        "so nothing can be certified fresh enough to serve"
                    ),
                }
            },
        )
    return JSONResponse(
        status_code=503,
        headers={"retry-after": str(cap_seconds)},
        content={
            "error": {
                "id": ErrorId.PUBLIC_FEED_TOO_STALE.value,
                "message": (
                    f"the feed at {slug!r} has no artifact newer than its {cap_seconds}s "
                    "last-good age cap, so it is withheld rather than served stale"
                ),
            }
        },
    )


def _staleness_refusal(feed: PublishedFeed, artifact: PublishAttempt, slug: str) -> JSONResponse | None:
    """The 503, or None when the artifact may be served.

    Design section 6.5: `block` never stops serving on age alone, so it needs no
    branch here; it refuses to PUBLISH a bad read, which the engine already did
    before this artifact became current. `last_good` serves the same last valid
    artifact PLUS its required cap, past which this answers 503.

    One helper for both routes and for both ways of resolving a feed, so a
    private feed's consumer gets the same age promise a public one's does.
    """
    if feed.on_error != "last_good":
        return None
    # Non-null whenever the mode is `last_good`, by
    # ck_published_feed_cap_matches_mode.
    cap = feed.last_good_max_age_seconds
    stamp = artifact.feed_timestamp
    if cap is None or stamp is None or _now_epoch() - stamp > cap:
        # Measured against the artifact's own HEADER timestamp, which is what the
        # served artifact tells a consumer the data's time is and what the cap
        # promises about; `created_at` would measure our pipeline instead and
        # call a fresh publish of hours-old rows current. For gbfs that stamp is
        # the discovery document's `last_updated`. A missing stamp or cap fails
        # closed into the same branch.
        return _too_stale(slug, cap)
    return None


# The content map is declared because the return annotation is a bare
# `Response`, whose FastAPI default is `application/json`: left alone, the
# committed openapi.json advertises JSON for an endpoint that answers protobuf
# for a gtfs-rt feed, and a generated client tries to JSON-decode a
# GTFS-Realtime message.
@router.get(
    "/{slug}",
    response_class=Response,
    responses={
        200: {
            "content": {
                GTFS_RT_CONTENT_TYPE: {"schema": {"type": "string", "format": "binary"}},
                GBFS_CONTENT_TYPE: {"schema": {"type": "object"}},
            },
            "description": "The feed's current artifact: a GTFS-Realtime message, or a GBFS discovery document.",
        }
    },
)
def get_public_feed(slug: str, request: Request, db: DbDep, token: TokenParam = None) -> Response:
    """The current artifact for one feed, by its standard.

    Public with or without a token, private only with one a resolver grants.
    """
    feed, artifact = served(db, slug, _presented_token(request, token))

    # The BINDING's standard decides which artifact this address answers with,
    # not the artifact's shape: the CHECK permits a gtfs-rt row carrying
    # `feed_files`, and reading the shape would serve GBFS off a gtfs-rt feed.
    #
    # Resolved BEFORE the staleness branch, for the reason the member route
    # gives: the 503 discloses a live feed, so an address with nothing to answer
    # must not answer differently once its artifact goes stale.
    discovery: Any | None = None
    if feed.standard == GBFS_STANDARD:
        if artifact.feed_files is None:
            raise not_found(slug)
        discovery = artifact.feed_files.get(GBFS_DISCOVERY_FILE)
        if discovery is None:
            raise not_found(slug)
    elif artifact.feed_bytes is None:
        raise not_found(slug)

    stale = _staleness_refusal(feed, artifact, slug)
    if stale is not None:
        return stale

    if discovery is not None:
        return JSONResponse(status_code=200, content=discovery)
    return Response(content=artifact.feed_bytes, media_type=GTFS_RT_CONTENT_TYPE)


@router.get("/{slug}/{file_name}")
def get_public_feed_file(
    slug: str, file_name: str, request: Request, db: DbDep, token: TokenParam = None
) -> JSONResponse:
    """One member file of a GBFS artifact.

    Every refusal is the same 404 as the discovery route's, whatever caused it:
    an unknown slug, a private feed reached without a token a resolver grants,
    nothing published, a gtfs-rt feed with no member files at all, or a name
    outside the published set. The name is never echoed back, so the file set
    cannot be enumerated either.

    The missing-file 404 comes BEFORE the staleness branch on purpose. The 503
    does disclose that the slug names a live feed, and a name that is not in the
    set must not answer differently for a stale feed than for any other.
    """
    feed, artifact = served(db, slug, _presented_token(request, token))
    # The BINDING's standard decides, not the artifact's shape. Nothing writes
    # member files for a gtfs-rt binding today, and the database would allow it.
    if feed.standard != GBFS_STANDARD or artifact.feed_files is None or file_name not in artifact.feed_files:
        raise not_found(slug)

    stale = _staleness_refusal(feed, artifact, slug)
    if stale is not None:
        return stale

    return JSONResponse(status_code=200, content=artifact.feed_files[file_name])

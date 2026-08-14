"""Declaring that a query publishes a standard feed.

Authorization is deliberately NOT the catalog's or the feed board's. Setting a
cadence expectation is open to any org member because it changes neither data
nor permissions; creating a published feed does both, so it takes an admin.

The binding is checked when it is saved, which is the cheapest gate there is:
discovering the mapping is wrong at publish time costs an attempt and a stored
failure, and discovering it here costs one call, made while the person who
wrote the map is still looking at it.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from veodyn_api.auth import Identity, get_redash_client, require_identity
from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.schemas.published_feed import PublishedFeedIn, PublishedFeedOut
from veodyn_api.services.ai_grounding import query_result_columns
from veodyn_api.services.feed_binding_checks import check_column_map
from veodyn_api.services.feed_lifecycle import take_the_feed_off_the_air
from veodyn_api.services.feed_query_check import require_a_readable_query
from veodyn_api.services.redash import RedashClient
from veodyn_api.settings import Settings, get_settings

router = APIRouter(prefix="/published-feeds", tags=["published-feeds"])

IdentityDep = Annotated[Identity, Depends(require_identity)]
DbDep = Annotated[Session, Depends(get_db)]
RedashDep = Annotated[RedashClient, Depends(get_redash_client)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

# What a read path reports instead of running the check. See PublishedFeedOut.
UNKNOWN_STATE = "unknown"


def require_admin(identity: Identity) -> None:
    """Guarded in the handler, because there is no `require_admin` dependency.

    A published feed is an anonymous read surface over query results, so
    creating one changes both data exposure and permissions. That is the line
    between this and the cadence expectations next door, which any org member
    may set precisely because they change neither.
    """
    if not identity.is_admin:
        raise ApiError(ErrorId.FORBIDDEN, "publishing a feed requires an administrator", status_code=403)


def load_feed(db: Session, org_slug: str, slug: str) -> PublishedFeed:
    feed = db.get(PublishedFeed, (org_slug, slug))
    if feed is None:
        raise ApiError(ErrorId.PUBLISHED_FEED_NOT_FOUND, f"no feed published at {slug!r}", status_code=404)
    return feed


def _out(feed: PublishedFeed, binding_state: str) -> PublishedFeedOut:
    return PublishedFeedOut(
        slug=feed.slug,
        revision=feed.revision,
        query_id=feed.query_id,
        standard=feed.standard,
        version=feed.version,
        entity=feed.entity,
        static_gtfs_ref=feed.static_gtfs_ref,
        source_column=feed.source_column,
        column_map=feed.column_map,
        on_error=feed.on_error,
        last_good_max_age_seconds=feed.last_good_max_age_seconds,
        visibility=feed.visibility,
        binding_state=binding_state,
    )


def _check(redash: RedashClient, settings: Settings, body: PublishedFeedIn) -> str:
    """The binding's state, or a 422 naming every problem with it.

    Run before anything is written, so a refused edit leaves the stored binding
    and the served artifact exactly as they were.
    """
    # The service key, not the caller's, for both reads: require_admin has
    # already proven this caller may publish, and both are metadata about a query
    # the binding names rather than a row of its data.
    require_a_readable_query(redash, settings, body.query_id)
    columns = query_result_columns(redash, body.query_id, settings.redash_service_api_key)
    check = check_column_map(body.entity, body.column_map, columns)
    if check.state == "invalid":
        # ApiError carries no structured extra, so the problems go in the
        # message. A refusal nobody can act on is barely a refusal.
        raise ApiError(
            ErrorId.PUBLISHED_FEED_BINDING_INVALID,
            "the column map cannot produce this feed: " + "; ".join(check.problems),
            status_code=422,
        )
    return check.state


@router.get("", response_model=list[PublishedFeedOut])
def list_feeds(identity: IdentityDep, db: DbDep) -> list[PublishedFeedOut]:
    rows = db.execute(
        select(PublishedFeed).where(PublishedFeed.org_slug == identity.org_slug).order_by(PublishedFeed.slug)
    ).scalars()
    # Not checked per row: listing is a glance, and a check costs a whole result
    # body per binding. Reported as unknown rather than ok, because a green tick
    # nothing verified is worse than an honest blank.
    return [_out(row, UNKNOWN_STATE) for row in rows]


@router.post("", response_model=PublishedFeedOut, status_code=201)
def create_feed(
    identity: IdentityDep, db: DbDep, redash: RedashDep, settings: SettingsDep, body: PublishedFeedIn
) -> PublishedFeedOut:
    require_admin(identity)
    if db.get(PublishedFeed, (identity.org_slug, body.slug)) is not None:
        raise ApiError(
            ErrorId.PUBLISHED_FEED_SLUG_TAKEN,
            f"a feed is already published at {body.slug!r}",
            status_code=409,
        )

    state = _check(redash, settings, body)
    feed = PublishedFeed(
        org_slug=identity.org_slug,
        slug=body.slug,
        revision=1,
        query_id=body.query_id,
        standard=body.standard,
        version=body.version,
        entity=body.entity,
        static_gtfs_ref=body.static_gtfs_ref,
        source_column=body.source_column,
        column_map=body.column_map,
        on_error=body.on_error,
        last_good_max_age_seconds=body.last_good_max_age_seconds,
        visibility=body.visibility,
        created_by_user_id=identity.user_id,
    )
    db.add(feed)
    try:
        db.commit()
    except IntegrityError as clash:
        # The check above and this INSERT are separated by two external Redash
        # reads, ample room for a second create on the same slug to pass the same
        # check. The primary key is what actually decides, so the loser answers
        # the 409 this endpoint already documents rather than a 500 at commit.
        db.rollback()
        if db.get(PublishedFeed, (identity.org_slug, body.slug)) is None:
            # Not the race: some other constraint gave way, which is a defect,
            # and calling it "slug taken" sends the debugger to the wrong place.
            raise
        raise ApiError(
            ErrorId.PUBLISHED_FEED_SLUG_TAKEN,
            f"a feed is already published at {body.slug!r}",
            status_code=409,
        ) from clash
    return _out(feed, state)


@router.get("/{slug}", response_model=PublishedFeedOut)
def get_feed(identity: IdentityDep, db: DbDep, slug: str) -> PublishedFeedOut:
    return _out(load_feed(db, identity.org_slug, slug), UNKNOWN_STATE)


@router.put("/{slug}", response_model=PublishedFeedOut)
def update_feed(
    identity: IdentityDep, db: DbDep, redash: RedashDep, settings: SettingsDep, slug: str, body: PublishedFeedIn
) -> PublishedFeedOut:
    require_admin(identity)
    feed = load_feed(db, identity.org_slug, slug)

    # THE DECISION: a mismatched slug is REFUSED, not dropped from the update
    # shape. Both close the hole (the body's slug was pattern-checked and then
    # ignored, so a body naming `alerts` happily edited `vehicles`), and refusing
    # is the one that keeps PUT taking the whole binding: the body a GET hands
    # back is the body you may hand straight back. What the caller may not do is
    # name a different feed. The path selects the row, and renaming is not an
    # operation here at all -- the slug is half the primary key and the feed's
    # public address, so moving it is a delete and a create.
    if body.slug != slug:
        raise ApiError(
            ErrorId.INVALID_REQUEST,
            f"the body names feed {body.slug!r} but the path names {slug!r}; a feed cannot be renamed here",
            status_code=422,
        )

    # Checked before a single field moves, so a refusal costs nothing: the
    # binding is untouched and the feed is still on the air.
    state = _check(redash, settings, body)

    feed.query_id = body.query_id
    feed.version = body.version
    feed.entity = body.entity
    feed.static_gtfs_ref = body.static_gtfs_ref
    feed.source_column = body.source_column
    feed.column_map = body.column_map
    feed.on_error = body.on_error
    feed.last_good_max_age_seconds = body.last_good_max_age_seconds
    feed.visibility = body.visibility
    # The revision is half an artifact's identity, so it moves with any edit and
    # no existing artifact can be mistaken for one of this binding.
    feed.revision += 1
    take_the_feed_off_the_air(db, feed)
    db.commit()
    return _out(feed, state)


@router.delete("/{slug}", status_code=204)
def delete_feed(identity: IdentityDep, db: DbDep, slug: str) -> Response:
    require_admin(identity)
    feed = db.get(PublishedFeed, (identity.org_slug, slug))
    if feed is not None:
        # Before the row goes, while there is still a feed to ask the pointer
        # about. The attempts themselves stay: they are the record of what this
        # feed ever served, and nothing is served off a cleared pointer.
        take_the_feed_off_the_air(db, feed)
        db.delete(feed)
        db.commit()
    # 204 either way. Deleting a binding that is already gone is the state the
    # caller asked for, and a 404 would make a retried delete look like a fault.
    return Response(status_code=204)

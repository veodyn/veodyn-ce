"""Tags on the object kinds this build has, and the vocabulary they form.

Queries and dashboards are NOT here: they are Redash objects, Redash owns their
tags and already accepts a `tags` key on `POST /api/queries/<id>`. Mirroring
them here would create two writable copies of one fact.

Which kinds this build has, and what authorizes a write to each, comes from the
object-type registry, so the rule lives with whoever owns the kind: `kpi` is
owner-or-admin, `report` uses the report's own edit guard, and `dataset` is any
authenticated member of the org (a dataset has no owner to check against, and
tagging shared warehouse tables is curation; tighten to admin-only if that turns
out wrong). A kind that is not registered is a 404 decided in the handler, not
by a `Literal` on the route: a `Literal` is validated before any handler code
runs, so a registered kind was refused with a 422 whatever the registry said.

Every refusal a PUT can make about the body answers 422, so the status code
alone identifies nothing. Each carries its own ErrorId, and that id is the
contract the frontend branches on.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from veodyn_api import registry
from veodyn_api.auth import Identity, require_identity
from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.tag import TagCountOut, TagsIn, TagsOut
from veodyn_api.services import tag_rules
from veodyn_api.services import tags as tag_service

router = APIRouter(prefix="/tags", tags=["tags"])

IdentityDep = Annotated[Identity, Depends(require_identity)]
DbDep = Annotated[Session, Depends(get_db)]


def _object_query(org_slug: str, model: type[Any], object_id: str) -> Select[tuple[str]]:
    """A SELECT of the object being tagged, for the write to test against.

    Handed to the write rather than run first: an existence check followed by a
    write leaves a window for a delete to land between them, and the rows that
    result point at nothing. Every model behind a taggable kind is keyed
    (org_slug, id), which is what makes this one query shape rather than a branch
    per kind.
    """
    return select(model.id).where(model.org_slug == org_slug, model.id == object_id)


def _refuse_bad_tags(sent: list[str], wanted: list[str]) -> None:
    """Refuse a body this service will not store, naming which rule said no.

    Three causes, three ids, all of them 422, so a client has something other
    than the status code to branch on.

    Order is load-bearing: how much was sent is judged before what was sent, so a
    body of two hundred labels is refused for being two hundred labels, whatever
    is written in them. The count is measured on what arrived and the length on
    what would be stored, since only normalization decides the stored length.
    """
    if len(sent) > tag_rules.MAX_TAGS_PER_OBJECT:
        raise ApiError(
            ErrorId.TOO_MANY_TAGS,
            f"an object may carry at most {tag_rules.MAX_TAGS_PER_OBJECT} tags, and this request sent {len(sent)}",
            status_code=422,
        )

    too_long = tag_rules.too_long_in(wanted)
    if too_long:
        raise ApiError(
            ErrorId.TAG_TOO_LONG,
            f"a tag may be at most {tag_rules.MAX_TAG_LENGTH} characters, and '{too_long[0][:40]}' runs to "
            f"{len(too_long[0])}",
            status_code=422,
        )

    reserved = tag_rules.reserved_in(wanted)
    if reserved:
        raise ApiError(
            ErrorId.TAG_PREFIX_RESERVED,
            f"'{tag_rules.RESERVED_PREFIX}' is reserved for domain membership, so {reserved[0]} cannot be added "
            "as a tag",
            status_code=422,
        )


def _authorize(
    descriptor: registry.ObjectType,
    object_id: str,
    identity: Identity,
    db: Session,
) -> Select[tuple[str]] | None:
    """Refuse the write if it must not land, and return the gate for the one
    that may.

    The descriptor's own guard runs first. Every one of them answers a missing
    object with a 404 **before** any ownership check, so a cross-org id reads as
    404 rather than 403: a 403 would confirm the row exists in another tenant.

    None for a kind with no model, because there is nothing in this database to
    gate on; for a dataset the guard's registry read is the whole existence check.
    """
    descriptor.authorize_tag_write(db, identity, object_id)
    if descriptor.model is None:
        return None
    return _object_query(identity.org_slug, descriptor.model, object_id)


@router.get("", response_model=list[TagCountOut])
def list_tags(identity: IdentityDep, db: DbDep) -> list[TagCountOut]:
    """The org's tag vocabulary, unioned across every kind this service owns.

    The same item shape Redash's QueryTagsResource returns, so the frontend
    merges this with the query and dashboard vocabularies through one mapper.
    Reserved `domain:` tags are excluded, so they can never be suggested.
    """
    return [TagCountOut(name=name, count=count) for name, count in tag_service.vocabulary(db, identity.org_slug)]


@router.put("/{object_type}/{object_id}", response_model=TagsOut)
def set_tags(
    object_type: str,
    object_id: str,
    body: TagsIn,
    identity: IdentityDep,
    db: DbDep,
) -> TagsOut:
    """Replace the whole tag set for one object.

    Replace rather than add/remove because the frontend's TagsControl hands back
    the full array on every change, which is idempotent under retry. Tags are
    normalized here as well as in the browser, since this endpoint is reachable
    without the UI and matching is exact, so one unnormalized write would split a
    tag in two for everyone.
    """
    # An unknown kind is answered before the body is judged, and the body before
    # anything is loaded: a caller who sent a reserved tag is told so whether or
    # not the object they aimed at exists.
    descriptor = registry.taggable_type(object_type)
    wanted = tag_rules.normalize_all(body.tags)
    _refuse_bad_tags(body.tags, wanted)

    gate = _authorize(descriptor, object_id, identity, db)
    stored = tag_service.replace(db, identity.org_slug, object_type, object_id, wanted, gate)
    db.commit()
    return TagsOut(tags=stored)

"""Tags on the object kinds this build has, and the vocabulary they form.

Queries and dashboards are NOT here: they are Redash objects and Redash owns
their tags, filters on them server side, and already accepts a `tags` key on
`POST /api/queries/<id>`. Mirroring those into this table was rejected in the
design, because it would create two writable copies of one fact. This covers
only what this service stores.

Which kinds those are, and what authorizes a write to each, is not written down
here. Both come from the object-type registry, so the rule lives with whoever
owns the kind:

- `kpi`: the owner or an admin, the same rule every other KPI write applies.
- `report`: the report's own edit guard, so a document closed for authoring is
  closed for tagging too.
- `dataset`: any authenticated member of the org. A dataset has no owner to
  check against, and tagging shared warehouse tables is a curation surface more
  like a wiki than like editing someone's document. Stated assumption from the
  design, to be tightened to admin-only if it turns out wrong.

Those three descriptors are registered by the modules that own the kinds, and
this file resolves whichever of them a deployment has. A kind that is not
registered is a 404 here, decided in the handler rather than by a Literal on the
route: a `Literal` was validated by FastAPI before any handler code ran, so a
registered kind was refused with a 422 whatever the registry said, and the seam
registered nothing that worked.

Every refusal a PUT can make about the body itself answers 422, so the status
code alone identifies nothing. Each one carries its own ErrorId instead, and
that id is the contract the frontend branches on.
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

    Handed to the write rather than run first, the favorites trick verbatim: an
    existence check followed by a write leaves a window for a delete to land
    between them, and the rows that result point at nothing. Every model behind
    a taggable kind is keyed (org_slug, id), which is what makes this one query
    shape rather than a branch per kind.
    """
    return select(model.id).where(model.org_slug == org_slug, model.id == object_id)


def _refuse_bad_tags(sent: list[str], wanted: list[str]) -> None:
    """Refuse a body this service will not store, naming which rule said no.

    Three causes, three ids, all of them 422. They were one id until a person
    hitting the length cap was told the `domain:` prefix was reserved, which is
    what happens when a client branches on the status code because that is all
    the wire gave it.

    Order matters and is the order pydantic used to apply, back when the caps
    were Field constraints and ran before this function's body existed: how much
    was sent is judged before what was sent. A body of two hundred labels is
    refused for being two hundred labels, whatever is written in them.

    The count is measured on what arrived and the length on what would be
    stored. They are two different bounds: the first limits the request, so it
    has to be checked before the request is processed at all, and the second
    limits the column, which only normalization decides.
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

    The descriptor's own guard runs first and either returns quietly or raises.
    Every one of them answers a missing object with a 404 **before** any
    ownership check, so a cross-org id reads as 404 rather than 403: a 403 would
    confirm the row exists in another tenant.

    None for a kind with no model, because there is nothing in this database to
    gate on. For a dataset the guard's registry read is the whole existence
    check, and it cannot race a delete the way a row can: dropping a captured
    table is not something this service does at all.
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
    the full array on every change, so replace matches the component contract
    and is idempotent under retry.

    Normalized here as well as in the browser. This endpoint is reachable
    without the UI, and matching is exact, so a single unnormalized write is
    enough to split a tag in two for everyone.

    The kind is resolved first, where the route's Literal used to refuse it, so
    the order a caller sees is unchanged: an unknown kind is answered before the
    body is judged. After that the body is checked before anything is loaded: it
    costs no I/O, and a caller who sent a reserved tag gets that told to them
    whether or not the object they aimed at exists.
    """
    descriptor = registry.taggable_type(object_type)
    wanted = tag_rules.normalize_all(body.tags)
    _refuse_bad_tags(body.tags, wanted)

    gate = _authorize(descriptor, object_id, identity, db)
    stored = tag_service.replace(db, identity.org_slug, object_type, object_id, wanted, gate)
    db.commit()
    return TagsOut(tags=stored)

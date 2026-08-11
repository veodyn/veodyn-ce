"""One person's stars, for the object kinds this build has.

Deliberately its own endpoint group rather than an `isFavorite` field on the
objects themselves. Two reasons, both practical:

- Those models are the response of every mutation as well as every read (patch,
  approve, publish, recompute). A field on them would have to be resolved on all
  of those paths or the star would flick off after an unrelated edit, and
  getting that right on twelve call sites is a worse bet than not putting it
  there.
- The frontend already holds the list it wants to mark. One cached read of the
  id set is enough to decide every row, and it is the same read the Favorites
  page itself needs.

Queries and dashboards are NOT here: they are Redash objects, and Redash owns
their favorites (`/api/queries/<id>/favorite`). This covers only what this
service stores.

Which kinds those are is not written down here. Every kind comes from the
object-type registry, so a kind that is not registered is refused with a 404
rather than being validated against a list this file would have to keep in step
with whatever is installed.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from veodyn_api import registry
from veodyn_api.auth import Identity, require_identity
from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.favorite import FavoritesOut
from veodyn_api.services import favorites

router = APIRouter(prefix="/favorites", tags=["favorites"])

IdentityDep = Annotated[Identity, Depends(require_identity)]
DbDep = Annotated[Session, Depends(get_db)]


def _object_query(org_slug: str, descriptor: registry.ObjectType, object_id: str) -> Select[tuple[str]]:
    """A SELECT of the object being starred, for the insert to test against.

    Handed to the write rather than run first: an existence check followed by an
    insert leaves a window for a delete to land between them, and the row that
    results points at nothing. Every model behind a favoritable kind is keyed
    (org_slug, id), which is what makes this one query shape rather than a
    branch per kind.

    A kind with no model has no table to gate the insert on, so it cannot be
    starred at all. Refused with the same cause an unregistered kind gets,
    because from the caller's side it is the same fact: there is nothing here to
    hang a star on.
    """
    model = descriptor.model
    if model is None:
        raise ApiError(
            ErrorId.UNKNOWN_OBJECT_TYPE,
            f"'{descriptor.kind}' has no row in this service to star",
            status_code=404,
        )
    return select(model.id).where(model.org_slug == org_slug, model.id == object_id)


@router.get("", response_model=FavoritesOut)
def list_favorites(identity: IdentityDep, db: DbDep) -> FavoritesOut:
    """Every id this caller has starred, grouped by kind.

    Whole sets rather than a page: a person's favorites are the short list by
    definition, and the client marks rows by membership, which needs all of them
    or it marks some rows wrongly.

    One key per registered favoritable kind, present even when empty, and a
    stored row whose kind is no longer registered is left out rather than
    inventing a key the client has no page for.
    """
    grouped: dict[str, list[str]] = {kind: [] for kind in registry.favoritable_kinds()}
    for object_type, object_id in favorites.starred(db, identity.org_slug, identity.user_id):
        if object_type in grouped:
            grouped[object_type].append(object_id)
    return FavoritesOut(grouped)


@router.post("/{object_type}/{object_id}", status_code=204)
def add_favorite(object_type: str, object_id: str, identity: IdentityDep, db: DbDep) -> Response:
    descriptor = registry.favoritable_type(object_type)
    starred_now = favorites.add(
        db,
        identity.org_slug,
        identity.user_id,
        object_type,
        object_id,
        _object_query(identity.org_slug, descriptor, object_id),
    )
    # Nothing written has two causes, and they are a 204 and a 404: the star was
    # already there, or there is nothing to star. Only the second is an error,
    # and the cause it reports is the kind's own, from the descriptor.
    if not starred_now and not favorites.has(db, identity.org_slug, identity.user_id, object_type, object_id):
        db.rollback()
        raise ApiError(descriptor.not_found, f"{object_type} {object_id} does not exist", status_code=404)
    db.commit()
    return Response(status_code=204)


@router.delete("/{object_type}/{object_id}", status_code=204)
def remove_favorite(object_type: str, object_id: str, identity: IdentityDep, db: DbDep) -> Response:
    """Deliberately does NOT check that the object exists: removing the star of
    something already deleted is exactly the tidy-up a caller should be allowed
    to finish. The kind is still resolved, so a delete cannot address rows of a
    kind this build does not serve."""
    registry.favoritable_type(object_type)
    favorites.remove(db, identity.org_slug, identity.user_id, object_type, object_id)
    db.commit()
    return Response(status_code=204)

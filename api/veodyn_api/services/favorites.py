"""Reading and writing one person's stars.

None of these commit. The caller owns the transaction, which lets an object's
deletion and the deletion of its stars land together.
"""

from collections.abc import Sequence

from sqlalchemy import Select, delete, literal, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from veodyn_api.models import Favorite


def starred(db: Session, org_slug: str, user_id: int) -> Sequence[tuple[str, str]]:
    """Every (object_type, object_id) this person has starred, oldest first."""
    return [
        (object_type, object_id)
        for object_type, object_id in db.execute(
            select(Favorite.object_type, Favorite.object_id)
            .where(Favorite.org_slug == org_slug, Favorite.user_id == user_id)
            .order_by(Favorite.created_at)
        ).all()
    ]


def add(
    db: Session,
    org_slug: str,
    user_id: int,
    object_type: str,
    object_id: str,
    exists: Select[tuple[str]],
) -> bool:
    """Star it, or leave it starred, if the object is still there.

    `exists` is a SELECT of the object being starred, written as INSERT..SELECT so
    the existence test and the write are ONE statement. A separate check leaves a
    window where a delete lands between them and the row points at nothing. No
    foreign key can close it: object_id addresses two different tables.

    Returns whether a row was written, so the caller can tell "already starred"
    from "nothing there to star". Read from RETURNING, not rowcount: an
    INSERT..SELECT reports -1 there.
    """
    written = db.execute(
        insert(Favorite)
        .from_select(
            ["org_slug", "user_id", "object_type", "object_id"],
            select(
                literal(org_slug),
                literal(user_id),
                literal(object_type),
                literal(object_id),
            ).where(exists.exists()),
        )
        .on_conflict_do_nothing()
        .returning(Favorite.object_id)
    ).first()
    return written is not None


def has(db: Session, org_slug: str, user_id: int, object_type: str, object_id: str) -> bool:
    """Whether this person has already starred it.

    Only asked after an insert wrote nothing, which `on_conflict_do_nothing`
    reports the same way whether the star already exists (204) or the object does
    not (404).
    """
    return (
        db.execute(
            select(Favorite.object_id).where(
                Favorite.org_slug == org_slug,
                Favorite.user_id == user_id,
                Favorite.object_type == object_type,
                Favorite.object_id == object_id,
            )
        ).first()
        is not None
    )


def remove(db: Session, org_slug: str, user_id: int, object_type: str, object_id: str) -> None:
    """Unstar it, or leave it unstarred."""
    db.execute(
        delete(Favorite).where(
            Favorite.org_slug == org_slug,
            Favorite.user_id == user_id,
            Favorite.object_type == object_type,
            Favorite.object_id == object_id,
        )
    )


def forget_object(db: Session, org_slug: str, object_type: str, object_id: str) -> None:
    """Drop EVERYONE's star on one object, for when the object itself goes.

    A left-behind row is invisible until an id is reused, when the new object
    arrives pre-starred for whoever starred the old one.
    """
    db.execute(
        delete(Favorite).where(
            Favorite.org_slug == org_slug,
            Favorite.object_type == object_type,
            Favorite.object_id == object_id,
        )
    )

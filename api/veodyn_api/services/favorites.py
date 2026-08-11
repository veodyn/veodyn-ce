"""Reading and writing one person's stars.

Kept out of the router for the usual reason here: the delete path is also called
from the KPI and report routers, and a second copy of that statement is how one
of them ends up leaving rows behind.

None of these commit. The caller owns the transaction, which is what lets an
object's deletion and the deletion of its stars land together.
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

    `exists` is a SELECT of the object being starred, and the insert is written
    as INSERT..SELECT against it so the existence test and the write are ONE
    statement. Checking first and inserting second leaves a window: a delete
    landing in between writes a row pointing at nothing, which is invisible
    (favorites are read by intersecting them with a list) right up until the id
    is reused and the new object arrives pre-starred for a stranger. A foreign
    key cannot close it, because object_id addresses two different tables.

    Returns whether a row was actually written, so the caller can tell "already
    starred" from "there is nothing there to star". Read from RETURNING and not
    from rowcount: an INSERT..SELECT reports -1 there, which compares equal to
    nothing useful and made this look like a success every time.

    The row IS the fact, so a second press is the same state rather than a
    conflict: two tabs on one star must not make either look broken.
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
    reports the same way for both of its reasons: the star is already there, or
    the object is not. Those are a 204 and a 404, so they have to be told apart.
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

    A favorite is only ever read by intersecting it with a list, so a row left
    behind is invisible rather than wrong. It stops being invisible the day an
    id is reused: the new object would arrive pre-starred for whoever had
    starred the old one.
    """
    db.execute(
        delete(Favorite).where(
            Favorite.org_slug == org_slug,
            Favorite.object_type == object_type,
            Favorite.object_id == object_id,
        )
    )

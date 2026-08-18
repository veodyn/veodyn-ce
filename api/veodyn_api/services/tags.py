"""Reading and writing the tags this service owns: KPIs, reports and datasets.

Redash stays authoritative for query and dashboard tags. What counts as a tag
(normalization, the reserved prefix, the size caps) is tag_rules.py.

Every write to one object's tag set takes an advisory lock on that object first
(`_lock_object`), and so does the cleanup a deletion runs. None of these commit:
the caller owns the transaction, which is what lets an object's deletion and the
deletion of its tags land together.
"""

import hashlib
from collections.abc import Sequence

from sqlalchemy import Select, delete, func, literal, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from veodyn_api.models import TagAssignment
from veodyn_api.services.tag_rules import RESERVED_PREFIX


def _lock_key(org_slug: str, object_type: str, object_id: str) -> int:
    """The bigint `pg_advisory_xact_lock` takes, from the object's three-part key.

    blake2b rather than Python's `hash()`, which is salted per process, so two
    workers would derive two keys for one object. Joined on NUL, which no part
    can contain, so ("a", "b") and ("ab", "") cannot collapse into one key.
    """
    key = "\x00".join((org_slug, object_type, object_id))
    return int.from_bytes(hashlib.blake2b(key.encode(), digest_size=8).digest(), "big", signed=True)


def _lock_object(db: Session, org_slug: str, object_type: str, object_id: str) -> None:
    """Hold this object's tag lock until the caller's transaction ends.

    Two races, one lock: two replaces of one object interleaving into the union
    of both sets, and a replace racing the object's own deletion into orphan rows
    that keep voting in the vocabulary count. `forget_object` takes the same lock.

    Advisory rather than SELECT .. FOR UPDATE because a dataset has no row to
    lock: its id is a ClickHouse registry table name. `pg_advisory_xact_lock`
    rather than the session-scoped pair, because it releases at rollback too.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _lock_key(org_slug, object_type, object_id)})


def tags_for(db: Session, org_slug: str, object_type: str, object_id: str) -> list[str]:
    """Every tag on one object, sorted."""
    return sorted(
        db.scalars(
            select(TagAssignment.tag).where(
                TagAssignment.org_slug == org_slug,
                TagAssignment.object_type == object_type,
                TagAssignment.object_id == object_id,
            )
        ).all()
    )


def tags_by_object(db: Session, org_slug: str, object_type: str, object_ids: Sequence[str]) -> dict[str, list[str]]:
    """The tags of many objects at once, keyed by id, each list sorted.

    One statement for a whole list page. Objects with no tags are absent from the
    mapping rather than present with an empty list.
    """
    if not object_ids:
        return {}
    rows = db.execute(
        select(TagAssignment.object_id, TagAssignment.tag).where(
            TagAssignment.org_slug == org_slug,
            TagAssignment.object_type == object_type,
            TagAssignment.object_id.in_(list(object_ids)),
        )
    ).all()
    by_object: dict[str, list[str]] = {}
    for object_id, tag in rows:
        by_object.setdefault(object_id, []).append(tag)
    return {object_id: sorted(tags) for object_id, tags in by_object.items()}


def tags_by_org(db: Session, org_slug: str, object_type: str) -> dict[str, list[str]]:
    """Every tagged object of one kind in an org, keyed by id, each list sorted.

    For the catalog, where the ids are not this service's to enumerate: a dataset
    id is a ClickHouse registry table name, so asking for "the tags of these ids"
    would mean waiting for the warehouse read first.
    """
    rows = db.execute(
        select(TagAssignment.object_id, TagAssignment.tag).where(
            TagAssignment.org_slug == org_slug,
            TagAssignment.object_type == object_type,
        )
    ).all()
    by_object: dict[str, list[str]] = {}
    for object_id, tag in rows:
        by_object.setdefault(object_id, []).append(tag)
    return {object_id: sorted(tags) for object_id, tags in by_object.items()}


def replace(
    db: Session,
    org_slug: str,
    object_type: str,
    object_id: str,
    tags: Sequence[str],
    exists: Select[tuple[str]] | None = None,
) -> list[str]:
    """Make `tags` the whole set for this object, and report what is stored.

    The advisory lock comes first, before anything is read or written. See
    `_lock_object`.

    `exists` is a SELECT of the object being tagged. Both the delete and the
    insert are gated on it, so each is one statement rather than a check followed
    by a write, and a concurrent delete cannot land the clearing half alone. A
    foreign key cannot close this, because object_id addresses two tables and,
    for a dataset, no table at all.

    Returned by reading the table back rather than by echoing the argument: the
    contract is "what is stored", and after a concurrent delete that is nothing.
    """
    _lock_object(db, org_slug, object_type, object_id)

    gate = [exists.exists()] if exists is not None else []

    db.execute(
        delete(TagAssignment).where(
            TagAssignment.org_slug == org_slug,
            TagAssignment.object_type == object_type,
            TagAssignment.object_id == object_id,
            *gate,
        )
    )
    # One statement per tag rather than a VALUES join: a tag set is a handful of
    # labels, so each write stays the same gated INSERT..SELECT shape.
    for tag in tags:
        db.execute(
            insert(TagAssignment)
            .from_select(
                ["org_slug", "object_type", "object_id", "tag"],
                select(
                    literal(org_slug),
                    literal(object_type),
                    literal(object_id),
                    literal(tag),
                ).where(*gate),
            )
            .on_conflict_do_nothing()
        )

    return tags_for(db, org_slug, object_type, object_id)


def vocabulary(db: Session, org_slug: str) -> list[tuple[str, int]]:
    """Every tag in use in this org and how many objects carry it.

    Unioned across the three kinds, because the point of the vocabulary is
    cross-entity pivoting. Reserved tags are excluded here as well as refused on
    write, so a row that predates the refusal can still never be suggested.
    Sorted by count descending then name ascending, so a tie is stable.
    """
    return [
        (tag, count)
        for tag, count in db.execute(
            select(TagAssignment.tag, func.count().label("count"))
            .where(
                TagAssignment.org_slug == org_slug,
                ~TagAssignment.tag.startswith(RESERVED_PREFIX),
            )
            .group_by(TagAssignment.tag)
            .order_by(func.count().desc(), TagAssignment.tag.asc())
        ).all()
    ]


def forget_object(db: Session, org_slug: str, object_type: str, object_id: str) -> None:
    """Drop every tag on one object, for when the object itself goes.

    A tag row left behind keeps voting in the vocabulary count, and ids here are
    minted from the name, so a reused id arrives wearing the old object's labels.
    Every path that deletes a taggable object has to come through here.

    Takes the same lock `replace` does, held until the caller commits the
    object's deletion, so a tag write that started before cannot land after.
    """
    _lock_object(db, org_slug, object_type, object_id)

    db.execute(
        delete(TagAssignment).where(
            TagAssignment.org_slug == org_slug,
            TagAssignment.object_type == object_type,
            TagAssignment.object_id == object_id,
        )
    )

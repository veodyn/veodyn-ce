"""Reading and writing the tags this service owns.

Kept out of the router for the same reason favorites.py is: the read is called
from three view paths (KPI, report, catalog) and the cleanup is called from two
delete endpoints, and a second copy of either statement is how one of them ends
up disagreeing with the other.

Redash stays authoritative for query and dashboard tags. This module covers
only KPIs, reports and datasets. Mirroring Redash's tags in here was rejected in
the design: it would create two writable copies of the same fact, and Redash's
server-side tag filtering is worth keeping.

What counts as a tag (normalization, the reserved prefix, the size caps) is
tag_rules.py. This module is the statements.

Every write to one object's tag set takes an advisory lock on that object first,
and so does the cleanup a deletion runs. One lock covers both ways two writers
can corrupt a set; the reasoning is on `_lock_object`, and anything new that
writes this table belongs behind it too.

None of these commit. The caller owns the transaction, which is what lets an
object's deletion and the deletion of its tags land together, and what makes the
advisory lock cover the whole of both.
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

    blake2b rather than Python's `hash()`: the built-in string hash is salted
    per process, so two API workers would derive two different keys for the same
    object and the lock would serialize nothing while looking like it did. An
    8-byte digest read as a signed integer lands inside bigint's range with no
    folding, and is stable across processes, releases and Python versions.

    The three parts are joined on a NUL byte, which no org slug, object type or
    id can contain, so ("a", "b") and ("ab", "") cannot collapse into one key. A
    digest collision between two unrelated objects is possible in principle and
    costs one needless wait, never a wrong answer: the lock decides ordering and
    the gates below still decide what is written.
    """
    key = "\x00".join((org_slug, object_type, object_id))
    return int.from_bytes(hashlib.blake2b(key.encode(), digest_size=8).digest(), "big", signed=True)


def _lock_object(db: Session, org_slug: str, object_type: str, object_id: str) -> None:
    """Hold this object's tag lock until the caller's transaction ends.

    Two hazards, one lock. The first is two replaces of the same object at once:
    each deletes the other's rows before either has committed, so neither delete
    finds anything to remove, both inserts then hit primary keys that do not
    collide, and the stored set ends up the union of two sets nobody asked for.
    `on_conflict_do_nothing` cannot help with that, precisely because the keys do
    not collide.

    The second is a replace racing the object's own deletion. The delete clears
    the tags and drops the object in one transaction; a stale detail page PUTs
    tags meanwhile, and under READ COMMITTED its gate still sees the pre-delete
    object, so it writes rows the cleanup has already run past. What survives is
    an orphan that keeps voting in the vocabulary count and re-tags the next
    object to take that id. `forget_object` takes this same lock, which is what
    makes the two paths queue instead of interleave: the loser re-reads after the
    winner commits, and its gate then tells it the truth.

    An advisory lock rather than SELECT .. FOR UPDATE on the object, because a
    dataset has no row to lock at all: its id is a ClickHouse registry table
    name. A row lock would cover two of the three taggable kinds and leave the
    third uncovered, which is how one mechanism turns into two.

    `pg_advisory_xact_lock` rather than the session-scoped pair: it releases at
    commit AND at rollback, so no error path can leak a lock that then blocks
    every later write to that object for the life of the connection.
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

    One statement for a whole list page: a read per row would be an N+1 on the
    KPI list, which is the busiest page in the product. Objects with no tags are
    absent from the mapping rather than present with an empty list, so the
    caller's `.get(id, [])` is the only place the default is spelled.
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

    For the catalog, where the ids are not this service's to enumerate: a
    dataset id is a ClickHouse registry table name, so asking for "the tags of
    these ids" would mean waiting for the warehouse read before starting this
    one. Whole-org rather than paged because an org's tag table is small by
    construction, one row per object per label.
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

    The advisory lock comes first, before anything is read or written, because
    replace is a read-modify-write of a whole set and two of them interleaving
    produce a union rather than either set. See `_lock_object`.

    `exists` is a SELECT of the object being tagged, and both statements are
    gated on it so the write and the existence test are one statement each,
    exactly as favorites.add is. Checking first and writing second leaves a
    window: a delete landing in between writes rows pointing at nothing, which
    are invisible (tags are read by object id) right up until the id is reused
    and a stranger's object arrives pre-tagged. A foreign key cannot close it,
    because object_id addresses two different tables and, for a dataset, no
    table at all. The lock is what makes that gate trustworthy rather than
    merely likely: whoever waits on it re-reads after the other side committed.

    The delete is gated too, not only the insert. Ungated, a concurrent delete
    of the object would let the clearing half land and the writing half not,
    which is the one outcome neither the caller nor the next reader asked for.

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
    # One statement per tag rather than a VALUES join. A tag set is a handful of
    # labels a person typed, so the round trips are cheap, and every statement
    # here is then the same INSERT..SELECT shape favorites already uses, which
    # is the part that has to be right.
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

    Unioned across the three kinds rather than reported per kind, because the
    point of the vocabulary is cross-entity pivoting: tagging a report `rail`
    should suggest the `rail` already sitting on twelve KPIs. Each row of the
    table is one object, so a plain count sums across kinds by construction.

    Reserved tags are excluded here as well as refused on write, so a row that
    predates the refusal can still never be suggested.

    Sorted by count descending then name ascending: most-used first, and a tie
    broken by something stable rather than by whatever order Postgres grouped.
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

    The same cleanup favorites.forget_object does, and for a sharper reason: a
    tag row left behind is not merely invisible, it keeps voting in the
    vocabulary count, so `rail` would claim twelve objects while eleven exist.
    And ids here are minted from the name, so the day one is reused the new
    object arrives wearing the old one's labels.

    Takes the same lock `replace` does, and that is what closes the race between
    them: the caller holds it from here until it commits the object's deletion,
    so a tag write that started before cannot land its rows after this statement
    has already swept. Any future path that deletes a taggable object has to
    come through here for the reason it already had to, which is that the
    vocabulary count is wrong otherwise.
    """
    _lock_object(db, org_slug, object_type, object_id)

    db.execute(
        delete(TagAssignment).where(
            TagAssignment.org_slug == org_slug,
            TagAssignment.object_type == object_type,
            TagAssignment.object_id == object_id,
        )
    )

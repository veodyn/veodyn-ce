"""The two ways a tag write can race, exercised against the real database.

Both tests open two live sessions on the test engine and run one of them on a
thread, because the whole question is what Postgres does when two transactions
overlap. A test that asserted `pg_advisory_xact_lock` had been called would pass
an implementation that took the lock on the wrong key, or after the delete, or
in a session that commits before the write it was meant to protect, which are
the three ways this could be written wrong.

The shape of each is the same: transaction A does its half and does NOT commit,
transaction B is started on a thread and must block, A commits, B is let
through, and the assertion is what a THIRD session sees afterwards. B's own
return value is no good as evidence, since it reports only what B's transaction
could see.
"""

import threading
from collections.abc import Callable, Iterator

import pytest
from sqlalchemy import Engine, delete, select
from sqlalchemy.orm import Session

from tests.fixture_objects import FIXTURE_KIND, Widget
from veodyn_api.services import tags as tag_service

ORG = "default"
OBJECT_ID = "on-time-performance"
KIND = FIXTURE_KIND

# How long a queued transaction is given to prove it is queued. Generous
# relative to a lock acquisition on localhost, and it only ever delays a test
# that is about to fail anyway.
BLOCKED_FOR = 1.0
# How long the freed transaction is given to finish once the other side commits.
FINISHES_IN = 15.0


@pytest.fixture
def open_session(engine: Engine, db: Session) -> Iterator[Callable[[], Session]]:
    """Hand out sessions on the test engine, and close them however a test ends.

    `db` is requested for its teardown rather than for itself: that fixture is
    what TRUNCATEs the tables afterwards, and the TRUNCATE would hang forever
    behind a session of ours still holding a lock. Rolled back before closing
    for the same reason, since a test that fails mid-race leaves one open.
    """
    opened: list[Session] = []

    def _open() -> Session:
        session = Session(bind=engine, expire_on_commit=False)
        opened.append(session)
        return session

    yield _open

    for session in opened:
        session.rollback()
        session.close()


class _Background:
    """The second transaction, running where the first one can block it."""

    def __init__(self, work: Callable[[], None]) -> None:
        self._work = work
        self.started = threading.Event()
        self.error: Exception | None = None
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        self.started.set()
        try:
            self._work()
        except Exception as exc:
            # Kept rather than raised here: an exception on a worker thread is
            # invisible to pytest, so the test would pass while the work failed.
            self.error = exc

    def start(self) -> "_Background":
        self.thread.start()
        assert self.started.wait(BLOCKED_FOR), "the second transaction never ran at all"
        return self

    def is_blocked(self) -> bool:
        self.thread.join(timeout=BLOCKED_FOR)
        return self.thread.is_alive()

    def finish(self) -> None:
        self.thread.join(timeout=FINISHES_IN)
        assert not self.thread.is_alive(), "the second transaction never came out of the lock"
        if self.error is not None:
            raise self.error


def _an_object() -> Widget:
    """The registered fixture kind's row. It was a Kpi until that model left with
    the pack; what this test needs of it is a table keyed (org_slug, id) that the
    tag write can gate on, which is exactly what any taggable kind gives it."""
    return Widget(org_slug=ORG, id=OBJECT_ID, name="On-Time Performance", owner_user_id=7)


def test_two_replaces_of_one_object_cannot_merge_into_a_union(open_session: Callable[[], Session]) -> None:
    """Replace means one set or the other, never both.

    The defect: both transactions DELETE before either INSERTs, so neither
    delete finds the other's rows, the primary keys they then insert do not
    collide, `on_conflict_do_nothing` has nothing to do, and an untagged object
    that received `["rail"]` and `["bus"]` at once ends up carrying both.

    A dataset is the subject on purpose. It has no row anywhere to lock, its id
    being a ClickHouse registry table name, so this is the case a
    SELECT .. FOR UPDATE on the object could not have covered.
    """
    first = open_session()
    second = open_session()

    tag_service.replace(first, ORG, "dataset", "trips", ["rail"])

    def _second_replace() -> None:
        tag_service.replace(second, ORG, "dataset", "trips", ["bus"])
        second.commit()

    background = _Background(_second_replace).start()
    assert background.is_blocked(), "the second replace ran while the first still held the object"

    first.commit()
    background.finish()

    assert tag_service.tags_for(open_session(), ORG, "dataset", "trips") == ["bus"]


def test_a_tag_write_cannot_survive_the_delete_it_raced(open_session: Callable[[], Session]) -> None:
    """A write that started before the object was deleted leaves nothing behind.

    The delete transaction here is exactly what an object's own delete handler
    does, in that order: clear the tags, drop the object, commit. The defect is
    that a stale detail page PUTting tags in the meantime still sees the
    pre-delete object under READ COMMITTED, so its gate passes and it writes
    rows after the cleanup has already swept past them.

    The survivor is not merely junk. It keeps voting in the GET /tags count, so
    the vocabulary claims more objects than exist, and ids here are minted from
    the name, so recreating the same object resurrects the dead one's labels.
    """
    setup = open_session()
    setup.add(_an_object())
    setup.commit()

    deleting = open_session()
    tagging = open_session()
    exists = select(Widget.id).where(Widget.org_slug == ORG, Widget.id == OBJECT_ID)

    tag_service.forget_object(deleting, ORG, KIND, OBJECT_ID)
    deleting.execute(delete(Widget).where(Widget.org_slug == ORG, Widget.id == OBJECT_ID))

    def _late_tag_write() -> None:
        tag_service.replace(tagging, ORG, KIND, OBJECT_ID, ["rail"], exists)
        tagging.commit()

    background = _Background(_late_tag_write).start()
    assert background.is_blocked(), "the tag write ran while the delete still held the object"

    deleting.commit()
    background.finish()

    assert tag_service.tags_for(open_session(), ORG, KIND, OBJECT_ID) == []


def test_the_lock_key_is_stable_and_specific() -> None:
    """Two things the key has to be, neither of which the racing tests can see.

    Stable across processes, or two API workers derive two keys for one object
    and queue behind nothing. That is what rules out Python's own `hash()`,
    whose string salt changes per interpreter, so the literal below is the
    assertion: it fails if the derivation ever changes, which is the point.

    Specific, or every tag write in the org queues behind every other one. The
    NUL join is what stops ("a", "b") and ("ab", "") colliding into one key.
    """
    key = tag_service._lock_key(ORG, "kpi", OBJECT_ID)

    assert key == tag_service._lock_key(ORG, "kpi", OBJECT_ID)
    assert key == -4810851191128023584
    assert len({tag_service._lock_key(ORG, kind, OBJECT_ID) for kind in ("kpi", "report", "dataset")}) == 3
    assert tag_service._lock_key("a", "b", "c") != tag_service._lock_key("ab", "", "c")
    assert tag_service._lock_key(ORG, "kpi", OBJECT_ID) != tag_service._lock_key("other", "kpi", OBJECT_ID)

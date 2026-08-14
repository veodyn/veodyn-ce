"""One publish attempt and, when it succeeded, the bytes it produced.

Identity is (binding revision, query_result_id), which is what makes an
artifact traceable to both the mapping that produced it and the data it came
from. A binding edit bumps the revision, so an artifact produced under the old
mapping can never be mistaken for a current one.

`is_current` is the published pointer. Exactly one row per feed may carry it,
enforced by a partial unique index rather than by application care: two writers
racing a publish is not a rare case, and "clear the old one first" is a habit
every future caller would have to keep rather than a rule the database keeps
for them.

The partial index predicate is a **SQL expression**, `text("is_current")`, not
`Boolean("is_current")`. `Boolean` is a SQLAlchemy type; calling it builds a
type instance whose constructor argument is `create_constraint`, so that
spelling silently produces an index with no predicate at all, which is a full
unique index on (org_slug, slug) and refuses the second attempt for a feed
whatever its decision. `0012_publish_attempt.py` writes `sa.text("is_current")`
and these two have to agree, because tests build the schema from this metadata
while production gets it from the migration.

Every default here is a `server_default` matching that migration, for the same
reason `PublishedFeed` gives: `Base.metadata.create_all()` is what the test
database is built from, so a Python-side `default=` would describe a table the
tests never see and let a raw INSERT diverge between the two.

**There is no foreign key to `published_feed`, and that is a live hazard rather
than a design choice.** `(org_slug, slug)` names a binding that this table does
not depend on, so deleting a binding leaves its attempts behind with
`is_current` still set. Recreate the same slug and the new binding inherits the
old one's published bytes from its first moment, before it has validated
anything. `routers/published_feeds.py` closes that today by clearing the pointer
on delete, and it is currently the only code path that deletes a binding, so the
hole is shut. But it is shut by one call site remembering to, which is exactly
the kind of guarantee the partial index above was given to the database instead
of to callers. A cascading foreign key would make it structural; that is a
migration this task did not take, and the serving endpoint is the work that
would be embarrassed by getting it wrong.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    LargeBinary,
    PrimaryKeyConstraint,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base


class PublishAttempt(Base):
    __tablename__ = "publish_attempt"
    __table_args__ = (
        # Spelled out because `attempt_id` is the autoincrement column, and an
        # implicit composite key puts that column first: the metadata builds
        # (attempt_id, org_slug, slug) while `0012_publish_attempt.py` builds
        # (org_slug, slug, attempt_id). Only the second is prefixed by the
        # tenant, which is how every read of this table addresses it. Two
        # different indexes under one name is exactly the divergence the tests
        # cannot see, because they build their schema from here and production
        # gets it from the migration.
        PrimaryKeyConstraint("org_slug", "slug", "attempt_id"),
        CheckConstraint(
            "decision IN ('published', 'blocked', 'failed')",
            name="ck_publish_attempt_decision",
        ),
        # Bytes exist if and only if the attempt published. A blocked attempt
        # holding servable bytes is one mistake away from being served, and the
        # whole point of blocking was that those bytes are not fit to serve.
        CheckConstraint(
            "(decision = 'published') = (feed_bytes IS NOT NULL)",
            name="ck_publish_attempt_bytes_match_decision",
        ),
        Index(
            "uq_publish_attempt_current",
            "org_slug",
            "slug",
            unique=True,
            postgresql_where=text("is_current"),
        ),
    )

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    slug: Mapped[str] = mapped_column(Text, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    binding_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    query_result_id: Mapped[int] = mapped_column(Integer, nullable=False)

    # published | blocked | failed
    decision: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, server_default="")

    # Null unless the attempt published: blocked and failed attempts are kept
    # for the record, but their bytes were never fit to serve.
    feed_bytes: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    feed_timestamp: Mapped[int | None] = mapped_column(Integer, nullable=True)

    findings: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, server_default="[]")
    # A green verdict has to state what it covered: a rule that never ran is
    # not a rule that passed.
    enabled_rules: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default="[]")

    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

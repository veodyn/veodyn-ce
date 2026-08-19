"""One publish attempt and, when it succeeded, the bytes it produced.

Identity is (binding revision, query_result_id), which makes an artifact
traceable to both the mapping that produced it and the data it came from. A
binding edit bumps the revision.

`is_current` is the published pointer, and exactly one row per feed may carry
it, enforced by a partial unique index rather than by application care. That
predicate has to be a **SQL expression**, `text("is_current")`, never
`Boolean("is_current")`: `Boolean` is a SQLAlchemy type whose constructor
argument is `create_constraint`, so that spelling silently produces an index with
no predicate, which is a full unique index on (org_slug, slug) and refuses the
second attempt for a feed whatever its decision. `0012_publish_attempt.py`
writes `sa.text("is_current")` and the two have to agree, because tests build the
schema from this metadata while production gets it from the migration.

Every default here is a `server_default` matching that migration, for the same
reason `PublishedFeed` gives.

**There is no foreign key to `published_feed`.** Deleting a binding leaves its
attempts behind with `is_current` still set, so recreating the same slug would
have the new binding inherit the old one's published bytes before it has
validated anything. `routers/published_feeds.py` clears the pointer on delete and
is the only path that deletes a binding, so the hole is shut by a call site
rather than structurally; a cascading foreign key is the migration that would
make it structural.
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
        # implicit composite key puts it first: the metadata would build
        # (attempt_id, org_slug, slug) while `0012_publish_attempt.py` builds
        # (org_slug, slug, attempt_id), the tenant-prefixed order every read of
        # this table uses.
        PrimaryKeyConstraint("org_slug", "slug", "attempt_id"),
        CheckConstraint(
            "decision IN ('published', 'blocked', 'failed')",
            name="ck_publish_attempt_decision",
        ),
        # An artifact exists if and only if the attempt published: a blocked
        # attempt holding a servable artifact is one mistake away from being
        # served. Which kind it is depends on the standard, and an attempt
        # carries one, never both.
        CheckConstraint(
            "(decision = 'published') = (feed_bytes IS NOT NULL OR feed_files IS NOT NULL)",
            name="ck_publish_attempt_artifact_matches_decision",
        ),
        CheckConstraint(
            "NOT (feed_bytes IS NOT NULL AND feed_files IS NOT NULL)",
            name="ck_publish_attempt_one_artifact_kind",
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

    # Filename to parsed JSON object: the served artifact of a gbfs publish.
    # Exactly one of feed_bytes / feed_files is set, per the CHECK above.
    # `none_as_null`, or a Python None is written as JSON `null`, which is NOT
    # NULL in SQL and makes a bytes-only attempt look like it holds both kinds.
    feed_files: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True), nullable=True)

    feed_timestamp: Mapped[int | None] = mapped_column(Integer, nullable=True)

    findings: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, server_default="[]")
    # A green verdict has to state what it covered: a rule that never ran is
    # not a rule that passed.
    enabled_rules: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default="[]")

    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

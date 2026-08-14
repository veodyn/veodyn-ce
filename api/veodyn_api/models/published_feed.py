"""A query declared to publish a standard feed.

Keyed (org_slug, slug) for the reason FeedExpectation is keyed (org_slug,
feed_id): a cross-tenant row must not be addressable by id alone. The slug is
also the public URL path, so the pair is both the identity and the address.

`revision` is bumped by any edit that changes what a feed is validated
against, and it is half of an artifact's identity. Without it a binding edit
would silently reuse an artifact produced under the old mapping, and the
endpoint would serve bytes nothing had validated in its current shape.

One `static_gtfs_ref`, because a node serves one agency. That is the tier
boundary the design turns on: a hub aggregating several agencies needs one
schedule per contributing node, since GTFS trip, route and stop identifiers
are not unique across agencies. Making this column plural is how this table
would become a hub table, and it is deliberately not.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base


class PublishedFeed(Base):
    __tablename__ = "published_feed"
    __table_args__ = (
        # `last_good` without a cap is an unbounded promise to serve stale
        # bytes, and a cap on `block` is that same promise under a name that
        # denies it. Both are refused here rather than in a validator, so a
        # direct database write cannot produce a binding the engine would have
        # to guess about.
        CheckConstraint(
            "(on_error = 'last_good') = (last_good_max_age_seconds IS NOT NULL)",
            name="ck_published_feed_cap_matches_mode",
        ),
        CheckConstraint(
            "on_error IN ('block', 'last_good')",
            name="ck_published_feed_on_error",
        ),
        CheckConstraint(
            "visibility IN ('private', 'public')",
            name="ck_published_feed_visibility",
        ),
    )

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    slug: Mapped[str] = mapped_column(Text, primary_key=True)

    # `server_default`, never a Python-side `default=`, and the same for
    # `on_error` and `visibility` below. `0011_published_feed.py` gives all
    # three a server default, so a model carrying only an ORM default describes
    # a different table from the one a migrated database has: the schema
    # `Base.metadata.create_all()` builds has no defaults at all, and a raw
    # INSERT that omits the column fails there while succeeding in production.
    # Nothing reports the divergence, because `migrations/env.py` configures
    # `compare_type` and not `compare_server_default`, so autogenerate never
    # looks at a default it did not create. Keep these equal to the migration
    # by hand; `FeedExpectation.updated_at` is the same arrangement.
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    query_id: Mapped[int] = mapped_column(Integer, nullable=False)

    standard: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(Text, nullable=False)
    entity: Mapped[str] = mapped_column(Text, nullable=False)

    static_gtfs_ref: Mapped[str] = mapped_column(Text, nullable=False)

    # Optional at node tier: provenance here usually names a provider, and a
    # single-provider feed has nothing to partition. It becomes required at
    # the hub, where a source is a node.
    source_column: Mapped[str | None] = mapped_column(Text, nullable=True)

    # spec field -> query column. JSONB rather than a child table: it is read
    # and written whole, never queried into.
    column_map: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False)

    on_error: Mapped[str] = mapped_column(Text, nullable=False, server_default="block")
    last_good_max_age_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    visibility: Mapped[str] = mapped_column(Text, nullable=False, server_default="private")

    created_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

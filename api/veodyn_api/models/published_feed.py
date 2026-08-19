"""A query declared to publish a standard feed.

Keyed (org_slug, slug), like CaptureExpectation, so a cross-tenant row is not
addressable by id alone. The slug is also the public URL path, so the pair is
both the identity and the address.

`revision` is bumped by any edit that changes what a feed is validated against,
and it is half of an artifact's identity: without it a binding edit would reuse
an artifact produced under the old mapping, and the endpoint would serve bytes
nothing had validated in its current shape.

One `static_gtfs_ref`, because a node serves one agency. A hub aggregating
several agencies needs one schedule per contributing node, since GTFS trip,
route and stop identifiers are not unique across agencies, so making this column
plural is how this table would become a hub table.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base


class PublishedFeed(Base):
    __tablename__ = "published_feed"
    __table_args__ = (
        # `last_good` without a cap is an unbounded promise to serve stale bytes,
        # and a cap on `block` is that promise under a name that denies it.
        # Refused here rather than in a validator, so a direct database write
        # cannot produce a binding the engine would have to guess about.
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
        # Each standard requires exactly one of these two and refuses the other,
        # so a binding cannot carry the half that belongs to the standard it is
        # not. Declared here as well as in the migration: tests build the schema
        # from this metadata, production gets it from `0014`.
        CheckConstraint(
            "(standard = 'gtfs-rt') = (static_gtfs_ref IS NOT NULL)",
            name="ck_published_feed_static_ref_matches_standard",
        ),
        CheckConstraint(
            "(standard = 'gbfs') = (system_info IS NOT NULL)",
            name="ck_published_feed_system_info_matches_standard",
        ),
        # `GET /public/feeds/<slug>` has no org segment, so a slug shared by two
        # `public` feeds leaves it unable to say which was meant, and refusing
        # that at read time would let any other org's administrator claim a
        # victim's slug and take their live feed dark. Unique here instead, so the
        # collision cannot be created. Partial, because a private feed is not
        # anonymously addressable and cannot collide.
        #
        # It is also the index the anonymous lookup needs: `slug` is the primary
        # key's SECOND column and so unusable as a leading key.
        Index(
            "uq_published_feed_public_slug",
            "slug",
            unique=True,
            postgresql_where=text("visibility = 'public'"),
        ),
    )

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    slug: Mapped[str] = mapped_column(Text, primary_key=True)

    # `server_default`, never a Python-side `default=`, here and for `on_error`
    # and `visibility` below. `0011_published_feed.py` gives all three a server
    # default, and `Base.metadata.create_all()` is what the test schema is built
    # from, so an ORM default would let a raw INSERT that omits the column fail in
    # tests and succeed in production. Nothing reports the divergence:
    # `migrations/env.py` configures `compare_type` and not
    # `compare_server_default`. Keep these equal to the migration by hand;
    # `CaptureExpectation.updated_at` is the same arrangement.
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    query_id: Mapped[int] = mapped_column(Integer, nullable=False)

    standard: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(Text, nullable=False)
    entity: Mapped[str] = mapped_column(Text, nullable=False)

    static_gtfs_ref: Mapped[str | None] = mapped_column(Text, nullable=True)

    # The system-level GBFS declaration (system_id, language, name, timezone,
    # and 3.0's two extras). Not query output, so it lives on the binding.
    # `none_as_null`, or a Python None is written as JSON `null`, which is NOT
    # NULL in SQL and satisfies the standard CHECK it is supposed to violate.
    system_info: Mapped[dict[str, str] | None] = mapped_column(JSONB(none_as_null=True), nullable=True)

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

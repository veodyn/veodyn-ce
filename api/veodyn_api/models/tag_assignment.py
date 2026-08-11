from datetime import datetime

from sqlalchemy import DateTime, Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base


class TagAssignment(Base):
    """One tag on one object, for the object kinds this service owns.

    Everything about this table is the primary key: the org, what kind of thing
    it is, which one, and the label. That makes the row itself the fact, so
    applying the same tag twice is the same state as applying it once and needs
    no uniqueness constraint of its own. It also makes a cross-tenant row
    impossible to address by object id alone, the same reason org_slug is part
    of the key on Kpi, Report and Favorite.

    Unlike Favorite there is no user_id, and that is the whole difference
    between the two tables: a star is one person's opinion, a tag is an
    org-shared fact. Two people tagging the same report `rail` are stating the
    same thing once, not twice, and either of them removing it removes it.

    object_type is a plain string rather than an enum type, for the reason the
    Favorite docstring gives: the set is small and checked at the route (`kpi`,
    `report`, `dataset`), and a database enum would need a migration to add the
    next taggable kind for no integrity this does not already have. A row
    pointing at nothing is prevented by gating the write on a SELECT of the
    object, not by the column type. `dataset` could not have a foreign key even
    in principle: a dataset has no row here, its id is a ClickHouse registry
    table name.

    Tags are stored normalized (trimmed, inner whitespace collapsed, lowercased)
    and never with the reserved `domain:` prefix, both enforced on the way in by
    services/tags.py. Storing them normalized is what lets matching stay exact:
    `rail`, `Rail` and `rail ` would otherwise be three unrelated tags and
    discovery would quietly degrade.
    """

    __tablename__ = "tag_assignment"

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    object_type: Mapped[str] = mapped_column(Text, primary_key=True)
    object_id: Mapped[str] = mapped_column(Text, primary_key=True)
    tag: Mapped[str] = mapped_column(Text, primary_key=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # The primary key already serves "the tags on this object" as a leading
    # column prefix. This one serves the other direction: the vocabulary count
    # (GET /tags groups by tag within an org) and any future tag-to-objects
    # lookup, neither of which can use the key at all.
    __table_args__ = (Index("ix_tag_assignment_org_tag", "org_slug", "tag"),)

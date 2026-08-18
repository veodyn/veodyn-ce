from datetime import datetime

from sqlalchemy import DateTime, Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base


class TagAssignment(Base):
    """One tag on one object, for the object kinds this service owns.

    Every column is in the primary key, so applying a tag twice is the same
    state as applying it once and a cross-tenant row cannot be addressed by
    object id alone. There is no user_id: a tag is an org-shared fact, unlike a
    Favorite's star.

    object_type is a plain string, not a database enum, and is checked at the
    route (`kpi`, `report`, `dataset`); the write is gated on a SELECT of the
    object. `dataset` could not carry a foreign key at all, its id is a
    ClickHouse registry table name.

    Tags are stored normalized (trimmed, inner whitespace collapsed, lowercased)
    and never with the reserved `domain:` prefix, both enforced on the way in by
    services/tags.py, which is what keeps matching exact.
    """

    __tablename__ = "tag_assignment"

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    object_type: Mapped[str] = mapped_column(Text, primary_key=True)
    object_id: Mapped[str] = mapped_column(Text, primary_key=True)
    tag: Mapped[str] = mapped_column(Text, primary_key=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # The key's leading columns serve "the tags on this object"; this index
    # serves the other direction, the org vocabulary count behind GET /tags.
    __table_args__ = (Index("ix_tag_assignment_org_tag", "org_slug", "tag"),)

from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base


class Favorite(Base):
    """One person's star on one object.

    Every column is in the primary key, so starring twice is the same state as
    starring once and a cross-tenant or cross-user row cannot be addressed by
    object id alone. The user id is Redash's, never a display name: a name would
    follow the wrong person after a rename.

    object_type is a plain string, not a database enum, and is checked at the
    route (`kpi`, `report`); the object is looked up before the write.
    """

    __tablename__ = "favorite"

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    object_type: Mapped[str] = mapped_column(Text, primary_key=True)
    object_id: Mapped[str] = mapped_column(Text, primary_key=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

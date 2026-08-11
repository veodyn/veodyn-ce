from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base


class Favorite(Base):
    """One person's star on one object.

    Everything about this table is the primary key: the org, the person, what
    kind of thing it is and which one. That makes the row itself the fact, so
    starring twice is the same state as starring once and needs no uniqueness
    constraint of its own. It also makes a cross-tenant or cross-user row
    impossible to address by object id alone, the same reason org_slug is part
    of the key on Kpi and Report.

    The user id is Redash's, never a display name: this service stores no users,
    and a row keyed on a name would follow the wrong person after a rename.

    object_type is a plain string rather than an enum type. The set is small and
    checked at the route (`kpi`, `report`), and a database enum would need a
    migration to add the next kind for no integrity this does not already have:
    a row pointing at nothing is prevented by looking the object up before the
    write, not by the column type.
    """

    __tablename__ = "favorite"

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    object_type: Mapped[str] = mapped_column(Text, primary_key=True)
    object_id: Mapped[str] = mapped_column(Text, primary_key=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

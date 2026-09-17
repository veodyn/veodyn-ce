from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, DateTime, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base

DELIVERY_UNTESTED = "untested"
DELIVERY_DELIVERING = "delivering"
DELIVERY_FAILING = "failing"


class ConnectorConfiguration(Base):
    __tablename__ = "connector_configuration"
    __table_args__ = (
        CheckConstraint(
            "(last_delivery_at IS NULL) = (last_delivery_delivered IS NULL)",
            name="ck_connector_configuration_delivery_pair",
        ),
    )

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    connector_id: Mapped[str] = mapped_column(Text, primary_key=True)

    name: Mapped[str] = mapped_column(Text, nullable=False)

    credentials: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    credentials_verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    last_delivery_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_delivery_delivered: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_delivery_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<ConnectorConfiguration {self.org_slug}/{self.connector_id}>"

    @property
    def delivery_health(self) -> str:
        if self.last_delivery_at is None:
            return DELIVERY_UNTESTED
        return DELIVERY_DELIVERING if self.last_delivery_delivered else DELIVERY_FAILING

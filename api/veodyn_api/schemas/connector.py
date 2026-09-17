from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from veodyn_api.schemas.catalog import CamelModel


class CredentialCarrier(CamelModel):
    def __repr__(self) -> str:
        return f"<{type(self).__name__}>"

    def __str__(self) -> str:
        return f"<{type(self).__name__}>"


class CredentialPropertyOut(CamelModel):
    type: str
    title: str
    description: str | None = None


class CredentialSchemaOut(CamelModel):
    properties: dict[str, CredentialPropertyOut]
    required: list[str]
    clearable: list[str]
    secret: list[str]
    order: list[str]


class ContentContractOut(CamelModel):
    max_length: int | None
    supports_markup: bool
    url_counts_as_characters: int | None
    required_footer: str | None


class ConnectorTypeOut(CamelModel):
    connector_id: str
    display_name: str
    recallable: bool
    credential_schema: CredentialSchemaOut
    content_contract: ContentContractOut


class ConnectorHealthOut(CamelModel):
    delivery: Literal["untested", "delivering", "failing"]
    credentials_verified_at: datetime
    last_delivery_at: datetime | None
    last_delivery_detail: str | None


class ConnectorOut(CamelModel):
    connector_id: str
    display_name: str
    name: str
    recallable: bool
    configured_fields: list[str]
    health: ConnectorHealthOut


class ConnectorIn(CredentialCarrier):
    connector_id: str
    name: str
    credentials: dict[str, Any] = Field(default_factory=dict)


class ConnectorUpdateIn(CredentialCarrier):
    name: str
    replace: dict[str, Any] = Field(default_factory=dict)
    clear: list[str] = Field(default_factory=list)

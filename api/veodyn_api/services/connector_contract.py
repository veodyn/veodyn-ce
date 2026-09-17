from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol, final

from veodyn_api.services.connector_compose_contract import (
    DEFAULT_COMPOSE_CONTRACT as DEFAULT_COMPOSE_CONTRACT,
)
from veodyn_api.services.connector_compose_contract import (
    BoundCap as BoundCap,
)
from veodyn_api.services.connector_compose_contract import (
    Cap as Cap,
)
from veodyn_api.services.connector_compose_contract import (
    ComposeContract as ComposeContract,
)
from veodyn_api.services.connector_compose_contract import (
    ContentContract as ContentContract,
)
from veodyn_api.services.connector_compose_contract import (
    Declared as Declared,
)
from veodyn_api.services.connector_compose_contract import (
    OverrideAsk as OverrideAsk,
)
from veodyn_api.services.connector_compose_contract import (
    RosterContract as RosterContract,
)
from veodyn_api.services.connector_compose_contract import (
    Section as Section,
)
from veodyn_api.services.connector_compose_contract import (
    SectionAsk as SectionAsk,
)
from veodyn_api.services.connector_compose_contract import (
    Wording as Wording,
)
from veodyn_api.services.connector_compose_contract import (
    merged_roster_contract as merged_roster_contract,
)

RENDERABLE_CREDENTIAL_TYPES = frozenset({"string", "number", "boolean"})
MASKABLE_CREDENTIAL_TYPES = frozenset({"string"})


class VerdictCode(StrEnum):
    REJECTED = "rejected"
    EXPIRED = "expired"
    INSUFFICIENT_SCOPE = "insufficient_scope"
    MALFORMED = "malformed"
    UNREACHABLE = "unreachable"
    UNSPECIFIED = "unspecified"


class DeliveryCode(StrEnum):
    DELIVERED = "delivered"
    REJECTED_BY_CHANNEL = "rejected_by_channel"
    CREDENTIALS_REJECTED = "credentials_rejected"
    CONTENT_REJECTED = "content_rejected"
    RATE_LIMITED = "rate_limited"
    PARTIALLY_DELIVERED = "partially_delivered"
    RECALL_TARGET_GONE = "recall_target_gone"
    CHANNEL_UNAVAILABLE = "channel_unavailable"
    CONNECTOR_RAISED = "connector_raised"
    UNSPECIFIED = "unspecified"


PERMANENT_DELIVERY_CODES: frozenset[DeliveryCode] = frozenset(
    {
        DeliveryCode.REJECTED_BY_CHANNEL,
        DeliveryCode.CREDENTIALS_REJECTED,
        DeliveryCode.CONTENT_REJECTED,
        DeliveryCode.RECALL_TARGET_GONE,
    }
)


def is_permanent(code: DeliveryCode) -> bool:
    return code in PERMANENT_DELIVERY_CODES


WITHHELD = "<delivery handle withheld>"

SUBCLASSING_REFUSED = (
    "DeliveryHandle is final. A subclass could choose how a handle renders, and every path that writes one out "
    "trusts the class to render it as nothing."
)


@final
class DeliveryHandle:
    __slots__ = ("_handle",)

    def __init_subclass__(cls, **kwargs: Any) -> None:
        raise TypeError(SUBCLASSING_REFUSED)

    def __init__(self, handle: str) -> None:
        self._handle = str(handle)

    def reveal(self) -> str:
        return self._handle

    def __repr__(self) -> str:
        return WITHHELD

    def __str__(self) -> str:
        return WITHHELD

    def __format__(self, spec: str) -> str:
        return WITHHELD


@dataclass(frozen=True)
class CredentialField:
    name: str
    title: str
    type: str = "string"
    secret: bool = True
    required: bool = True
    description: str | None = None


@dataclass(frozen=True)
class CredentialSchema:
    fields: tuple[CredentialField, ...]

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(field.name for field in self.fields)

    @property
    def required_names(self) -> tuple[str, ...]:
        return tuple(field.name for field in self.fields if field.required)

    @property
    def optional_names(self) -> tuple[str, ...]:
        return tuple(field.name for field in self.fields if not field.required)

    def field_named(self, name: str) -> CredentialField | None:
        for field in self.fields:
            if field.name == name:
                return field
        return None

    def titles_of(self, names: frozenset[str]) -> tuple[str, ...]:
        return tuple(field.title for field in self.fields if field.name in names)


@dataclass(frozen=True)
class Rendering:
    body: str
    language: str = "en"
    urls: tuple[str, ...] = ()


@dataclass(frozen=True)
class CredentialVerdict:
    accepted: bool
    code: VerdictCode = VerdictCode.UNSPECIFIED
    fields: tuple[str, ...] = ()


@dataclass(frozen=True)
class DeliveryOutcome:
    delivered: bool
    code: DeliveryCode = DeliveryCode.UNSPECIFIED
    reference: DeliveryHandle | None = None


class Connector(Protocol):
    @property
    def connector_id(self) -> str: ...

    @property
    def display_name(self) -> str: ...

    @property
    def credential_schema(self) -> CredentialSchema: ...

    @property
    def content_contract(self) -> ContentContract: ...

    @property
    def recallable(self) -> bool: ...

    def verify_credentials(self, credentials: Mapping[str, Any]) -> CredentialVerdict: ...

    def deliver(
        self, rendering: Rendering, credentials: Mapping[str, Any], idempotency_key: str
    ) -> DeliveryOutcome: ...

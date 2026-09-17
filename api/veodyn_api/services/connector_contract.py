from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal, Protocol, final

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
class ContentContract:
    max_length: int | None = None
    supports_markup: bool = False
    url_counts_as_characters: int | None = None
    required_footer: str | None = None


Wording = Literal["structured", "text"]

Section = Literal["classification", "entities", "active_period"]


@dataclass(frozen=True, slots=True)
class ComposeContract:
    wording: Wording = "text"
    asks_classification: bool = False
    requires_classification: bool = False
    asks_entities: bool = False
    requires_entities: bool = False
    asks_active_period: bool = False
    requires_active_period: bool = False
    carries_translations: bool = False
    accepts_override: bool = False

    def __post_init__(self) -> None:
        for asked, required, name in (
            (self.asks_classification, self.requires_classification, "classification"),
            (self.asks_entities, self.requires_entities, "entities"),
            (self.asks_active_period, self.requires_active_period, "an active period"),
        ):
            if required and not asked:
                raise ValueError(
                    f"a compose contract cannot require {name} without asking for it: asking is what puts the "
                    "field on the form, and a required field the form never shows can never be filled in."
                )


DEFAULT_COMPOSE_CONTRACT = ComposeContract()


@dataclass(frozen=True)
class Cap:
    limit: int
    url_counts_as_characters: int | None


@dataclass(frozen=True)
class SectionAsk:
    section: Section
    required: bool
    asked_by: tuple[str, ...]


@dataclass(frozen=True)
class OverrideAsk:
    channel: str
    cap: Cap | None


@dataclass(frozen=True)
class RosterContract:
    sections: tuple[SectionAsk, ...]
    wording: Wording
    wording_cap: Cap | None
    overrides: tuple[OverrideAsk, ...]


@dataclass(frozen=True)
class Declared:
    contract: ComposeContract
    content_contract: ContentContract


_SECTION_FIELDS: tuple[tuple[Section, str, str], ...] = (
    ("classification", "asks_classification", "requires_classification"),
    ("entities", "asks_entities", "requires_entities"),
    ("active_period", "asks_active_period", "requires_active_period"),
)

_Chosen = Sequence[tuple[str, Declared]]


def _cap_of(declared: Declared) -> Cap | None:
    max_length = declared.content_contract.max_length
    if max_length is None:
        return None
    return Cap(limit=max_length, url_counts_as_characters=declared.content_contract.url_counts_as_characters)


def _sections_asked(chosen: _Chosen) -> tuple[SectionAsk, ...]:
    found: list[SectionAsk] = []
    for section, asks_field, requires_field in _SECTION_FIELDS:
        asked_by = tuple(channel for channel, declared in chosen if getattr(declared.contract, asks_field))
        if not asked_by:
            continue
        required = any(getattr(declared.contract, requires_field) for _, declared in chosen)
        found.append(SectionAsk(section=section, required=required, asked_by=asked_by))
    return tuple(found)


def _wording_of(chosen: _Chosen) -> Wording:
    structured = any(
        declared.contract.wording == "structured" or declared.contract.carries_translations for _, declared in chosen
    )
    return "structured" if structured else "text"


def _wording_cap(chosen: _Chosen, overridden: frozenset[str]) -> Cap | None:
    tightest: Cap | None = None
    for channel, declared in chosen:
        if declared.contract.wording != "text" or channel in overridden:
            continue
        cap = _cap_of(declared)
        if cap is None:
            continue
        if tightest is None or cap.limit < tightest.limit:
            tightest = cap
    return tightest


def _overrides_of(chosen: _Chosen, wording: Wording, overridden: frozenset[str]) -> tuple[OverrideAsk, ...]:
    accepting = [(channel, declared) for channel, declared in chosen if declared.contract.accepts_override]
    folded = wording == "text" and len(chosen) == 1 and len(accepting) == 1 and chosen[0][0] not in overridden
    if folded:
        return ()
    return tuple(OverrideAsk(channel=channel, cap=_cap_of(declared)) for channel, declared in accepting)


def merged_roster_contract(
    available: Mapping[str, Declared], selected: Iterable[str], overridden: Iterable[str]
) -> RosterContract:
    overridden_set = frozenset(overridden)
    chosen: _Chosen = [(channel, available[channel]) for channel in sorted(set(selected)) if channel in available]
    wording = _wording_of(chosen)
    return RosterContract(
        sections=_sections_asked(chosen),
        wording=wording,
        wording_cap=_wording_cap(chosen, overridden_set),
        overrides=_overrides_of(chosen, wording, overridden_set),
    )


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

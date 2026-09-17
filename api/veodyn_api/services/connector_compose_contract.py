from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal


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
class BoundCap:
    channel: str
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
    carries_translations: bool
    wording_caps: tuple[BoundCap, ...]
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
    return "structured" if any(declared.contract.wording == "structured" for _, declared in chosen) else "text"


def _carries_translations_of(chosen: _Chosen) -> bool:
    return any(declared.contract.carries_translations for _, declared in chosen)


def _honored_overridden(chosen: _Chosen, overridden: frozenset[str]) -> frozenset[str]:
    return frozenset(
        channel for channel, declared in chosen if channel in overridden and declared.contract.accepts_override
    )


def _wording_caps(chosen: _Chosen, honored: frozenset[str]) -> tuple[BoundCap, ...]:
    caps: list[BoundCap] = []
    for channel, declared in chosen:
        if declared.contract.wording != "text" or channel in honored:
            continue
        cap = _cap_of(declared)
        if cap is None:
            continue
        caps.append(BoundCap(channel=channel, limit=cap.limit, url_counts_as_characters=cap.url_counts_as_characters))
    return tuple(caps)


def _overrides_of(chosen: _Chosen, wording: Wording, honored: frozenset[str]) -> tuple[OverrideAsk, ...]:
    accepting = [(channel, declared) for channel, declared in chosen if declared.contract.accepts_override]
    folded = wording == "text" and len(chosen) == 1 and len(accepting) == 1 and chosen[0][0] not in honored
    if folded:
        return ()
    return tuple(OverrideAsk(channel=channel, cap=_cap_of(declared)) for channel, declared in accepting)


def merged_roster_contract(
    available: Mapping[str, Declared], selected: Iterable[str], overridden: Iterable[str]
) -> RosterContract:
    overridden_set = frozenset(overridden)
    chosen: _Chosen = [(channel, available[channel]) for channel in sorted(set(selected)) if channel in available]
    honored = _honored_overridden(chosen, overridden_set)
    wording = _wording_of(chosen)
    return RosterContract(
        sections=_sections_asked(chosen),
        wording=wording,
        carries_translations=_carries_translations_of(chosen),
        wording_caps=_wording_caps(chosen, honored),
        overrides=_overrides_of(chosen, wording, honored),
    )

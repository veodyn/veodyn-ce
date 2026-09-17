import pytest

from veodyn_api.services.connector_contract import (
    ComposeContract,
    ContentContract,
    Declared,
    merged_roster_contract,
)

FEED = "gtfs_rt_service_alerts:downtown"
X = "x_post"
FACEBOOK = "facebook_page"
INCUMBENT = "incumbent_notifier"
UNKNOWN = "some_unregistered_channel"

FEED_CONTRACT = ComposeContract(
    wording="structured",
    asks_classification=True,
    requires_classification=True,
    asks_entities=True,
    requires_entities=True,
    asks_active_period=True,
    requires_active_period=True,
    carries_translations=True,
)
X_CONTRACT = ComposeContract(accepts_override=True)
FACEBOOK_CONTRACT = ComposeContract(accepts_override=True)
INCUMBENT_CONTRACT = ComposeContract()

FEED_CONTENT = ContentContract()
X_CONTENT = ContentContract(max_length=280, url_counts_as_characters=23)
FACEBOOK_CONTENT = ContentContract(max_length=63206)
INCUMBENT_CONTENT = ContentContract()

AVAILABLE = {
    FEED: Declared(contract=FEED_CONTRACT, content_contract=FEED_CONTENT),
    X: Declared(contract=X_CONTRACT, content_contract=X_CONTENT),
    FACEBOOK: Declared(contract=FACEBOOK_CONTRACT, content_contract=FACEBOOK_CONTENT),
    INCUMBENT: Declared(contract=INCUMBENT_CONTRACT, content_contract=INCUMBENT_CONTENT),
}


def test_an_empty_roster_merges_to_nothing() -> None:
    roster = merged_roster_contract(AVAILABLE, [], [])
    assert roster.sections == ()
    assert roster.wording == "text"
    assert roster.wording_cap is None
    assert roster.overrides == ()


def test_unknown_channels_are_ignored() -> None:
    roster = merged_roster_contract(AVAILABLE, [UNKNOWN], [])
    assert roster.sections == ()
    assert roster.wording == "text"
    assert roster.wording_cap is None
    assert roster.overrides == ()


def test_a_section_is_present_when_asked_and_required_when_required() -> None:
    roster = merged_roster_contract(AVAILABLE, [FEED], [])
    sections = {section.section: section for section in roster.sections}
    assert sections["entities"].required is True
    assert sections["entities"].asked_by == (FEED,)
    assert sections["classification"].required is True
    assert sections["active_period"].required is True


def test_no_selected_destination_asking_leaves_the_section_absent() -> None:
    roster = merged_roster_contract(AVAILABLE, [X], [])
    assert roster.sections == ()


def test_asked_by_names_every_destination_that_asked_not_just_one() -> None:
    roster = merged_roster_contract(AVAILABLE, [FEED, X], [])
    sections = {section.section: section for section in roster.sections}
    assert sections["entities"].asked_by == (FEED,)


def test_wording_is_structured_when_a_destination_declares_it() -> None:
    roster = merged_roster_contract(AVAILABLE, [FEED], [])
    assert roster.wording == "structured"


def test_wording_is_structured_when_a_text_destination_carries_translations() -> None:
    translating = ComposeContract(carries_translations=True)
    available = dict(AVAILABLE)
    available["translator"] = Declared(contract=translating, content_contract=ContentContract())
    roster = merged_roster_contract(available, ["translator"], [])
    assert roster.wording == "structured"


def test_wording_stays_text_when_nothing_asks_for_structure() -> None:
    roster = merged_roster_contract(AVAILABLE, [X, INCUMBENT], [])
    assert roster.wording == "text"


def test_wording_cap_is_the_tightest_among_text_mode_destinations() -> None:
    roster = merged_roster_contract(AVAILABLE, [X, FACEBOOK], [])
    assert roster.wording == "text"
    assert roster.wording_cap is not None
    assert roster.wording_cap.limit == 280
    assert roster.wording_cap.url_counts_as_characters == 23


def test_wording_cap_excludes_an_overridden_destination() -> None:
    roster = merged_roster_contract(AVAILABLE, [X, FACEBOOK], [X])
    assert roster.wording_cap is not None
    assert roster.wording_cap.limit == 63206
    assert roster.wording_cap.url_counts_as_characters is None


def test_wording_cap_ignores_a_destination_with_no_cap() -> None:
    roster = merged_roster_contract(AVAILABLE, [X, INCUMBENT], [])
    assert roster.wording_cap is not None
    assert roster.wording_cap.limit == 280


def test_wording_cap_is_set_from_a_text_destination_even_in_a_structured_roster() -> None:
    roster = merged_roster_contract(AVAILABLE, [FEED, X], [])
    assert roster.wording == "structured"
    assert roster.wording_cap is not None
    assert roster.wording_cap.limit == 280


def test_wording_cap_in_a_structured_roster_is_none_once_the_sole_text_destination_is_overridden() -> None:
    roster = merged_roster_contract(AVAILABLE, [FEED, X], [X])
    assert roster.wording_cap is None


def test_overrides_lists_every_accepting_destination_when_more_than_one_is_chosen() -> None:
    roster = merged_roster_contract(AVAILABLE, [X, FACEBOOK], [])
    assert {override.channel for override in roster.overrides} == {X, FACEBOOK}


def test_overrides_excludes_a_destination_that_does_not_accept_one() -> None:
    roster = merged_roster_contract(AVAILABLE, [X, INCUMBENT], [])
    assert {override.channel for override in roster.overrides} == {X}


def test_overrides_lists_an_accepting_destination_regardless_of_whether_it_is_overridden() -> None:
    roster = merged_roster_contract(AVAILABLE, [X, FACEBOOK], [X])
    assert {override.channel for override in roster.overrides} == {X, FACEBOOK}


def test_the_sole_accepting_destination_in_a_text_roster_folds_into_the_shared_box() -> None:
    roster = merged_roster_contract(AVAILABLE, [X], [])
    assert roster.wording == "text"
    assert roster.overrides == ()
    assert roster.wording_cap is not None
    assert roster.wording_cap.limit == 280


def test_the_fold_is_suppressed_when_the_sole_destination_is_overridden() -> None:
    roster = merged_roster_contract(AVAILABLE, [X], [X])
    assert len(roster.overrides) == 1
    assert roster.overrides[0].channel == X
    assert roster.wording_cap is None


def test_a_sole_non_accepting_destination_does_not_fold_because_it_was_never_in_overrides() -> None:
    roster = merged_roster_contract(AVAILABLE, [INCUMBENT], [])
    assert roster.overrides == ()
    assert roster.wording_cap is None


@pytest.mark.parametrize(
    "kwargs",
    [
        {"requires_classification": True},
        {"requires_entities": True},
        {"requires_active_period": True},
    ],
)
def test_a_contract_cannot_require_a_section_it_does_not_ask_for(kwargs: dict[str, bool]) -> None:
    with pytest.raises(ValueError):
        ComposeContract(**kwargs)


def test_a_contract_may_ask_without_requiring() -> None:
    contract = ComposeContract(asks_entities=True, requires_entities=False)
    assert contract.asks_entities is True
    assert contract.requires_entities is False


def test_the_default_contract_asks_for_nothing() -> None:
    contract = ComposeContract()
    assert contract.wording == "text"
    assert contract.asks_classification is False
    assert contract.requires_classification is False
    assert contract.asks_entities is False
    assert contract.requires_entities is False
    assert contract.asks_active_period is False
    assert contract.requires_active_period is False
    assert contract.carries_translations is False
    assert contract.accepts_override is False


def test_the_shared_default_cannot_be_mutated_into_every_connector() -> None:
    with pytest.raises(AttributeError):
        ComposeContract().__dict__["accepts_override"] = True

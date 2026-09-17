from typing import Any

import pytest

from tests.connector_stubs import TOWN_CRIER_ID, TownCrierConnector
from veodyn_api.services.connector_contract import ComposeContract
from veodyn_api.services.connector_registry import (
    UnreadableComposeContract,
    connector_for,
    register_connector,
    restored_connectors,
)


def test_a_connector_that_declares_nothing_gets_the_default_contract() -> None:
    with restored_connectors():
        register_connector(TownCrierConnector())
        registered = connector_for(TOWN_CRIER_ID)
        assert registered is not None
        assert registered.compose_contract == ComposeContract()


def test_a_connector_that_declares_a_contract_keeps_it_through_registration() -> None:
    declared = ComposeContract(asks_entities=True, accepts_override=True)

    class Declaring(TownCrierConnector):
        @property
        def compose_contract(self) -> ComposeContract:
            return declared

    with restored_connectors():
        register_connector(Declaring())
        registered = connector_for(TOWN_CRIER_ID)
        assert registered is not None
        assert registered.compose_contract == declared


def test_a_connector_declaring_none_still_registers_with_the_default() -> None:
    class Silent(TownCrierConnector):
        @property
        def compose_contract(self) -> Any:
            return None

    with restored_connectors():
        register_connector(Silent())
        registered = connector_for(TOWN_CRIER_ID)
        assert registered is not None
        assert registered.compose_contract == ComposeContract()


def test_a_declaration_that_raises_is_refused_rather_than_read_as_absent() -> None:
    class Broken(TownCrierConnector):
        @property
        def compose_contract(self) -> Any:
            raise AttributeError("the settings this reads are not loaded yet")

    with restored_connectors():
        with pytest.raises(UnreadableComposeContract) as refusal:
            register_connector(Broken())
    assert "AttributeError" in str(refusal.value)


def test_a_declaration_whose_fields_raise_is_refused_at_registration() -> None:
    class Evasive(ComposeContract):
        def __getattribute__(self, name: str) -> Any:
            if name == "asks_entities":
                raise RuntimeError("not while you are looking")
            return super().__getattribute__(name)

    class Declaring(TownCrierConnector):
        @property
        def compose_contract(self) -> Any:
            return Evasive()

    with restored_connectors():
        with pytest.raises(UnreadableComposeContract) as refusal:
            register_connector(Declaring())
    assert "RuntimeError" in str(refusal.value)


def test_what_a_connector_declares_cannot_be_changed_after_it_registers() -> None:
    declared = ComposeContract(asks_entities=True)

    class Declaring(TownCrierConnector):
        @property
        def compose_contract(self) -> ComposeContract:
            return declared

    with restored_connectors():
        register_connector(Declaring())
        registered = connector_for(TOWN_CRIER_ID)
        assert registered is not None
        assert registered.compose_contract is not declared
        assert registered.compose_contract == declared


def test_the_shared_default_cannot_be_mutated_into_every_connector() -> None:
    with pytest.raises(AttributeError):
        ComposeContract().__dict__["asks_entities"] = True


def test_a_contract_of_the_wrong_type_is_refused_at_registration() -> None:
    class Duckish(TownCrierConnector):
        @property
        def compose_contract(self) -> Any:
            return {"asks_entities": True}

    with restored_connectors():
        with pytest.raises(UnreadableComposeContract) as refusal:
            register_connector(Duckish())
    assert TOWN_CRIER_ID in str(refusal.value)


def test_a_declared_contract_that_requires_a_section_it_does_not_ask_for_never_reaches_registration() -> None:
    with pytest.raises(ValueError):
        ComposeContract(requires_entities=True)

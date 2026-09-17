from typing import Any

import pytest

from tests.connector_stubs import TOWN_CRIER_ID, TownCrierConnector
from veodyn_api.services.connector_contract import ComposeRequirements
from veodyn_api.services.connector_registry import (
    UnreadableComposeRequirements,
    connector_for,
    register_connector,
    restored_connectors,
)


def test_a_connector_that_declares_nothing_gets_the_empty_requirements() -> None:
    with restored_connectors():
        register_connector(TownCrierConnector())
        registered = connector_for(TOWN_CRIER_ID)
        assert registered is not None
        assert registered.compose_requirements == ComposeRequirements()


def test_a_connector_that_declares_requirements_keeps_them_through_registration() -> None:
    declared = ComposeRequirements(needs_entities=True, accepts_override=True)

    class Declaring(TownCrierConnector):
        @property
        def compose_requirements(self) -> ComposeRequirements:
            return declared

    with restored_connectors():
        register_connector(Declaring())
        registered = connector_for(TOWN_CRIER_ID)
        assert registered is not None
        assert registered.compose_requirements == declared


def test_a_connector_declaring_none_still_registers_with_the_default() -> None:
    class Silent(TownCrierConnector):
        @property
        def compose_requirements(self) -> Any:
            return None

    with restored_connectors():
        register_connector(Silent())
        registered = connector_for(TOWN_CRIER_ID)
        assert registered is not None
        assert registered.compose_requirements == ComposeRequirements()


def test_a_declaration_that_raises_is_refused_rather_than_read_as_absent() -> None:
    class Broken(TownCrierConnector):
        @property
        def compose_requirements(self) -> Any:
            raise AttributeError("the settings this reads are not loaded yet")

    with restored_connectors():
        with pytest.raises(UnreadableComposeRequirements) as refusal:
            register_connector(Broken())
    assert "AttributeError" in str(refusal.value)


def test_a_declaration_whose_fields_raise_is_refused_at_registration() -> None:
    class Evasive(ComposeRequirements):
        def __getattribute__(self, name: str) -> Any:
            if name == "needs_entities":
                raise RuntimeError("not while you are looking")
            return super().__getattribute__(name)

    class Declaring(TownCrierConnector):
        @property
        def compose_requirements(self) -> Any:
            return Evasive()

    with restored_connectors():
        with pytest.raises(UnreadableComposeRequirements) as refusal:
            register_connector(Declaring())
    assert "RuntimeError" in str(refusal.value)


def test_what_a_connector_declares_cannot_be_changed_after_it_registers() -> None:
    declared = ComposeRequirements(needs_entities=True)

    class Declaring(TownCrierConnector):
        @property
        def compose_requirements(self) -> ComposeRequirements:
            return declared

    with restored_connectors():
        register_connector(Declaring())
        registered = connector_for(TOWN_CRIER_ID)
        assert registered is not None
        assert registered.compose_requirements is not declared
        assert registered.compose_requirements == declared


def test_the_shared_default_cannot_be_mutated_into_every_connector() -> None:
    with pytest.raises(AttributeError):
        ComposeRequirements().__dict__["needs_entities"] = True


def test_a_requirements_object_of_the_wrong_type_is_refused_at_registration() -> None:
    class Duckish(TownCrierConnector):
        @property
        def compose_requirements(self) -> Any:
            return {"needs_entities": True}

    with restored_connectors():
        with pytest.raises(UnreadableComposeRequirements) as refusal:
            register_connector(Duckish())
    assert TOWN_CRIER_ID in str(refusal.value)

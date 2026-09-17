import dataclasses

import pytest

from tests.connector_stubs import (
    GOOD_TOKEN,
    TOWN_CRIER_ID,
    TOWN_CRIER_SCHEMA,
    LeakingConnector,
    TownCrierConnector,
    good_credentials,
)
from veodyn_api.services.connector_contract import ContentContract, CredentialField, CredentialSchema
from veodyn_api.services.connector_registry import (
    AlreadyRegistered,
    UnaddressableConnectorId,
    UnrenderableCredentialSchema,
    UnsatisfiableContentContract,
    anything_is_registered,
    connector_for,
    register_connector,
    registered_connectors,
    restored_connectors,
)


def schema_of(*fields: CredentialField) -> CredentialSchema:
    return CredentialSchema(fields=fields)


def test_a_community_build_ships_no_connector() -> None:
    assert anything_is_registered() is False


def test_a_connector_invented_in_a_test_is_found_by_the_registry() -> None:
    with restored_connectors():
        register_connector(TownCrierConnector())
        found = connector_for(TOWN_CRIER_ID)
        assert found is not None
        assert found.display_name == "Town Crier"
        assert [c.connector_id for c in registered_connectors()] == [TOWN_CRIER_ID]


def test_a_second_connector_under_one_id_is_refused_not_overwritten() -> None:
    with restored_connectors():
        first = TownCrierConnector(display_name="Town Crier")
        register_connector(first)
        with pytest.raises(AlreadyRegistered) as refusal:
            register_connector(TownCrierConnector(display_name="Impostor Crier"))
        assert TOWN_CRIER_ID in str(refusal.value)
        registered = connector_for(TOWN_CRIER_ID)
        assert registered is not None
        assert registered.channel is first


def test_a_duplicate_refusal_names_the_registered_connector_without_printing_it() -> None:
    with restored_connectors():
        first = TownCrierConnector()
        register_connector(first)
        first.verify_credentials(good_credentials())

        with pytest.raises(AlreadyRegistered) as refusal:
            register_connector(TownCrierConnector())

        assert GOOD_TOKEN not in str(refusal.value)
        assert "Town Crier" in str(refusal.value)
        assert TOWN_CRIER_ID in str(refusal.value)


def test_a_connector_with_no_credential_fields_is_refused() -> None:
    with restored_connectors():
        with pytest.raises(UnrenderableCredentialSchema):
            register_connector(TownCrierConnector(credential_schema=CredentialSchema(fields=())))


def test_a_credential_field_declared_twice_is_refused() -> None:
    twice = schema_of(
        CredentialField(name="crier_token", title="Token"),
        CredentialField(name="crier_token", title="Token again"),
    )
    with restored_connectors():
        with pytest.raises(UnrenderableCredentialSchema) as refusal:
            register_connector(TownCrierConnector(credential_schema=twice))
        assert "crier_token" in str(refusal.value)


def test_a_credential_type_the_form_cannot_render_is_refused() -> None:
    exotic = schema_of(CredentialField(name="pem", title="Key file", type="file"))
    with restored_connectors():
        with pytest.raises(UnrenderableCredentialSchema) as refusal:
            register_connector(TownCrierConnector(credential_schema=exotic))
        assert "file" in str(refusal.value)


@pytest.mark.parametrize("connector_id", ["", "types", "town/crier", "Town-Crier", "-town", "town crier", "town?"])
def test_an_id_the_admin_could_not_address_is_refused(connector_id: str) -> None:
    with restored_connectors():
        with pytest.raises(UnaddressableConnectorId):
            register_connector(TownCrierConnector(connector_id=connector_id))


def test_the_id_the_type_picker_answers_on_cannot_be_taken_by_a_connector() -> None:
    with restored_connectors():
        with pytest.raises(UnaddressableConnectorId) as refusal:
            register_connector(TownCrierConnector(connector_id="types"))
        assert "/connectors/types" in str(refusal.value)


def test_a_connector_with_no_display_name_is_refused() -> None:
    with restored_connectors():
        with pytest.raises(UnrenderableCredentialSchema):
            register_connector(TownCrierConnector(display_name="   "))


@pytest.mark.parametrize("name", ["__proto__", "constructor", "prototype"])
def test_a_credential_named_after_a_javascript_objects_own_machinery_is_refused(name: str) -> None:
    polluting = schema_of(
        CredentialField(name=name, title="Token"),
        CredentialField(name="crier_room", title="Room", secret=False),
    )
    with restored_connectors():
        with pytest.raises(UnrenderableCredentialSchema) as refusal:
            register_connector(TownCrierConnector(credential_schema=polluting))
        assert name in str(refusal.value)


@pytest.mark.parametrize("name", ["", "crier token", "crier-token", "2fa"])
def test_a_credential_name_that_is_not_a_plain_identifier_is_refused(name: str) -> None:
    with restored_connectors():
        with pytest.raises(UnrenderableCredentialSchema):
            register_connector(TownCrierConnector(credential_schema=schema_of(CredentialField(name=name, title="T"))))


def test_a_credential_field_with_no_title_is_refused() -> None:
    with restored_connectors():
        with pytest.raises(UnrenderableCredentialSchema) as refusal:
            register_connector(
                TownCrierConnector(credential_schema=schema_of(CredentialField(name="crier_token", title=" ")))
            )
        assert "crier_token" in str(refusal.value)


@pytest.mark.parametrize("declared", ["boolean", "number"])
def test_a_secret_that_is_not_a_string_is_refused_rather_than_rendered_as_a_password_box(declared: str) -> None:
    masked = schema_of(
        CredentialField(name="crier_token", title="Token"),
        CredentialField(name="crier_loud", title="Loud", type=declared),
    )
    with restored_connectors():
        with pytest.raises(UnrenderableCredentialSchema) as refusal:
            register_connector(TownCrierConnector(credential_schema=masked))
        assert "crier_loud" in str(refusal.value)


def test_a_non_secret_boolean_or_number_credential_is_accepted() -> None:
    plain = schema_of(
        CredentialField(name="crier_token", title="Token"),
        CredentialField(name="crier_loud", title="Loud", type="boolean", secret=False),
        CredentialField(name="crier_repeats", title="Repeats", type="number", secret=False, required=False),
    )
    with restored_connectors():
        register_connector(TownCrierConnector(credential_schema=plain))
        assert connector_for(TOWN_CRIER_ID) is not None


def test_a_schema_where_every_field_is_optional_is_refused() -> None:
    optional = schema_of(
        CredentialField(name="crier_token", title="Token", required=False),
        CredentialField(name="crier_room", title="Room", secret=False, required=False),
    )
    with restored_connectors():
        with pytest.raises(UnrenderableCredentialSchema) as refusal:
            register_connector(TownCrierConnector(credential_schema=optional))
        assert "authenticates as nobody" in str(refusal.value)


@pytest.mark.parametrize(
    "contract",
    [
        ContentContract(max_length=0),
        ContentContract(max_length=20, required_footer="a footer far longer than twenty characters"),
        ContentContract(max_length=20, url_counts_as_characters=23),
    ],
)
def test_a_content_contract_no_rendering_could_satisfy_is_refused(contract: ContentContract) -> None:
    with restored_connectors():
        with pytest.raises(UnsatisfiableContentContract):
            register_connector(TownCrierConnector(content_contract=contract))


def test_the_registry_is_restored_when_a_test_block_ends() -> None:
    with restored_connectors():
        register_connector(TownCrierConnector())
    assert connector_for(TOWN_CRIER_ID) is None
    assert anything_is_registered() is False


def test_a_connector_declares_whether_its_channel_can_be_recalled() -> None:
    with restored_connectors():
        register_connector(dataclasses.replace(TownCrierConnector(), recallable=False))
        found = connector_for(TOWN_CRIER_ID)
        assert found is not None
        assert found.recallable is False


def test_the_registry_keeps_the_identity_it_read_at_registration() -> None:
    shifting = LeakingConnector()
    with restored_connectors():
        register_connector(shifting)
        shifting.verify_credentials({"crier_token": GOOD_TOKEN})
        registered = connector_for(TOWN_CRIER_ID)
        assert registered is not None
        assert registered.display_name == "Town Crier"
        assert GOOD_TOKEN not in registered.display_name
        assert registered.credential_schema is TOWN_CRIER_SCHEMA

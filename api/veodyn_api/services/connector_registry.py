import re
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from veodyn_api.services.connector_contract import (
    MASKABLE_CREDENTIAL_TYPES,
    NO_COMPOSE_REQUIREMENTS,
    RENDERABLE_CREDENTIAL_TYPES,
    ComposeRequirements,
    Connector,
    ContentContract,
    CredentialField,
    CredentialSchema,
    CredentialVerdict,
    DeliveryOutcome,
    Rendering,
)

RESERVED_CONNECTOR_IDS = frozenset({"types"})
PROTOTYPE_POLLUTING_NAMES = frozenset({"__proto__", "constructor", "prototype"})

CONNECTOR_ID = re.compile(r"\A[a-z0-9][a-z0-9._-]*\Z")
CREDENTIAL_NAME = re.compile(r"\A[A-Za-z_][A-Za-z0-9_]*\Z")


@dataclass(frozen=True)
class RegisteredConnector:
    connector_id: str
    display_name: str
    credential_schema: CredentialSchema
    content_contract: ContentContract
    recallable: bool
    compose_requirements: ComposeRequirements
    channel: Connector

    def verify_credentials(self, credentials: Mapping[str, Any]) -> CredentialVerdict:
        return self.channel.verify_credentials(credentials)

    def deliver(self, rendering: Rendering, credentials: Mapping[str, Any], idempotency_key: str) -> DeliveryOutcome:
        return self.channel.deliver(rendering, credentials, idempotency_key)


class AlreadyRegistered(Exception):
    pass


class UnaddressableConnectorId(Exception):
    pass


class UnrenderableCredentialSchema(Exception):
    pass


class UnsatisfiableContentContract(Exception):
    pass


class UnreadableComposeRequirements(Exception):
    pass


_CONNECTORS: dict[str, RegisteredConnector] = {}


def _refuse_an_id_no_admin_url_can_carry(connector_id: str) -> None:
    if not connector_id:
        raise UnaddressableConnectorId(
            "a connector declares no id, so /connectors/ addresses the collection rather than this "
            "configuration and Admin has no row to link to."
        )
    if CONNECTOR_ID.match(connector_id) is None:
        raise UnaddressableConnectorId(
            f"{connector_id!r} is not a usable connector id: an id is one lowercase URL segment matching "
            f"{CONNECTOR_ID.pattern}, and anything else lands the Admin link on another route or on no route."
        )
    if connector_id in RESERVED_CONNECTOR_IDS:
        raise UnaddressableConnectorId(
            f"{connector_id!r} is reserved: /connectors/{connector_id} already answers with the type picker, "
            "so a configuration under that id could never be read back."
        )


def _refuse_a_name_the_admin_cannot_show(connector_id: str, display_name: str) -> None:
    if not display_name.strip():
        raise UnrenderableCredentialSchema(
            f"{connector_id} declares no display name, so the type picker would offer a nameless button and the "
            "connector list a blank channel."
        )


def _refuse_a_field_no_form_can_render(connector_id: str, field: CredentialField) -> None:
    if not field.name:
        raise UnrenderableCredentialSchema(
            f"{connector_id} declares a credential field with no name, which has no key to store a value under."
        )
    if field.name in PROTOTYPE_POLLUTING_NAMES:
        raise UnrenderableCredentialSchema(
            f"{connector_id} declares the credential field {field.name!r}, which names a JavaScript object's own "
            "machinery rather than a key: the Admin form would mutate that machinery instead of collecting a value."
        )
    if CREDENTIAL_NAME.match(field.name) is None:
        raise UnrenderableCredentialSchema(
            f"{connector_id} declares the credential field {field.name!r}, which is not a plain identifier "
            f"matching {CREDENTIAL_NAME.pattern}."
        )
    if not field.title.strip():
        raise UnrenderableCredentialSchema(
            f"{connector_id} declares {field.name!r} with no title, so the Admin form would label its input with "
            "nothing at all."
        )
    if field.type not in RENDERABLE_CREDENTIAL_TYPES:
        raise UnrenderableCredentialSchema(
            f"{connector_id} declares {field.name!r} as {field.type!r}, which the Admin form has no control "
            f"for; it renders {sorted(RENDERABLE_CREDENTIAL_TYPES)}."
        )
    if field.secret and field.type not in MASKABLE_CREDENTIAL_TYPES:
        raise UnrenderableCredentialSchema(
            f"{connector_id} declares {field.name!r} as a secret {field.type!r}. A masked input is a text box, so "
            f"the form would render one in place of the {field.type} control and store the characters typed into "
            "it. Declare secret=False on it, or declare it as a string."
        )


def _refuse_a_schema_no_form_can_render(connector_id: str, schema: CredentialSchema) -> None:
    if not schema.fields:
        raise UnrenderableCredentialSchema(
            f"{connector_id} declares no credential fields, so Admin would render an empty form and save a "
            "configuration that authenticates as nobody. A connector the agency does not credential does not "
            "belong on this contract."
        )
    seen: set[str] = set()
    for field in schema.fields:
        if field.name in seen:
            raise UnrenderableCredentialSchema(
                f"{connector_id} declares the credential field {field.name!r} twice, and one input would "
                "overwrite the other with no sign which value was stored."
            )
        seen.add(field.name)
        _refuse_a_field_no_form_can_render(connector_id, field)
    if not schema.required_names:
        raise UnrenderableCredentialSchema(
            f"{connector_id} declares no required credential field, so Admin would save a configuration with "
            "every field left blank, which authenticates as nobody for the same reason an empty schema does."
        )


def _refuse_a_contract_no_rendering_can_satisfy(connector_id: str, contract: ContentContract) -> None:
    if contract.max_length is None:
        return
    if contract.max_length <= 0:
        raise UnsatisfiableContentContract(
            f"{connector_id} declares maxLength {contract.max_length}, which no rendering can satisfy."
        )
    footer = contract.required_footer
    if footer is not None and len(footer) > contract.max_length:
        raise UnsatisfiableContentContract(
            f"{connector_id} requires a {len(footer)}-character footer on a body capped at {contract.max_length}, "
            "so every rendering it accepts is one it also refuses."
        )
    counted = contract.url_counts_as_characters
    if counted is not None and counted > contract.max_length:
        raise UnsatisfiableContentContract(
            f"{connector_id} counts every URL at {counted} characters against a cap of {contract.max_length}, "
            "so a rendering carrying one link can never fit."
        )


def compose_requirements_of(connector: Connector, connector_id: str) -> ComposeRequirements:
    declared = getattr(connector, "compose_requirements", None)
    if declared is None:
        return NO_COMPOSE_REQUIREMENTS
    if not isinstance(declared, ComposeRequirements):
        raise UnreadableComposeRequirements(
            f"{connector_id} declares compose requirements as {type(declared).__name__}, and the compose form "
            "would be built from the defaults instead with nothing to say the declaration was dropped. Declare a "
            "ComposeRequirements."
        )
    return declared


def register_connector(connector: Connector) -> None:
    connector_id = str(connector.connector_id)
    _refuse_an_id_no_admin_url_can_carry(connector_id)
    registered = _CONNECTORS.get(connector_id)
    if registered is not None:
        raise AlreadyRegistered(
            f"{connector_id!r} is already served by {registered.display_name!r}, and a second connector "
            "declaring that id would replace it. Two connectors under one id are two sets of agency credentials "
            "and two content contracts, which the outbox would record as one channel."
        )
    display_name = str(connector.display_name)
    _refuse_a_name_the_admin_cannot_show(connector_id, display_name)
    schema = connector.credential_schema
    contract = connector.content_contract
    _refuse_a_schema_no_form_can_render(connector_id, schema)
    _refuse_a_contract_no_rendering_can_satisfy(connector_id, contract)
    _CONNECTORS[connector_id] = RegisteredConnector(
        connector_id=connector_id,
        display_name=display_name,
        credential_schema=schema,
        content_contract=contract,
        recallable=bool(connector.recallable),
        compose_requirements=compose_requirements_of(connector, connector_id),
        channel=connector,
    )


def connector_for(connector_id: str) -> RegisteredConnector | None:
    return _CONNECTORS.get(connector_id)


def registered_connectors() -> list[RegisteredConnector]:
    return [_CONNECTORS[connector_id] for connector_id in sorted(_CONNECTORS)]


@contextmanager
def restored_connectors() -> Iterator[None]:
    saved = dict(_CONNECTORS)
    try:
        yield
    finally:
        _CONNECTORS.clear()
        _CONNECTORS.update(saved)

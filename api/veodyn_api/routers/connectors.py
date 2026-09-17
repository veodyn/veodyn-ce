from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from veodyn_api.auth import Identity, require_identity
from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.connector_configuration import ConnectorConfiguration
from veodyn_api.schemas.connector import (
    ConnectorHealthOut,
    ConnectorIn,
    ConnectorOut,
    ConnectorTypeOut,
    ConnectorUpdateIn,
    ContentContractOut,
    CredentialPropertyOut,
    CredentialSchemaOut,
)
from veodyn_api.services import connector_configs
from veodyn_api.services.connector_registry import RegisteredConnector, connector_for, registered_connectors

router = APIRouter(prefix="/connectors", tags=["connectors"])

IdentityDep = Annotated[Identity, Depends(require_identity)]
DbDep = Annotated[Session, Depends(get_db)]


def require_admin(identity: Identity) -> None:
    if not identity.is_admin:
        raise ApiError(
            ErrorId.FORBIDDEN,
            "attaching the agency's identity to an outbound channel requires an administrator",
            status_code=403,
        )


def _credential_schema_out(connector: RegisteredConnector) -> CredentialSchemaOut:
    schema = connector.credential_schema
    return CredentialSchemaOut(
        properties={
            field.name: CredentialPropertyOut(type=field.type, title=field.title, description=field.description)
            for field in schema.fields
        },
        required=list(schema.required_names),
        clearable=list(schema.optional_names),
        secret=[field.name for field in schema.fields if field.secret],
        order=list(schema.names),
    )


def _type_out(connector: RegisteredConnector) -> ConnectorTypeOut:
    contract = connector.content_contract
    return ConnectorTypeOut(
        connector_id=connector.connector_id,
        display_name=connector.display_name,
        recallable=connector.recallable,
        credential_schema=_credential_schema_out(connector),
        content_contract=ContentContractOut(
            max_length=contract.max_length,
            supports_markup=contract.supports_markup,
            url_counts_as_characters=contract.url_counts_as_characters,
            required_footer=contract.required_footer,
        ),
    )


def _out(row: ConnectorConfiguration, connector: RegisteredConnector | None) -> ConnectorOut:
    return ConnectorOut(
        connector_id=row.connector_id,
        display_name=connector.display_name if connector is not None else row.connector_id,
        name=row.name,
        recallable=connector.recallable if connector is not None else False,
        configured_fields=sorted(row.credentials),
        health=ConnectorHealthOut(
            delivery=row.delivery_health,
            credentials_verified_at=row.credentials_verified_at,
            last_delivery_at=row.last_delivery_at,
            last_delivery_detail=row.last_delivery_detail,
        ),
    )


def _registered(connector_id: str) -> RegisteredConnector:
    connector = connector_for(connector_id)
    if connector is None:
        raise ApiError(
            ErrorId.CONNECTOR_NOT_REGISTERED,
            f"no connector {connector_id!r} is installed in this deployment",
            status_code=404,
        )
    return connector


def _refused(error: connector_configs.CredentialsRefused) -> ApiError:
    return ApiError(ErrorId.CONNECTOR_CREDENTIALS_REFUSED, error.reason, status_code=422)


def _already_configured(connector_id: str) -> ApiError:
    return ApiError(
        ErrorId.CONNECTOR_ALREADY_CONFIGURED,
        f"{connector_id!r} already holds this organization's credentials; edit that configuration "
        "instead of adding a second one",
        status_code=409,
    )


@router.get("/types", response_model=list[ConnectorTypeOut])
def list_connector_types(identity: IdentityDep) -> list[ConnectorTypeOut]:
    require_admin(identity)
    return [_type_out(connector) for connector in registered_connectors()]


@router.get("", response_model=list[ConnectorOut])
def list_connectors(identity: IdentityDep, db: DbDep) -> list[ConnectorOut]:
    require_admin(identity)
    return [
        _out(row, connector_for(row.connector_id))
        for row in connector_configs.configurations_of(db, identity.org_slug)
    ]


@router.post("", response_model=ConnectorOut, status_code=201)
def configure_connector(identity: IdentityDep, db: DbDep, body: ConnectorIn) -> ConnectorOut:
    require_admin(identity)
    connector = _registered(body.connector_id)
    if connector_configs.configuration_for(db, identity.org_slug, body.connector_id) is not None:
        raise _already_configured(body.connector_id)
    try:
        row = connector_configs.create(db, identity.org_slug, connector, body.name, body.credentials)
    except connector_configs.CredentialsRefused as refusal:
        raise _refused(refusal) from None
    except connector_configs.AlreadyConfigured:
        raise _already_configured(body.connector_id) from None
    return _out(row, connector)


@router.get("/{connector_id}", response_model=ConnectorOut)
def read_connector(identity: IdentityDep, db: DbDep, connector_id: str) -> ConnectorOut:
    require_admin(identity)
    row = connector_configs.configuration_for(db, identity.org_slug, connector_id)
    if row is None:
        raise ApiError(
            ErrorId.CONNECTOR_NOT_CONFIGURED,
            f"{connector_id!r} holds no credentials for this organization",
            status_code=404,
        )
    return _out(row, connector_for(connector_id))


@router.put("/{connector_id}", response_model=ConnectorOut)
def reconfigure_connector(
    identity: IdentityDep, db: DbDep, connector_id: str, body: ConnectorUpdateIn
) -> ConnectorOut:
    require_admin(identity)
    connector = _registered(connector_id)
    existing = connector_configs.configuration_for(db, identity.org_slug, connector_id)
    if existing is None:
        raise ApiError(
            ErrorId.CONNECTOR_NOT_CONFIGURED,
            f"{connector_id!r} holds no credentials for this organization",
            status_code=404,
        )
    try:
        row = connector_configs.update(db, connector, existing, body.name, body.replace, body.clear)
    except connector_configs.CredentialsRefused as refusal:
        raise _refused(refusal) from None
    return _out(row, connector)


@router.delete("/{connector_id}", status_code=204)
def forget_connector(identity: IdentityDep, db: DbDep, connector_id: str) -> Response:
    require_admin(identity)
    row = connector_configs.configuration_for(db, identity.org_slug, connector_id)
    if row is None:
        raise ApiError(
            ErrorId.CONNECTOR_NOT_CONFIGURED,
            f"{connector_id!r} holds no credentials for this organization",
            status_code=404,
        )
    db.delete(row)
    db.commit()
    return Response(status_code=204)

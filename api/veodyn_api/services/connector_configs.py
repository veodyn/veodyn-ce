from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from veodyn_api.models.connector_configuration import ConnectorConfiguration
from veodyn_api.services.connector_contract import DeliveryOutcome
from veodyn_api.services.connector_registry import RegisteredConnector
from veodyn_api.services.connector_reports import (
    delivery_sentence,
    refusal_sentence,
    unreachable_sentence,
    verdict_of,
)


class CredentialsRefused(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class AlreadyConfigured(Exception):
    pass


def _quoted(names: Iterable[str]) -> str:
    return ", ".join(repr(name) for name in names)


def merged_credentials(
    connector: RegisteredConnector,
    replace: Mapping[str, Any],
    clear: Iterable[str],
    stored: Mapping[str, Any] | None,
) -> dict[str, Any]:
    schema = connector.credential_schema
    declared = set(schema.names)
    cleared = set(clear)
    unknown = sorted((set(replace) | cleared) - declared)
    if unknown:
        raise CredentialsRefused(
            f"{connector.connector_id} declares no credential field named {_quoted(unknown)}; a value it cannot "
            "use would be stored and never sent."
        )
    contradicted = sorted(set(replace) & cleared)
    if contradicted:
        raise CredentialsRefused(
            f"this request both replaces and clears {_quoted(contradicted)}, and one operation would silently "
            "win over the other."
        )
    required = set(schema.required_names)
    cleared_required = sorted(cleared & required)
    if cleared_required:
        raise CredentialsRefused(
            f"{connector.connector_id} requires {_quoted(cleared_required)}, so clearing it would leave a "
            "configuration that cannot authenticate. Replace the value, or remove the whole configuration."
        )
    blanked = sorted(name for name, value in replace.items() if isinstance(value, str) and not value.strip())
    if blanked:
        raise CredentialsRefused(
            f"{_quoted(blanked)} was sent as an empty value. Leave a field out of the request to keep what is "
            "stored, or name it in `clear` to remove it; a blank is neither."
        )
    merged = {name: value for name, value in (stored or {}).items() if name in declared and name not in cleared}
    merged.update(replace)
    missing = [name for name in schema.required_names if name not in merged]
    if missing:
        raise CredentialsRefused(
            f"{connector.connector_id} requires {_quoted(missing)}, and this configuration supplies no value and "
            "has none stored."
        )
    return merged


def verified_credentials(connector: RegisteredConnector, credentials: Mapping[str, Any]) -> None:
    try:
        reported = connector.verify_credentials(credentials)
    except Exception:
        reported = None
    verdict = verdict_of(connector.credential_schema, reported)
    if verdict is None:
        raise CredentialsRefused(unreachable_sentence(connector))
    if not verdict.accepted:
        raise CredentialsRefused(refusal_sentence(connector, verdict))


def configuration_for(db: Session, org_slug: str, connector_id: str) -> ConnectorConfiguration | None:
    return db.get(ConnectorConfiguration, (org_slug, connector_id))


def configurations_of(db: Session, org_slug: str) -> list[ConnectorConfiguration]:
    return list(
        db.execute(
            select(ConnectorConfiguration)
            .where(ConnectorConfiguration.org_slug == org_slug)
            .order_by(ConnectorConfiguration.connector_id)
        ).scalars()
    )


def create(
    db: Session,
    org_slug: str,
    connector: RegisteredConnector,
    name: str,
    replace: Mapping[str, Any],
) -> ConnectorConfiguration:
    credentials = merged_credentials(connector, replace, (), None)
    verified_credentials(connector, credentials)
    row = db.scalars(
        pg_insert(ConnectorConfiguration)
        .values(
            org_slug=org_slug,
            connector_id=connector.connector_id,
            name=name,
            credentials=credentials,
            credentials_verified_at=datetime.now(UTC),
        )
        .on_conflict_do_nothing(index_elements=["org_slug", "connector_id"])
        .returning(ConnectorConfiguration),
        execution_options={"populate_existing": True},
    ).one_or_none()
    if row is None:
        db.rollback()
        raise AlreadyConfigured(connector.connector_id)
    db.commit()
    return row


def update(
    db: Session,
    connector: RegisteredConnector,
    existing: ConnectorConfiguration,
    name: str,
    replace: Mapping[str, Any],
    clear: Iterable[str],
) -> ConnectorConfiguration:
    credentials = merged_credentials(connector, replace, clear, existing.credentials)
    verified_credentials(connector, credentials)
    existing.name = name
    existing.credentials = credentials
    existing.credentials_verified_at = datetime.now(UTC)
    db.commit()
    db.refresh(existing)
    return existing


def record_delivery(
    db: Session, connector: RegisteredConnector, row: ConnectorConfiguration, outcome: DeliveryOutcome
) -> None:
    row.last_delivery_at = datetime.now(UTC)
    row.last_delivery_delivered = outcome.delivered
    row.last_delivery_detail = delivery_sentence(connector, outcome)
    db.commit()
    db.refresh(row)

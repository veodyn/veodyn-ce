import json
import logging
from collections.abc import Iterator

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tests.connector_stubs import (
    ADMIN,
    GOOD_TOKEN,
    ROOM,
    TOWN_CRIER_ID,
    TownCrierConnector,
    as_user,
    auth,
    good_credentials,
)
from veodyn_api.models.connector_configuration import ConnectorConfiguration
from veodyn_api.schemas.connector import ConnectorIn, ConnectorUpdateIn
from veodyn_api.services.connector_configs import (
    AlreadyConfigured,
    CredentialsRefused,
    create,
    merged_credentials,
    verified_credentials,
)
from veodyn_api.services.connector_registry import connector_for, register_connector, restored_connectors


@pytest.fixture
def crier() -> Iterator[TownCrierConnector]:
    with restored_connectors():
        connector = TownCrierConnector()
        register_connector(connector)
        yield connector


def configure(api: TestClient) -> None:
    api.post(
        "/connectors",
        json={"connectorId": TOWN_CRIER_ID, "name": "Agency crier", "credentials": good_credentials()},
        headers=auth(),
    )


@respx.mock
def test_no_response_on_this_surface_carries_a_stored_credential(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)

    created = api.post(
        "/connectors",
        json={"connectorId": TOWN_CRIER_ID, "name": "Agency crier", "credentials": good_credentials()},
        headers=auth(),
    )
    listed = api.get("/connectors", headers=auth())
    read = api.get(f"/connectors/{TOWN_CRIER_ID}", headers=auth())
    types = api.get("/connectors/types", headers=auth())

    for response in (created, listed, read, types):
        assert GOOD_TOKEN not in response.text
    assert ROOM not in read.text
    assert json.loads(read.text)["configuredFields"] == ["crier_room", "crier_token"]


@respx.mock
def test_a_refusal_names_the_field_and_never_quotes_the_value(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)

    refused = api.post(
        "/connectors",
        json={
            "connectorId": TOWN_CRIER_ID,
            "name": "Agency crier",
            "credentials": {"crier_token": "wrong-but-secret-9c1", "crier_room": ROOM},
        },
        headers=auth(),
    )

    assert refused.status_code == 422
    assert "Crier API token" in refused.text
    assert "wrong-but-secret-9c1" not in refused.text


@respx.mock
def test_a_connector_that_raises_holding_the_credential_does_not_publish_it(
    api: TestClient, crier: TownCrierConnector
) -> None:
    as_user(ADMIN)
    crier.raises_on_verify = True

    refused = api.post(
        "/connectors",
        json={"connectorId": TOWN_CRIER_ID, "name": "Agency crier", "credentials": good_credentials()},
        headers=auth(),
    )

    assert refused.status_code == 422
    assert GOOD_TOKEN not in refused.text


def test_the_refusal_raised_from_a_connector_carries_no_chained_message(crier: TownCrierConnector) -> None:
    crier.raises_on_verify = True
    registered = connector_for(TOWN_CRIER_ID)
    assert registered is not None

    with pytest.raises(CredentialsRefused) as refusal:
        verified_credentials(registered, merged_credentials(registered, good_credentials(), (), None))

    assert GOOD_TOKEN not in str(refusal.value)
    assert refusal.value.__cause__ is None
    assert refusal.value.__context__ is None


@respx.mock
def test_nothing_written_to_the_log_while_a_credential_is_saved_carries_it(
    api: TestClient, crier: TownCrierConnector, caplog: pytest.LogCaptureFixture
) -> None:
    as_user(ADMIN)

    with caplog.at_level(logging.DEBUG):
        configure(api)
        api.get(f"/connectors/{TOWN_CRIER_ID}", headers=auth())

    assert caplog.records
    for record in caplog.records:
        assert GOOD_TOKEN not in record.getMessage()


def test_the_stored_row_does_not_print_its_own_credentials() -> None:
    row = ConnectorConfiguration(
        org_slug="default",
        connector_id=TOWN_CRIER_ID,
        name="Agency crier",
        credentials={"crier_token": GOOD_TOKEN},
    )

    assert GOOD_TOKEN not in repr(row)
    assert TOWN_CRIER_ID in repr(row)


def test_a_failed_write_does_not_carry_the_bound_credentials_into_its_exception(
    db: Session, crier: TownCrierConnector
) -> None:
    db.add(
        ConnectorConfiguration(
            org_slug="default", connector_id=TOWN_CRIER_ID, name="Agency crier", credentials=good_credentials()
        )
    )
    db.commit()
    db.add(
        ConnectorConfiguration(
            org_slug="default", connector_id=TOWN_CRIER_ID, name="Second crier", credentials=good_credentials()
        )
    )

    with pytest.raises(IntegrityError) as clash:
        db.commit()
    db.rollback()

    assert "connector_configuration_pkey" in str(clash.value)
    assert GOOD_TOKEN not in str(clash.value)
    assert "[parameters:" not in str(clash.value)


def test_the_loser_of_a_concurrent_create_is_refused_without_a_credential_bearing_error(
    db: Session, engine: Engine, crier: TownCrierConnector
) -> None:
    registered = connector_for(TOWN_CRIER_ID)
    assert registered is not None
    peer = Session(engine)
    peer.add(
        ConnectorConfiguration(
            org_slug="default", connector_id=TOWN_CRIER_ID, name="First crier", credentials=good_credentials()
        )
    )
    peer.commit()
    peer.close()

    with pytest.raises(AlreadyConfigured):
        create(db, "default", registered, "Second crier", good_credentials())

    kept = db.get(ConnectorConfiguration, ("default", TOWN_CRIER_ID))
    assert kept is not None
    assert kept.name == "First crier"


def test_a_request_body_does_not_print_the_credentials_it_carries() -> None:
    created = ConnectorIn(connectorId=TOWN_CRIER_ID, name="Agency crier", credentials=good_credentials())
    edited = ConnectorUpdateIn(name="Agency crier", replace=good_credentials(), clear=[])

    for body in (created, edited):
        assert GOOD_TOKEN not in repr(body)
        assert GOOD_TOKEN not in str(body)
        assert GOOD_TOKEN not in f"{body}"

    assert created.credentials["crier_token"] == GOOD_TOKEN

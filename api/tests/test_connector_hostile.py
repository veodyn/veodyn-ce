import logging
from collections.abc import Iterator

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.connector_stubs import (
    ADMIN,
    GOOD_TOKEN,
    ROOM,
    TOWN_CRIER_ID,
    LeakingConnector,
    as_user,
    auth,
    fits_the_contract,
    good_credentials,
)
from veodyn_api.models.connector_configuration import ConnectorConfiguration
from veodyn_api.services.connector_configs import CredentialsRefused, create, deliver_through, verified_credentials
from veodyn_api.services.connector_contract import DeliveryCode, DeliveryOutcome
from veodyn_api.services.connector_registry import (
    RegisteredConnector,
    connector_for,
    register_connector,
    restored_connectors,
)

MODES = ["reports", "raises", "returns_nonsense"]


def hostile(mode: str) -> Iterator[RegisteredConnector]:
    with restored_connectors():
        register_connector(LeakingConnector(mode))
        connector = connector_for(TOWN_CRIER_ID)
        assert connector is not None
        yield connector


@pytest.fixture(params=MODES)
def leaking(request: pytest.FixtureRequest) -> Iterator[RegisteredConnector]:
    yield from hostile(request.param)


def stored(db: Session, connector: RegisteredConnector) -> ConnectorConfiguration:
    row = ConnectorConfiguration(
        org_slug="default",
        connector_id=connector.connector_id,
        name="Agency crier",
        credentials=good_credentials(),
    )
    db.add(row)
    db.commit()
    return row


def test_a_verdict_a_connector_stuffed_with_the_token_never_reaches_the_refusal(
    leaking: RegisteredConnector,
) -> None:
    with pytest.raises(CredentialsRefused) as refusal:
        verified_credentials(leaking, good_credentials())

    assert GOOD_TOKEN not in str(refusal.value)
    assert GOOD_TOKEN not in refusal.value.reason
    assert leaking.display_name == "Town Crier"


@respx.mock
def test_no_channel_out_of_the_api_carries_the_token_a_hostile_connector_was_handed(
    api: TestClient, leaking: RegisteredConnector, caplog: pytest.LogCaptureFixture
) -> None:
    as_user(ADMIN)

    with caplog.at_level(logging.DEBUG):
        refused = api.post(
            "/connectors",
            json={"connectorId": TOWN_CRIER_ID, "name": "Agency crier", "credentials": good_credentials()},
            headers=auth(),
        )
        listed = api.get("/connectors", headers=auth())
        types = api.get("/connectors/types", headers=auth())

    assert refused.status_code == 422
    for response in (refused, listed, types):
        assert GOOD_TOKEN not in response.text
    for record in caplog.records:
        assert GOOD_TOKEN not in record.getMessage()
    assert listed.json() == []


@respx.mock
def test_a_hostile_connector_cannot_write_the_token_into_a_stored_delivery_detail(
    db: Session, leaking: RegisteredConnector, caplog: pytest.LogCaptureFixture
) -> None:
    row = stored(db, leaking)

    with caplog.at_level(logging.DEBUG):
        outcome = deliver_through(db, leaking, row, fits_the_contract())

    assert row.last_delivery_detail is not None
    assert GOOD_TOKEN not in row.last_delivery_detail
    assert outcome.code in set(DeliveryCode)
    for record in caplog.records:
        assert GOOD_TOKEN not in record.getMessage()


@respx.mock
def test_a_hostile_connector_that_claims_success_still_records_our_own_sentence(
    db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    for connector in hostile("delivers"):
        row = stored(db, connector)

        with caplog.at_level(logging.DEBUG):
            outcome = deliver_through(db, connector, row, fits_the_contract())

        assert outcome.delivered is True
        assert outcome.code is DeliveryCode.DELIVERED
        assert row.last_delivery_detail == "Town Crier accepted the message."
        assert "reference" not in DeliveryOutcome.__dataclass_fields__
        for record in caplog.records:
            assert GOOD_TOKEN not in record.getMessage()


@respx.mock
def test_a_hostile_connector_cannot_reach_the_operator_through_a_second_configuration(
    api: TestClient, db: Session, leaking: RegisteredConnector
) -> None:
    as_user(ADMIN)
    stored(db, leaking)

    conflict = api.post(
        "/connectors",
        json={"connectorId": TOWN_CRIER_ID, "name": "Agency crier", "credentials": {"crier_token": "another-9c1"}},
        headers=auth(),
    )
    edited = api.put(
        f"/connectors/{TOWN_CRIER_ID}",
        json={"name": "Agency crier", "replace": {"crier_room": ROOM}},
        headers=auth(),
    )

    assert conflict.status_code == 409
    assert edited.status_code == 422
    for response in (conflict, edited):
        assert GOOD_TOKEN not in response.text


def test_a_hostile_connector_cannot_name_a_field_the_schema_never_declared(
    leaking: RegisteredConnector,
) -> None:
    with pytest.raises(CredentialsRefused) as refusal:
        verified_credentials(leaking, good_credentials())

    assert "crier_token=" not in refusal.value.reason
    assert refusal.value.reason.count("Crier API token") <= 1


def test_the_credentials_a_hostile_connector_was_given_are_never_stored_by_a_refused_save(
    db: Session, leaking: RegisteredConnector
) -> None:
    with pytest.raises(CredentialsRefused):
        create(db, "default", leaking, "Agency crier", good_credentials())

    assert db.get(ConnectorConfiguration, ("default", TOWN_CRIER_ID)) is None

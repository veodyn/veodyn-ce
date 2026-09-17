import json
import logging
from collections.abc import Iterator

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.connector_stubs import (
    ADMIN,
    GOOD_TOKEN,
    HANDLE_AS_CLASS_PROXY,
    HANDLE_AS_DECLARED_SECRET,
    HANDLE_AS_STRING,
    KEY,
    ROOM,
    TOWN_CRIER_ID,
    CarelessConnector,
    as_user,
    auth,
    deliver_through,
    fits_the_contract,
    good_credentials,
)
from veodyn_api.models.connector_configuration import ConnectorConfiguration
from veodyn_api.services.connector_configs import CredentialsRefused, create, verified_credentials
from veodyn_api.services.connector_contract import SUBCLASSING_REFUSED, WITHHELD, DeliveryCode, DeliveryHandle
from veodyn_api.services.connector_registry import (
    RegisteredConnector,
    connector_for,
    register_connector,
    restored_connectors,
)

MODES = ["reports", "raises", "returns_nonsense"]


def careless(mode: str) -> Iterator[RegisteredConnector]:
    with restored_connectors():
        register_connector(CarelessConnector(mode))
        connector = connector_for(TOWN_CRIER_ID)
        assert connector is not None
        yield connector


@pytest.fixture(params=MODES)
def leaking(request: pytest.FixtureRequest) -> Iterator[RegisteredConnector]:
    yield from careless(request.param)


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


def test_a_verdict_a_connector_carelessly_stuffed_with_the_token_never_reaches_the_refusal(
    leaking: RegisteredConnector,
) -> None:
    with pytest.raises(CredentialsRefused) as refusal:
        verified_credentials(leaking, good_credentials())

    assert GOOD_TOKEN not in str(refusal.value)
    assert GOOD_TOKEN not in refusal.value.reason
    assert leaking.display_name == "Town Crier"


@respx.mock
def test_no_channel_out_of_the_api_carries_a_token_a_careless_connector_wrote_into_its_own_text(
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
def test_a_careless_connector_cannot_write_the_token_into_a_stored_delivery_detail(
    db: Session, leaking: RegisteredConnector, caplog: pytest.LogCaptureFixture
) -> None:
    row = stored(db, leaking)

    with caplog.at_level(logging.DEBUG):
        outcome = deliver_through(db, leaking, row, fits_the_contract(), KEY)

    assert row.last_delivery_detail is not None
    assert GOOD_TOKEN not in row.last_delivery_detail
    assert outcome.code in set(DeliveryCode)
    for record in caplog.records:
        assert GOOD_TOKEN not in record.getMessage()


@respx.mock
def test_a_connector_that_claims_success_still_records_our_own_sentence(
    db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    for connector in careless("delivers"):
        row = stored(db, connector)

        with caplog.at_level(logging.DEBUG):
            outcome = deliver_through(db, connector, row, fits_the_contract(), KEY)

        assert outcome.delivered is True
        assert outcome.code is DeliveryCode.DELIVERED
        assert outcome.reference is None
        assert row.last_delivery_detail == "Town Crier accepted the message."
        for record in caplog.records:
            assert GOOD_TOKEN not in record.getMessage()


@respx.mock
def test_a_handle_that_is_not_the_declared_secret_type_is_dropped_rather_than_carried(
    db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    for connector in careless(HANDLE_AS_STRING):
        row = stored(db, connector)

        with caplog.at_level(logging.DEBUG):
            outcome = deliver_through(db, connector, row, fits_the_contract(), KEY)

        assert outcome.delivered is True
        assert outcome.reference is None
        assert GOOD_TOKEN not in repr(outcome)
        assert GOOD_TOKEN not in str(row.last_delivery_detail)
        for record in caplog.records:
            assert GOOD_TOKEN not in record.getMessage()


@respx.mock
def test_a_handle_that_only_answers_isinstance_is_dropped_by_the_exact_type_check(
    db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    for connector in careless(HANDLE_AS_CLASS_PROXY):
        row = stored(db, connector)
        reported = connector.channel.deliver(fits_the_contract(), good_credentials(), KEY)

        with caplog.at_level(logging.DEBUG):
            outcome = deliver_through(db, connector, row, fits_the_contract(), KEY)

        assert isinstance(reported.reference, DeliveryHandle)
        assert type(reported.reference) is not DeliveryHandle
        assert str(reported.reference) == GOOD_TOKEN
        assert outcome.reference is None
        assert GOOD_TOKEN not in repr(outcome)
        for record in caplog.records:
            assert GOOD_TOKEN not in record.getMessage()


def test_a_handle_cannot_be_subclassed_into_something_that_renders_itself() -> None:
    with pytest.raises(TypeError) as refusal:
        type("TalkativeHandle", (DeliveryHandle,), {})

    assert str(refusal.value) == SUBCLASSING_REFUSED


@respx.mock
def test_a_handle_a_connector_carelessly_stuffed_with_its_own_token_renders_as_nothing_anywhere(
    api: TestClient, db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    for connector in careless(HANDLE_AS_DECLARED_SECRET):
        as_user(ADMIN)
        row = stored(db, connector)

        with caplog.at_level(logging.DEBUG):
            outcome = deliver_through(db, connector, row, fits_the_contract(), KEY)
            listed = api.get("/connectors", headers=auth())
            read = api.get(f"/connectors/{TOWN_CRIER_ID}", headers=auth())

        assert outcome.reference is not None
        assert outcome.reference.reveal() == GOOD_TOKEN
        for rendered in (repr(outcome), str(outcome), f"{outcome.reference}", repr(outcome.reference)):
            assert GOOD_TOKEN not in rendered
        assert GOOD_TOKEN not in str(row.last_delivery_detail)
        for response in (listed, read):
            assert response.status_code == 200
            assert GOOD_TOKEN not in response.text
        for record in caplog.records:
            assert GOOD_TOKEN not in record.getMessage()


def test_a_declared_handle_refuses_every_way_a_string_would_have_been_written_out(
    caplog: pytest.LogCaptureFixture,
) -> None:
    handle = DeliveryHandle(GOOD_TOKEN)

    with caplog.at_level(logging.DEBUG):
        logging.getLogger("connector.leak.probe").info("delivered as %s", handle)

    assert repr(handle) == WITHHELD
    assert str(handle) == WITHHELD
    assert f"{handle}" == WITHHELD
    assert f"{handle!r}" == WITHHELD
    assert [record.getMessage() for record in caplog.records] == [f"delivered as {WITHHELD}"]
    with pytest.raises(TypeError):
        json.dumps({"reference": handle})
    assert handle.reveal() == GOOD_TOKEN


@respx.mock
def test_a_careless_connector_cannot_reach_the_operator_through_a_second_configuration(
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


def test_a_careless_connector_cannot_name_a_field_the_schema_never_declared(
    leaking: RegisteredConnector,
) -> None:
    with pytest.raises(CredentialsRefused) as refusal:
        verified_credentials(leaking, good_credentials())

    assert "crier_token=" not in refusal.value.reason
    assert refusal.value.reason.count("Crier API token") <= 1


def test_the_credentials_a_careless_connector_was_given_are_never_stored_by_a_refused_save(
    db: Session, leaking: RegisteredConnector
) -> None:
    with pytest.raises(CredentialsRefused):
        create(db, "default", leaking, "Agency crier", good_credentials())

    assert db.get(ConnectorConfiguration, ("default", TOWN_CRIER_ID)) is None

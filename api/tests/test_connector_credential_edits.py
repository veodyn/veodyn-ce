from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.connector_stubs import (
    ADMIN,
    GOOD_TOKEN,
    NOTE,
    ROOM,
    TOWN_CRIER_ID,
    TownCrierConnector,
    as_user,
    auth,
    good_credentials,
)
from veodyn_api.services.connector_registry import register_connector, restored_connectors


@pytest.fixture
def crier() -> Iterator[TownCrierConnector]:
    with restored_connectors():
        connector = TownCrierConnector()
        register_connector(connector)
        yield connector


def create(api: TestClient, credentials: dict[str, Any] | None = None) -> httpx.Response:
    return api.post(
        "/connectors",
        json={
            "connectorId": TOWN_CRIER_ID,
            "name": "Agency crier",
            "credentials": good_credentials() if credentials is None else credentials,
        },
        headers=auth(),
    )


def edit(api: TestClient, **operations: Any) -> httpx.Response:
    return api.put(
        f"/connectors/{TOWN_CRIER_ID}",
        json={"name": "Agency crier", **operations},
        headers=auth(),
    )


@respx.mock
def test_a_field_named_in_neither_operation_keeps_the_stored_value(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)
    create(api)

    response = api.put(
        f"/connectors/{TOWN_CRIER_ID}",
        json={"name": "Renamed crier", "replace": {"crier_room": "town-hall"}},
        headers=auth(),
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed crier"
    assert crier.verified_with[-1] == {"crier_token": GOOD_TOKEN, "crier_room": "town-hall"}


@respx.mock
def test_naming_nothing_at_all_keeps_every_stored_credential(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)
    create(api)

    response = edit(api)

    assert response.status_code == 200
    assert crier.verified_with[-1] == good_credentials()


@respx.mock
def test_a_blank_replacement_is_refused_rather_than_silently_read_as_keep(
    api: TestClient, crier: TownCrierConnector
) -> None:
    as_user(ADMIN)
    create(api)

    response = edit(api, replace={"crier_token": "   ", "crier_room": ROOM})

    assert response.status_code == 422
    assert "crier_token" in response.json()["error"]["message"]
    assert crier.verified_with == [good_credentials()]


@respx.mock
def test_an_optional_credential_can_be_cleared(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)
    create(api, {**good_credentials(), "crier_note": NOTE})

    response = edit(api, clear=["crier_note"])

    assert response.status_code == 200
    assert response.json()["configuredFields"] == ["crier_room", "crier_token"]
    assert crier.verified_with[-1] == good_credentials()


@respx.mock
def test_clearing_a_required_credential_is_refused(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)
    create(api)

    response = edit(api, clear=["crier_token"])

    assert response.status_code == 422
    assert "crier_token" in response.json()["error"]["message"]
    assert api.get(f"/connectors/{TOWN_CRIER_ID}", headers=auth()).json()["configuredFields"] == [
        "crier_room",
        "crier_token",
    ]


@respx.mock
def test_replacing_and_clearing_one_field_in_the_same_request_is_refused(
    api: TestClient, crier: TownCrierConnector
) -> None:
    as_user(ADMIN)
    create(api, {**good_credentials(), "crier_note": NOTE})

    response = edit(api, replace={"crier_note": "louder"}, clear=["crier_note"])

    assert response.status_code == 422
    assert "crier_note" in response.json()["error"]["message"]


@respx.mock
def test_a_field_the_connector_never_declared_cannot_be_cleared(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)
    create(api)

    response = edit(api, clear=["crier_secret_backdoor"])

    assert response.status_code == 422
    assert "crier_secret_backdoor" in response.json()["error"]["message"]


@respx.mock
def test_the_type_picker_says_which_credentials_can_be_cleared(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)

    schema = api.get("/connectors/types", headers=auth()).json()[0]["credentialSchema"]

    assert schema["clearable"] == ["crier_note"]
    assert schema["required"] == ["crier_token", "crier_room"]


@respx.mock
def test_a_boolean_credential_replaced_with_false_is_stored_as_false(
    api: TestClient, crier: TownCrierConnector
) -> None:
    as_user(ADMIN)
    create(api, {**good_credentials(), "crier_note": NOTE})

    response = edit(api, replace={"crier_note": False})

    assert response.status_code == 200
    assert crier.verified_with[-1]["crier_note"] is False

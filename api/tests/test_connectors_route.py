from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.connector_stubs import (
    ADMIN,
    BAD_TOKEN,
    GOOD_TOKEN,
    MEMBER,
    OTHER_ADMIN,
    REDASH,
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


def create(api: TestClient, credentials: dict[str, Any] | None = None, name: str = "Agency crier") -> httpx.Response:
    return api.post(
        "/connectors",
        json={
            "connectorId": TOWN_CRIER_ID,
            "name": name,
            "credentials": good_credentials() if credentials is None else credentials,
        },
        headers=auth(),
    )


@respx.mock
def test_an_unauthenticated_caller_sees_no_connector_types(api: TestClient, crier: TownCrierConnector) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(401))

    assert api.get("/connectors/types", headers=auth()).status_code == 401


@respx.mock
def test_a_member_who_is_not_an_administrator_is_refused(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(MEMBER)

    assert api.get("/connectors/types", headers=auth("mo")).status_code == 403
    assert api.get("/connectors", headers=auth("mo")).status_code == 403
    assert create(api).status_code == 403


@respx.mock
def test_the_type_picker_is_built_from_the_registry(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)

    body = api.get("/connectors/types", headers=auth()).json()

    assert [entry["connectorId"] for entry in body] == [TOWN_CRIER_ID]
    entry = body[0]
    assert entry["displayName"] == "Town Crier"
    assert entry["recallable"] is True
    assert entry["credentialSchema"]["required"] == ["crier_token", "crier_room"]
    assert entry["credentialSchema"]["secret"] == ["crier_token"]
    assert entry["credentialSchema"]["properties"]["crier_token"]["title"] == "Crier API token"
    assert entry["contentContract"] == {
        "maxLength": 280,
        "supportsMarkup": False,
        "urlCountsAsCharacters": 23,
        "requiredFooter": "Reply STOP to opt out.",
    }


@respx.mock
def test_a_build_with_no_connector_installed_offers_no_type(api: TestClient) -> None:
    as_user(ADMIN)

    assert api.get("/connectors/types", headers=auth()).json() == []


@respx.mock
def test_saving_a_configuration_tests_the_credentials_before_it_stores_them(
    api: TestClient, crier: TownCrierConnector
) -> None:
    as_user(ADMIN)

    response = create(api)

    assert response.status_code == 201
    assert crier.verified_with == [{"crier_token": GOOD_TOKEN, "crier_room": ROOM}]
    assert response.json()["configuredFields"] == ["crier_room", "crier_token"]


@respx.mock
def test_a_credential_the_connector_refuses_is_not_stored(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)

    response = create(api, {"crier_token": BAD_TOKEN, "crier_room": ROOM})

    assert response.status_code == 422
    assert "does not recognise" in response.json()["error"]["message"]
    assert api.get("/connectors", headers=auth()).json() == []


@respx.mock
def test_a_connector_this_build_does_not_install_cannot_be_configured(api: TestClient) -> None:
    as_user(ADMIN)

    response = create(api)

    assert response.status_code == 404
    assert response.json()["error"]["id"] == "VEODYN_CONNECTOR_NOT_REGISTERED"


@respx.mock
def test_a_missing_required_credential_is_named(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)

    response = create(api, {"crier_token": GOOD_TOKEN})

    assert response.status_code == 422
    assert "crier_room" in response.json()["error"]["message"]
    assert crier.verified_with == []


@respx.mock
def test_a_credential_key_the_connector_never_declared_is_refused(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)

    response = create(api, {**good_credentials(), "crier_secret_backdoor": "x"})

    assert response.status_code == 422
    assert "crier_secret_backdoor" in response.json()["error"]["message"]
    assert crier.verified_with == []


@respx.mock
def test_one_organization_configures_one_connector_once(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)
    assert create(api).status_code == 201

    second = create(api, name="Another crier")

    assert second.status_code == 409
    assert second.json()["error"]["id"] == "VEODYN_CONNECTOR_ALREADY_CONFIGURED"


@respx.mock
def test_a_connector_that_has_never_delivered_reads_as_untested(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)
    create(api)

    health = api.get(f"/connectors/{TOWN_CRIER_ID}", headers=auth()).json()["health"]

    assert health["delivery"] == "untested"
    assert health["lastDeliveryAt"] is None
    assert health["credentialsVerifiedAt"] is not None


@respx.mock
def test_editing_re_tests_the_credentials_and_refuses_a_bad_replacement(
    api: TestClient, crier: TownCrierConnector
) -> None:
    as_user(ADMIN)
    create(api)

    response = api.put(
        f"/connectors/{TOWN_CRIER_ID}",
        json={"name": "Agency crier", "replace": {"crier_token": BAD_TOKEN, "crier_room": ROOM}},
        headers=auth(),
    )

    assert response.status_code == 422
    assert api.get(f"/connectors/{TOWN_CRIER_ID}", headers=auth()).json()["name"] == "Agency crier"


@respx.mock
def test_another_organizations_configuration_is_neither_listed_nor_readable(
    api: TestClient, crier: TownCrierConnector
) -> None:
    as_user(ADMIN)
    create(api)
    as_user(OTHER_ADMIN)

    assert api.get("/connectors", headers=auth("bo")).json() == []
    assert api.get(f"/connectors/{TOWN_CRIER_ID}", headers=auth("bo")).status_code == 404


@respx.mock
def test_forgetting_a_configuration_removes_it(api: TestClient, crier: TownCrierConnector) -> None:
    as_user(ADMIN)
    create(api)

    assert api.delete(f"/connectors/{TOWN_CRIER_ID}", headers=auth()).status_code == 204
    assert api.get("/connectors", headers=auth()).json() == []
    assert api.delete(f"/connectors/{TOWN_CRIER_ID}", headers=auth()).status_code == 404

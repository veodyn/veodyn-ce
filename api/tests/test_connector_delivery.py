from collections.abc import Iterator

import pytest
from sqlalchemy.orm import Session

from tests.connector_stubs import (
    GOOD_TOKEN,
    KEY,
    TOWN_CRIER_ID,
    DeliveryRefused,
    TownCrierConnector,
    deliver_through,
    fits_the_contract,
    good_credentials,
)
from veodyn_api.models.connector_configuration import ConnectorConfiguration
from veodyn_api.services.connector_configs import create
from veodyn_api.services.connector_contract import DeliveryCode, Rendering, is_permanent
from veodyn_api.services.connector_registry import (
    RegisteredConnector,
    connector_for,
    register_connector,
    restored_connectors,
)


@pytest.fixture
def crier() -> Iterator[TownCrierConnector]:
    with restored_connectors():
        connector = TownCrierConnector()
        register_connector(connector)
        yield connector


def registered() -> RegisteredConnector:
    connector = connector_for(TOWN_CRIER_ID)
    assert connector is not None
    return connector


def configured(db: Session, crier: TownCrierConnector) -> ConnectorConfiguration:
    return create(db, "default", registered(), "Agency crier", good_credentials())


def test_a_configuration_reads_as_untested_until_something_has_been_delivered(
    db: Session, crier: TownCrierConnector
) -> None:
    row = configured(db, crier)

    assert row.delivery_health == "untested"
    assert row.last_delivery_at is None


def test_a_rendering_the_content_contract_refuses_is_never_handed_to_the_connector(
    db: Session, crier: TownCrierConnector
) -> None:
    row = configured(db, crier)

    with pytest.raises(DeliveryRefused) as refusal:
        deliver_through(db, registered(), row, Rendering(body="<b>Detour</b> with no footer"), KEY)

    assert "plain text" in str(refusal.value)
    assert crier.delivered == []
    assert row.delivery_health == "untested"


def test_a_delivered_rendering_moves_the_connector_off_untested(db: Session, crier: TownCrierConnector) -> None:
    row = configured(db, crier)

    outcome = deliver_through(db, registered(), row, fits_the_contract(), KEY)

    assert outcome.delivered is True
    assert outcome.code is DeliveryCode.DELIVERED
    assert row.delivery_health == "delivering"
    assert row.last_delivery_detail == "Town Crier accepted the message."


def test_a_refused_delivery_is_surfaced_rather_than_swallowed(db: Session, crier: TownCrierConnector) -> None:
    row = configured(db, crier)
    crier.next_delivery_succeeds = False

    deliver_through(db, registered(), row, fits_the_contract(), KEY)

    assert row.delivery_health == "failing"
    assert row.last_delivery_detail == "Town Crier could not be reached."


def test_a_connector_that_raises_while_delivering_records_a_sentence_of_our_own(
    db: Session, crier: TownCrierConnector
) -> None:
    row = configured(db, crier)
    crier.raises_on_deliver = True

    outcome = deliver_through(db, registered(), row, fits_the_contract(), KEY)

    assert outcome.delivered is False
    assert outcome.code is DeliveryCode.CONNECTOR_RAISED
    assert row.delivery_health == "failing"
    assert row.last_delivery_detail is not None
    assert GOOD_TOKEN not in row.last_delivery_detail


def test_delivery_replays_the_stored_credentials_rather_than_a_digest_of_them(
    db: Session, crier: TownCrierConnector
) -> None:
    row = configured(db, crier)

    deliver_through(db, registered(), row, fits_the_contract(), KEY)

    db.expire_all()
    reread = db.get(ConnectorConfiguration, (row.org_slug, row.connector_id))
    assert reread is not None
    assert crier.delivered_with == [dict(reread.credentials)]
    assert crier.delivered_with == crier.verified_with


def test_the_idempotency_key_is_handed_to_the_connector_with_the_rendering(
    db: Session, crier: TownCrierConnector
) -> None:
    row = configured(db, crier)

    deliver_through(db, registered(), row, fits_the_contract(), KEY)
    deliver_through(db, registered(), row, fits_the_contract(), KEY)

    assert crier.idempotency_keys == [KEY, KEY]


def test_a_code_is_permanent_only_when_no_retry_could_change_it() -> None:
    assert is_permanent(DeliveryCode.CREDENTIALS_REJECTED) is True
    assert is_permanent(DeliveryCode.CONTENT_REJECTED) is True
    assert is_permanent(DeliveryCode.REJECTED_BY_CHANNEL) is True
    assert is_permanent(DeliveryCode.RECALL_TARGET_GONE) is True
    assert is_permanent(DeliveryCode.RATE_LIMITED) is False
    assert is_permanent(DeliveryCode.CHANNEL_UNAVAILABLE) is False
    assert is_permanent(DeliveryCode.CONNECTOR_RAISED) is False
    assert is_permanent(DeliveryCode.PARTIALLY_DELIVERED) is False
    assert is_permanent(DeliveryCode.UNSPECIFIED) is False

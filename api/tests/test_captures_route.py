"""The /captures endpoint: the wire contract, and what it keeps saying when a
lookup fails.

The endpoint exists because it did not. veodyn-de's /api/captures proxy forwarded
to this service for as long as the Captures page has existed, got a 404, and
the page rendered that as the calm "No captures configured." So the tests that
matter here are the ones about degradation: a capture list that empties itself
whenever Redash is unreachable would be the same defect wearing a 200.

The warehouse stubs are test_catalog's, deliberately. Captures are derived from
the catalog, so a fixture drift that changed one and not the other would hide
the very disagreement this design exists to prevent.
"""

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.conftest import REDASH_TEST_URL
from tests.test_catalog import BIKE_TABLE, RAIL_TABLE, USER, as_user, catalog_api, warehouse_answers
from veodyn_api.services.captures import NO_SCHEDULE

__all__ = ["catalog_api"]  # re-exported fixture, imported for its side effect

REDASH = REDASH_TEST_URL

SPANS = {
    "positions_21": {"start": "2026-07-01 00:00:00.000", "end": "2026-07-25 11:30:00.000"},
    "stations_32": {"start": "2026-07-01 00:00:00.000", "end": "2026-07-25 11:29:00.000"},
}


def redash_lists(queries: list[dict[str, object]], sources: list[dict[str, object]]) -> None:
    respx.get(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json={"results": queries}))
    respx.get(f"{REDASH}/api/data_sources").mock(return_value=httpx.Response(200, json=sources))


QUERIES = [
    {"id": 21, "schedule": {"interval": 300}, "data_source_id": 3},
    {"id": 32, "schedule": {"interval": 3600}, "data_source_id": 4},
]
# The captures are ingested through API connectors and land in ClickHouse, so
# the data source a probe must run on is never the one its capture query names.
# The fixture carried only the two connectors while the probe was bound to them,
# which is why nothing here failed.
SOURCES = [
    {"id": 3, "name": "Light Rail", "type": "url"},
    {"id": 4, "name": "Bike Share", "type": "url"},
    {"id": 8, "name": "Historical", "type": "clickhouse"},
]


@respx.mock
def test_unauthenticated_callers_get_nothing(catalog_api: TestClient) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(404))
    warehouse_answers()

    response = catalog_api.get("/captures")

    assert response.status_code == 401


@respx.mock
def test_returns_a_capture_per_dataset_in_the_capture_ts_shape(catalog_api: TestClient) -> None:
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists(QUERIES, SOURCES)

    response = catalog_api.get("/captures", cookies={"session": "s"})

    assert response.status_code == 200
    captures = response.json()
    # Keys are asserted literally: the frontend renders these objects directly,
    # so the camelCase aliases are the contract, not the python field names.
    assert set(captures[0]) == {
        "id",
        "name",
        "source",
        "cadence",
        "cadenceSource",
        "expectedIntervalSeconds",
        "alertId",
        "lastReceivedAt",
        "status",
        "datasetCount",
    }
    by_id = {c["id"]: c for c in captures}
    # A schedule Redash knows about, with nobody having declared anything.
    assert by_id[BIKE_TABLE]["cadenceSource"] == "schedule"
    assert by_id[BIKE_TABLE]["expectedIntervalSeconds"] is None
    assert by_id[BIKE_TABLE]["cadence"] == "hourly"
    assert by_id[BIKE_TABLE]["source"] == "Bike Share"
    assert by_id[RAIL_TABLE]["cadence"] == "every 5 mins"
    assert by_id[RAIL_TABLE]["source"] == "Light Rail"


@respx.mock
def test_a_capture_id_matches_the_dataset_it_fills(catalog_api: TestClient) -> None:
    # The Datasets column on the board joins on this. It read 0 on every row for
    # as long as build_catalog left freshness.captureId null.
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists(QUERIES, SOURCES)

    captures = catalog_api.get("/captures", cookies={"session": "s"}).json()
    datasets = catalog_api.get("/catalog", cookies={"session": "s"}).json()

    assert {c["id"] for c in captures} == {d["freshness"]["captureId"] for d in datasets}


@respx.mock
def test_an_unreachable_redash_costs_the_labels_and_not_the_board(catalog_api: TestClient) -> None:
    as_user(USER)
    warehouse_answers(SPANS)
    respx.get(f"{REDASH}/api/queries").mock(return_value=httpx.Response(500))
    respx.get(f"{REDASH}/api/data_sources").mock(return_value=httpx.Response(500))

    response = catalog_api.get("/captures", cookies={"session": "s"})

    assert response.status_code == 200
    captures = response.json()
    assert len(captures) == 2
    assert {c["cadence"] for c in captures} == {NO_SCHEDULE}
    assert {c["source"] for c in captures} == {""}
    # The part that matters: last received still lands, so the board can still
    # answer the question it exists for.
    assert all(c["lastReceivedAt"] for c in captures)


@respx.mock
def test_a_declared_expectation_gives_the_board_a_period_to_age_against(
    catalog_api: TestClient,
) -> None:
    """The gap this closes.

    On the instance this was built for, every capture query is unscheduled while
    its table updates every forty seconds, because something outside Redash
    drives the capture. So the board read "not scheduled" beside a Last received
    of "59 seconds ago", and lib/capture-status.ts, which needs a period to age
    against, fell back to repeating the upstream's own status for every row.
    Nothing on that board was being checked.
    """
    as_user(USER)
    warehouse_answers(SPANS)
    # Neither capture is scheduled, which is the state the real instance is in.
    redash_lists([{"id": 21, "data_source_id": 3}, {"id": 32, "data_source_id": 4}], SOURCES)

    before = {c["id"]: c for c in catalog_api.get("/captures", cookies={"session": "s"}).json()}
    assert before[RAIL_TABLE]["cadence"] == NO_SCHEDULE
    assert before[RAIL_TABLE]["cadenceSource"] == "none"

    put = catalog_api.put(
        f"/captures/{RAIL_TABLE}/expectation",
        json={"expectedIntervalSeconds": 300},
        cookies={"session": "s"},
    )
    assert put.status_code == 204

    after = {c["id"]: c for c in catalog_api.get("/captures", cookies={"session": "s"}).json()}
    # A label lib/capture-status.ts can parse, which is what turns the derivation
    # back on. The round trip is the contract cadence_label documents.
    assert after[RAIL_TABLE]["cadence"] == "every 5 mins"
    assert after[RAIL_TABLE]["cadenceSource"] == "declared"
    assert after[RAIL_TABLE]["expectedIntervalSeconds"] == 300
    # And only that capture. An expectation is per capture, not a board setting.
    assert after[BIKE_TABLE]["cadenceSource"] == "none"


@respx.mock
def test_a_declaration_beats_the_redash_schedule(catalog_api: TestClient) -> None:
    """Two claims, and the person's wins.

    The schedule is Redash's belief about who runs the capture; the expectation
    is an operator's belief about how often data should arrive. Where they
    disagree the operator is describing the world and Redash is describing its
    own cron, so the operator is the one to age against.
    """
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists(QUERIES, SOURCES)  # bike is scheduled hourly

    catalog_api.put(
        f"/captures/{BIKE_TABLE}/expectation",
        json={"expectedIntervalSeconds": 60},
        cookies={"session": "s"},
    )

    captures = {c["id"]: c for c in catalog_api.get("/captures", cookies={"session": "s"}).json()}
    assert captures[BIKE_TABLE]["cadence"] == "minutely"
    assert captures[BIKE_TABLE]["cadenceSource"] == "declared"


@respx.mock
def test_clearing_an_expectation_returns_the_capture_to_its_schedule(catalog_api: TestClient) -> None:
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists(QUERIES, SOURCES)

    catalog_api.put(
        f"/captures/{BIKE_TABLE}/expectation",
        json={"expectedIntervalSeconds": 60},
        cookies={"session": "s"},
    )
    cleared = catalog_api.put(
        f"/captures/{BIKE_TABLE}/expectation",
        json={"expectedIntervalSeconds": None},
        cookies={"session": "s"},
    )
    assert cleared.status_code == 204

    captures = {c["id"]: c for c in catalog_api.get("/captures", cookies={"session": "s"}).json()}
    # Back to Redash's own schedule rather than to nothing: clearing a person's
    # opinion does not delete the cron that is genuinely there.
    assert captures[BIKE_TABLE]["cadence"] == "hourly"
    assert captures[BIKE_TABLE]["cadenceSource"] == "schedule"
    assert captures[BIKE_TABLE]["expectedIntervalSeconds"] is None


@respx.mock
@pytest.mark.parametrize("seconds", [0, -300, 30, 40 * 24 * 3600])
def test_an_interval_the_board_could_not_render_is_refused(catalog_api: TestClient, seconds: int) -> None:
    """Named its own cause, not INVALID_REQUEST.

    A caller can tell "you sent a nonsense interval", which is a number to
    correct in a field the user is looking at, from "you sent a nonsense body",
    which is a bug in the client.
    """
    as_user(USER)

    response = catalog_api.put(
        f"/captures/{RAIL_TABLE}/expectation",
        json={"expectedIntervalSeconds": seconds},
        cookies={"session": "s"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_CAPTURE_INTERVAL_INVALID"


@respx.mock
def test_an_expectation_may_be_set_on_a_capture_that_has_not_appeared_yet(
    catalog_api: TestClient,
) -> None:
    """Deliberately not checked against the catalog.

    A capture id is a warehouse table name, and the capture an operator most
    wants to hear about is the one that has stopped appearing. Refusing an
    expectation for a table the registry does not currently list would lock
    them out of exactly that case.
    """
    as_user(USER)

    response = catalog_api.put(
        "/captures/historical.q_not_here_yet_99/expectation",
        json={"expectedIntervalSeconds": 3600},
        cookies={"session": "s"},
    )

    assert response.status_code == 204


def test_an_unauthenticated_caller_cannot_declare_an_expectation(catalog_api: TestClient) -> None:
    response = catalog_api.put(f"/captures/{RAIL_TABLE}/expectation", json={"expectedIntervalSeconds": 3600})

    assert response.status_code == 401

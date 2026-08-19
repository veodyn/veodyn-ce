"""Feed Health: the wire contract, and what it keeps saying when a lookup fails.

The endpoint exists because it did not. veodyn-de's /api/feeds proxy forwarded
to this service for as long as the Feed Health page has existed, got a 404, and
the page rendered that as the calm "No feeds configured." So the tests that
matter here are the ones about degradation: a feed list that empties itself
whenever Redash is unreachable would be the same defect wearing a 200.

The warehouse stubs are test_catalog's, deliberately. Feeds are derived from the
catalog, so a fixture drift that changed one and not the other would hide the
very disagreement this design exists to prevent.
"""

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.conftest import REDASH_TEST_URL
from tests.test_catalog import BIKE_TABLE, RAIL_TABLE, USER, as_user, catalog_api, warehouse_answers
from veodyn_api.schemas.catalog import DatasetCoverageOut, DatasetFreshnessOut, DatasetOut
from veodyn_api.services.feeds import NO_SCHEDULE, QueryFacts, build_feeds, cadence_label

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


# ─── cadence_label: the round trip lib/feed-status.ts depends on ──────────────


@pytest.mark.parametrize(
    ("seconds", "label"),
    [
        (60, "minutely"),
        (3600, "hourly"),
        (86400, "daily"),
        (604800, "weekly"),
        (300, "every 5 mins"),
        (7200, "every 2 hours"),
        (172800, "every 2 days"),
        (30, "every 30 secs"),
        (0, NO_SCHEDULE),
        (-1, NO_SCHEDULE),
    ],
)
def test_cadence_label_reads_as_english(seconds: int, label: str) -> None:
    assert cadence_label(seconds) == label


# `cadenceToMs` in app/src/lib/feed-status.ts, transcribed. The browser
# derives fresh/stale/down by comparing this period against the last capture, so
# a label it cannot parse silently disables the derivation instead of failing.
def cadence_to_ms(cadence: str) -> int | None:
    import re

    named = {"minutely": 60_000, "hourly": 3_600_000, "daily": 86_400_000, "weekly": 604_800_000}
    if cadence in named:
        return named[cadence]
    match = re.search(r"(\d+)\s*(sec|second|min|minute|hour|day|week)s?", cadence)
    if not match:
        return None
    unit = {"sec": 1_000, "second": 1_000, "min": 60_000, "minute": 60_000}
    unit |= {"hour": 3_600_000, "day": 86_400_000, "week": 604_800_000}
    return int(match.group(1)) * unit[match.group(2)]


@pytest.mark.parametrize("seconds", [30, 60, 300, 900, 3600, 7200, 86400, 172800, 604800])
def test_every_label_survives_the_round_trip_through_the_frontend_parser(seconds: int) -> None:
    assert cadence_to_ms(cadence_label(seconds)) == seconds * 1000


def test_an_unscheduled_query_is_labelled_so_the_parser_gives_up_cleanly() -> None:
    # Not a cosmetic choice: a label that parsed would invent a period and start
    # calling a hand-run capture late.
    assert cadence_to_ms(cadence_label(0)) is None


# ─── build_feeds: pure, so the whole board is testable without a backend ──────


def dataset(id_: str, *, query_id: int, last: str, status: str = "fresh", origin: str = "capture") -> DatasetOut:
    return DatasetOut(
        id=id_,
        name=f"Query {query_id}",
        description="",
        domain=None,
        schema=[],
        freshness=DatasetFreshnessOut(last_updated_at=last, status=status, feed_id=id_),
        coverage=DatasetCoverageOut(start="", end=last),
        row_count=1,
        sources=[],
        tags=[],
        sample_query_id=query_id,
        origin=origin,
    )


def test_a_feed_carries_its_cadence_and_the_source_its_query_reads() -> None:
    feeds = build_feeds(
        [dataset("t_21", query_id=21, last="2026-07-25T11:30:00+00:00")],
        facts={21: QueryFacts(interval_seconds=300, data_source_id=3)},
        sources={3: "Light Rail"},
    )

    assert [(f.id, f.cadence, f.source, f.dataset_count) for f in feeds] == [("t_21", "every 5 mins", "Light Rail", 1)]


def test_a_query_missing_from_redash_keeps_its_row_and_loses_only_its_labels() -> None:
    # An archived query still captured the table somebody is reading. Dropping
    # the row would be the empty-list failure this endpoint exists to end.
    feeds = build_feeds(
        [dataset("t_99", query_id=99, last="2026-07-25T11:30:00+00:00")],
        facts={},
        sources={},
    )

    assert len(feeds) == 1
    assert feeds[0].cadence == NO_SCHEDULE
    assert feeds[0].source == ""
    assert feeds[0].last_received_at == "2026-07-25T11:30:00+00:00"


def test_a_table_that_never_captured_anything_is_not_a_feed() -> None:
    feeds = build_feeds([dataset("t_0", query_id=1, last="")], facts={}, sources={})

    assert feeds == []


def test_the_status_is_the_catalog_s_own_verdict_not_a_second_opinion() -> None:
    # The disagreement that produced this endpoint was two surfaces computing
    # freshness separately. build_feeds must copy, never recompute.
    feeds = build_feeds(
        [dataset("t_1", query_id=1, last="2026-01-01T00:00:00+00:00", status="stale")],
        facts={1: QueryFacts(interval_seconds=60, data_source_id=3)},
        sources={3: "Light Rail"},
    )

    assert feeds[0].status == "stale"


# ─── the route ───────────────────────────────────────────────────────────────


@respx.mock
def test_unauthenticated_callers_get_nothing(catalog_api: TestClient) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(404))
    warehouse_answers()

    response = catalog_api.get("/feeds")

    assert response.status_code == 401


@respx.mock
def test_returns_a_feed_per_capture_in_the_feed_ts_shape(catalog_api: TestClient) -> None:
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists(QUERIES, SOURCES)

    response = catalog_api.get("/feeds", cookies={"session": "s"})

    assert response.status_code == 200
    feeds = response.json()
    # Keys are asserted literally: the frontend renders these objects directly,
    # so the camelCase aliases are the contract, not the python field names.
    assert set(feeds[0]) == {
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
    by_id = {f["id"]: f for f in feeds}
    # A schedule Redash knows about, with nobody having declared anything.
    assert by_id[BIKE_TABLE]["cadenceSource"] == "schedule"
    assert by_id[BIKE_TABLE]["expectedIntervalSeconds"] is None
    assert by_id[BIKE_TABLE]["cadence"] == "hourly"
    assert by_id[BIKE_TABLE]["source"] == "Bike Share"
    assert by_id[RAIL_TABLE]["cadence"] == "every 5 mins"
    assert by_id[RAIL_TABLE]["source"] == "Light Rail"


@respx.mock
def test_a_feed_id_matches_the_dataset_it_fills(catalog_api: TestClient) -> None:
    # The Datasets column on the board joins on this. It read 0 on every row for
    # as long as build_catalog left freshness.feedId null.
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists(QUERIES, SOURCES)

    feeds = catalog_api.get("/feeds", cookies={"session": "s"}).json()
    datasets = catalog_api.get("/catalog", cookies={"session": "s"}).json()

    assert {f["id"] for f in feeds} == {d["freshness"]["feedId"] for d in datasets}


@respx.mock
def test_an_unreachable_redash_costs_the_labels_and_not_the_board(catalog_api: TestClient) -> None:
    as_user(USER)
    warehouse_answers(SPANS)
    respx.get(f"{REDASH}/api/queries").mock(return_value=httpx.Response(500))
    respx.get(f"{REDASH}/api/data_sources").mock(return_value=httpx.Response(500))

    response = catalog_api.get("/feeds", cookies={"session": "s"})

    assert response.status_code == 200
    feeds = response.json()
    assert len(feeds) == 2
    assert {f["cadence"] for f in feeds} == {NO_SCHEDULE}
    assert {f["source"] for f in feeds} == {""}
    # The part that matters: last received still lands, so the board can still
    # answer the question it exists for.
    assert all(f["lastReceivedAt"] for f in feeds)


@respx.mock
def test_a_declared_expectation_gives_the_board_a_period_to_age_against(
    catalog_api: TestClient,
) -> None:
    """The gap this closes.

    On the instance this was built for, every capture query is unscheduled while
    its table updates every forty seconds, because something outside Redash
    drives the capture. So the board read "not scheduled" beside a Last received
    of "59 seconds ago", and lib/feed-status.ts, which needs a period to age
    against, fell back to repeating the upstream's own status for every row.
    Nothing on that board was being checked.
    """
    as_user(USER)
    warehouse_answers(SPANS)
    # Neither capture is scheduled, which is the state the real instance is in.
    redash_lists([{"id": 21, "data_source_id": 3}, {"id": 32, "data_source_id": 4}], SOURCES)

    before = {f["id"]: f for f in catalog_api.get("/feeds", cookies={"session": "s"}).json()}
    assert before[RAIL_TABLE]["cadence"] == NO_SCHEDULE
    assert before[RAIL_TABLE]["cadenceSource"] == "none"

    put = catalog_api.put(
        f"/feeds/{RAIL_TABLE}/expectation",
        json={"expectedIntervalSeconds": 300},
        cookies={"session": "s"},
    )
    assert put.status_code == 204

    after = {f["id"]: f for f in catalog_api.get("/feeds", cookies={"session": "s"}).json()}
    # A label lib/feed-status.ts can parse, which is what turns the derivation
    # back on. The round trip is the contract cadence_label documents.
    assert after[RAIL_TABLE]["cadence"] == "every 5 mins"
    assert after[RAIL_TABLE]["cadenceSource"] == "declared"
    assert after[RAIL_TABLE]["expectedIntervalSeconds"] == 300
    # And only that feed. An expectation is per capture, not a board setting.
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
        f"/feeds/{BIKE_TABLE}/expectation",
        json={"expectedIntervalSeconds": 60},
        cookies={"session": "s"},
    )

    feeds = {f["id"]: f for f in catalog_api.get("/feeds", cookies={"session": "s"}).json()}
    assert feeds[BIKE_TABLE]["cadence"] == "minutely"
    assert feeds[BIKE_TABLE]["cadenceSource"] == "declared"


@respx.mock
def test_clearing_an_expectation_returns_the_feed_to_its_schedule(catalog_api: TestClient) -> None:
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists(QUERIES, SOURCES)

    catalog_api.put(
        f"/feeds/{BIKE_TABLE}/expectation",
        json={"expectedIntervalSeconds": 60},
        cookies={"session": "s"},
    )
    cleared = catalog_api.put(
        f"/feeds/{BIKE_TABLE}/expectation",
        json={"expectedIntervalSeconds": None},
        cookies={"session": "s"},
    )
    assert cleared.status_code == 204

    feeds = {f["id"]: f for f in catalog_api.get("/feeds", cookies={"session": "s"}).json()}
    # Back to Redash's own schedule rather than to nothing: clearing a person's
    # opinion does not delete the cron that is genuinely there.
    assert feeds[BIKE_TABLE]["cadence"] == "hourly"
    assert feeds[BIKE_TABLE]["cadenceSource"] == "schedule"
    assert feeds[BIKE_TABLE]["expectedIntervalSeconds"] is None


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
        f"/feeds/{RAIL_TABLE}/expectation",
        json={"expectedIntervalSeconds": seconds},
        cookies={"session": "s"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_FEED_INTERVAL_INVALID"


@respx.mock
def test_an_expectation_may_be_set_on_a_feed_that_has_not_appeared_yet(
    catalog_api: TestClient,
) -> None:
    """Deliberately not checked against the catalog.

    A feed id is a warehouse table name, and the feed an operator most wants to
    hear about is the one that has stopped appearing. Refusing an expectation
    for a table the registry does not currently list would lock them out of
    exactly that case.
    """
    as_user(USER)

    response = catalog_api.put(
        "/feeds/historical.q_not_here_yet_99/expectation",
        json={"expectedIntervalSeconds": 3600},
        cookies={"session": "s"},
    )

    assert response.status_code == 204


def test_an_unauthenticated_caller_cannot_declare_an_expectation(catalog_api: TestClient) -> None:
    response = catalog_api.put(f"/feeds/{RAIL_TABLE}/expectation", json={"expectedIntervalSeconds": 3600})

    assert response.status_code == 401

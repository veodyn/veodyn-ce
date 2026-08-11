"""The Data Catalog endpoint: the wire contract, and what it refuses to invent.

The shape asserted here is app/src/types/catalog.ts. Assertions are on
exact JSON keys rather than on the pydantic models, because the camelCase
aliases (and `schema`, which pydantic cannot name directly) are the part the
frontend actually depends on.

ClickHouse is stubbed at the HTTP layer: the warehouse answers `FORMAT JSON`, so
a response is `{"data": [...]}` and the statement is whatever this service sent.
"""

import json
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.conftest import REDASH_TEST_URL, session_payload

REDASH = REDASH_TEST_URL
WAREHOUSE = "http://clickhouse.test"

USER = session_payload(user_id=7, name="Jane Analyst", email="jane@x.org")

# In the order ClickHouse returns them: the registry read is ORDER BY
# query_name, so the stub sorts the way the real table would.
REGISTRY = [
    {
        "query_id": 32,
        "table_name": "historical.q_regional_demo_bikeshare_stations_32",
        "query_name": "Regional Demo - Bikeshare: stations",
    },
    {
        "query_id": 21,
        "table_name": "historical.q_regional_demo_transit_rail_vehicle_positions_21",
        "query_name": "Regional Demo - Transit: rail vehicle positions",
    },
]

RAIL_TABLE = "q_regional_demo_transit_rail_vehicle_positions_21"
BIKE_TABLE = "q_regional_demo_bikeshare_stations_32"


def column(table: str, name: str, type_: str) -> dict[str, str]:
    return {"database": "historical", "table": table, "name": name, "type": type_}


COLUMNS = [
    column(RAIL_TABLE, "captured_at", "DateTime64(3, 'UTC')"),
    column(RAIL_TABLE, "query_id", "UInt32"),
    column(RAIL_TABLE, "vehicle_id", "String"),
    column(BIKE_TABLE, "captured_at", "DateTime64(3, 'UTC')"),
    column(BIKE_TABLE, "bikes", "Int32"),
]

TABLES = [
    {"database": "historical", "name": RAIL_TABLE, "total_rows": 148_233},
    {"database": "historical", "name": BIKE_TABLE, "total_rows": 0},
]


def warehouse_answers(spans: dict[str, dict[str, str]] | None = None) -> None:
    """Route each statement this service sends to the rows it asks for.

    Matching on the statement text keeps the stub honest: a change to what the
    service reads shows up here as an unrouted call rather than as silence.
    """
    spans = spans or {}

    def handler(request: httpx.Request) -> httpx.Response:
        sql = request.content.decode()
        if "_catalog" in sql:
            return httpx.Response(200, json={"data": REGISTRY})
        if "system.columns" in sql:
            return httpx.Response(200, json={"data": COLUMNS})
        if "system.tables" in sql:
            return httpx.Response(200, json={"data": TABLES})
        if "min(captured_at)" in sql:
            for table, span in spans.items():
                if table in sql:
                    return httpx.Response(200, json={"data": [span]})
            return httpx.Response(200, json={"data": [{"start": None, "end": None}]})
        return httpx.Response(500, text=f"unrouted statement: {sql}")

    respx.post(WAREHOUSE).mock(side_effect=handler)


@pytest.fixture
def catalog_api(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("VEODYN_CLICKHOUSE_URL", WAREHOUSE)
    from veodyn_api.settings import get_settings

    get_settings.cache_clear()
    return api


def as_user(payload: dict[str, Any]) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(200, json=payload))


@respx.mock
def test_unauthenticated_callers_get_nothing(catalog_api: TestClient) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(404))
    warehouse_answers()

    response = catalog_api.get("/catalog")

    assert response.status_code == 401
    assert response.json()["error"]["id"] == "VEODYN_UNAUTHENTICATED"


@respx.mock
def test_returns_every_captured_table_in_the_catalog_shape(catalog_api: TestClient) -> None:
    as_user(USER)
    warehouse_answers(
        {
            "positions_21": {"start": "2026-07-01 00:00:00.000", "end": "2026-07-25 11:30:00.000"},
        }
    )

    response = catalog_api.get("/catalog", cookies={"session": "s"})

    assert response.status_code == 200
    datasets = response.json()
    assert [d["id"] for d in datasets] == [
        "q_regional_demo_bikeshare_stations_32",
        "q_regional_demo_transit_rail_vehicle_positions_21",
    ]

    rail = next(d for d in datasets if d["id"].endswith("_21"))
    # Exactly the keys catalog.ts declares, in the spelling it reads.
    assert set(rail) == {
        "id",
        "name",
        "description",
        "domain",
        "schema",
        "freshness",
        "coverage",
        "rowCount",
        "sources",
        "tags",
        "sampleQueryId",
    }
    assert rail["name"] == "Regional Demo - Transit: rail vehicle positions"
    assert rail["rowCount"] == 148_233
    assert rail["sampleQueryId"] == 21
    # No literal any more. Every dataset used to carry "historical", which meant
    # `?tag=historical` selected all of them and discriminated between none. An
    # untagged dataset now says so.
    assert rail["tags"] == []
    assert [c["name"] for c in rail["schema"]] == ["captured_at", "query_id", "vehicle_id"]
    assert rail["coverage"] == {"start": "2026-07-01T00:00:00Z", "end": "2026-07-25T11:30:00Z"}
    assert rail["freshness"]["lastUpdatedAt"] == "2026-07-25T11:30:00Z"


@respx.mock
def test_marks_a_table_stale_once_nothing_new_lands(catalog_api: TestClient) -> None:
    as_user(USER)
    warehouse_answers({"positions_21": {"start": "2020-01-01 00:00:00.000", "end": "2020-01-02 00:00:00.000"}})

    datasets = catalog_api.get("/catalog", cookies={"session": "s"}).json()

    rail = next(d for d in datasets if d["id"].endswith("_21"))
    assert rail["freshness"]["status"] == "stale"


@respx.mock
def test_states_no_coverage_for_a_table_that_has_captured_nothing(catalog_api: TestClient) -> None:
    as_user(USER)
    warehouse_answers()  # every span comes back empty

    datasets = catalog_api.get("/catalog", cookies={"session": "s"}).json()

    bikes = next(d for d in datasets if d["id"].endswith("_32"))
    # Empty rather than a plausible-looking range: the registry row exists from
    # the first capture attempt, so "no rows yet" is a real state to report.
    assert bikes["coverage"] == {"start": "", "end": ""}
    # feedId is known even here, and is deliberately not None. The feed is the
    # scheduled query that owns this table; it is registered from the first
    # capture ATTEMPT, so "which feed fills this" has an answer before "what has
    # it delivered" does. /feeds still leaves this one off the board, because a
    # freshness row with nothing received is not something a reader can act on
    # (services/feeds.py). The two are consistent: a dataset may name a feed the
    # board has nothing to say about yet.
    assert bikes["freshness"] == {
        "lastUpdatedAt": "",
        "status": "stale",
        "feedId": "q_regional_demo_bikeshare_stations_32",
    }
    assert bikes["rowCount"] == 0


@respx.mock
def test_filters_on_the_q_the_catalog_page_sends(catalog_api: TestClient) -> None:
    as_user(USER)
    warehouse_answers()

    datasets = catalog_api.get("/catalog", params={"q": "bikeshare"}, cookies={"session": "s"}).json()

    assert [d["id"] for d in datasets] == ["q_regional_demo_bikeshare_stations_32"]


@respx.mock
def test_says_so_when_no_warehouse_is_configured(api: TestClient) -> None:
    as_user(USER)

    response = api.get("/catalog", cookies={"session": "s"})

    assert response.status_code == 503
    assert response.json()["error"]["id"] == "VEODYN_WAREHOUSE_NOT_CONFIGURED"


@respx.mock
def test_reports_an_unreachable_warehouse_as_a_named_cause(catalog_api: TestClient) -> None:
    as_user(USER)
    respx.post(WAREHOUSE).mock(side_effect=httpx.ConnectError("refused"))

    response = catalog_api.get("/catalog", cookies={"session": "s"})

    assert response.status_code == 502
    assert response.json()["error"]["id"] == "VEODYN_WAREHOUSE_UNREACHABLE"


@respx.mock
def test_never_names_a_table_it_cannot_verify(catalog_api: TestClient) -> None:
    """A registry row is data, and the one statement that interpolates a table
    name would carry it straight into SQL. Anything that is not a plain
    identifier is dropped rather than sent."""
    as_user(USER)

    def handler(request: httpx.Request) -> httpx.Response:
        sql = request.content.decode()
        if "_catalog" in sql:
            registry = [{"query_id": 1, "table_name": "historical.x; DROP TABLE y", "query_name": "bad"}]
            return httpx.Response(200, json={"data": registry})
        return httpx.Response(200, json={"data": []})

    route = respx.post(WAREHOUSE).mock(side_effect=handler)

    assert catalog_api.get("/catalog", cookies={"session": "s"}).json() == []
    statements = [call.request.content.decode() for call in route.calls]
    assert not any("DROP TABLE" in sql for sql in statements)


# What a real ClickHouse 25.3 sends, captured from one rather than invented.
# Two details matter and both were got wrong on the first attempt at these
# tests: the status is 404, and the body is PRETTY-PRINTED JSON whose first
# line is `{`. A compact one-line stub would let the old "read the first line"
# code pass this file while still producing `refused a read: {` in production.
def clickhouse_error(status: int, exception: str) -> httpx.Response:
    body = (
        "{\n"
        '\t"meta":\n\t[\n\n\t],\n\n'
        '\t"data":\n\t[\n\n\t],\n\n'
        '\t"rows": 0,\n\n'
        f'\t"exception": {json.dumps(exception)}\n'
        "}\n"
    )
    return httpx.Response(status, text=body, headers={"content-type": "application/json"})


# Redash creates historical._catalog on its first capture, so until then the
# table does not exist. This is the state a freshly installed community stack
# is in, and ClickHouse's code for it is 60, UNKNOWN_TABLE.
UNKNOWN_TABLE = (
    "Code: 60. DB::Exception: Unknown table expression identifier "
    "'historical._catalog' in scope SELECT query_id, table_name, query_name "
    "FROM historical._catalog. (UNKNOWN_TABLE) (version 25.3.14.14 (official build))"
)
MEMORY_LIMIT = "Code: 241. DB::Exception: Memory limit exceeded. (MEMORY_LIMIT_EXCEEDED) (version 25.3.14.14)"


@respx.mock
def test_the_error_stub_is_the_shape_clickhouse_really_sends(catalog_api: TestClient) -> None:
    """The control on the three tests below, because all of them are only worth
    anything if the body they feed is the awkward one. If this stub ever became
    single-line JSON, the "read the first line" bug would pass every one of
    them."""
    response = clickhouse_error(404, UNKNOWN_TABLE)

    assert response.status_code == 404
    assert response.text.splitlines()[0] == "{"
    assert len(response.text.splitlines()) > 1
    assert response.json()["exception"] == UNKNOWN_TABLE


@respx.mock
def test_a_warehouse_with_nothing_captured_yet_is_an_empty_catalog(catalog_api: TestClient) -> None:
    as_user(USER)
    respx.post(WAREHOUSE).mock(return_value=clickhouse_error(404, UNKNOWN_TABLE))

    response = catalog_api.get("/catalog", cookies={"session": "s"})

    assert response.status_code == 200
    assert response.json() == []


@respx.mock
def test_a_warehouse_that_refuses_for_any_other_reason_is_still_an_error(catalog_api: TestClient) -> None:
    """The control on the test above. Swallowing UNKNOWN_TABLE is only safe if
    every other refusal still surfaces, so this asserts the one next to it: a
    real failure must not be reported as an empty catalog."""
    as_user(USER)
    respx.post(WAREHOUSE).mock(return_value=clickhouse_error(500, MEMORY_LIMIT))

    response = catalog_api.get("/catalog", cookies={"session": "s"})

    assert response.status_code == 502
    assert response.json()["error"]["id"] == "VEODYN_WAREHOUSE_UNREACHABLE"


@respx.mock
def test_a_refusal_names_the_reason_rather_than_the_first_byte_of_the_body(catalog_api: TestClient) -> None:
    """Every statement this client sends ends `FORMAT JSON`, so a ClickHouse
    failure arrives as a JSON document whose first line is `{`. Reading the
    first line, which is what this used to do, made every warehouse refusal
    report itself as `refused a read: {` and told an operator nothing."""
    as_user(USER)
    respx.post(WAREHOUSE).mock(return_value=clickhouse_error(500, MEMORY_LIMIT))

    message = catalog_api.get("/catalog", cookies={"session": "s"}).json()["error"]["message"]

    assert "Memory limit exceeded" in message
    assert not message.endswith("{")


@respx.mock
def test_a_non_json_refusal_still_names_something(catalog_api: TestClient) -> None:
    """A proxy or an ingress in front of ClickHouse answers with neither shape,
    so the plain-text path has to keep working."""
    as_user(USER)
    respx.post(WAREHOUSE).mock(return_value=httpx.Response(502, text="upstream connect error\nstack frame"))

    message = catalog_api.get("/catalog", cookies={"session": "s"}).json()["error"]["message"]

    assert "upstream connect error" in message
    assert "stack frame" not in message

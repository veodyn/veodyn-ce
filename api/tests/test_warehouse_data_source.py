"""Which Redash data source a generated warehouse query is bound to.

The bug this covers shipped twice from the same mistake. A generated query reads
the historical warehouse, so it has to run on the Redash data source that speaks
ClickHouse. Both writers instead bound it to the data source of the query the
capture came FROM, which on every real deployment is the API connector that
ingests the feed. Those runners parse query text as JSON, so the generated SQL
came back as

    VEODYN_QUERY_EXECUTION_FAILED: Invalid query JSON: Expecting value: line 1 column 1

and no capture-feed KPI could evaluate anywhere.

Neither writer had a test that ran what it built, and both had a test asserting
the wrong id flowed through, so the defect was blessed rather than missed.
"""

import httpx
import pytest
import respx

from tests.conftest import REDASH_TEST_URL
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash import RedashClient
from veodyn_api.services.redash_lookups import warehouse_data_source_id

REDASH = REDASH_TEST_URL

# A deployment's real shape: the connectors that feed the captures, and the one
# warehouse source the captures land in. Ids are deliberately not adjacent, so a
# test cannot pass by picking the first or the last row.
SOURCES = [
    {"id": 1, "name": "GBFS", "type": "url"},
    {"id": 4, "name": "OpenWeatherMap", "type": "url"},
    {"id": 8, "name": "Historical warehouse", "type": "clickhouse"},
]


@pytest.fixture
def redash():
    client = RedashClient(REDASH)
    yield client
    client.close()


def sources_are(rows):
    respx.get(f"{REDASH}/api/data_sources").mock(return_value=httpx.Response(200, json=rows))


@respx.mock
def test_the_clickhouse_source_is_the_one_picked(redash):
    sources_are(SOURCES)

    assert warehouse_data_source_id(redash, api_key="service") == 8


@respx.mock
def test_a_deployment_with_no_clickhouse_source_is_refused(redash):
    """The refusal a fresh deployment gets, instead of a query nothing can run."""
    sources_are([row for row in SOURCES if row["type"] != "clickhouse"])

    with pytest.raises(ApiError) as refusal:
        warehouse_data_source_id(redash, api_key="service")

    assert refusal.value.error_id == ErrorId.WAREHOUSE_SOURCE_UNRESOLVABLE


@respx.mock
def test_two_clickhouse_sources_are_refused_rather_than_guessed(redash):
    """Picking one would bind half the KPIs on the instance to the wrong warehouse,
    and the wrong one still answers, so it would be found by a number being wrong
    rather than by an error."""
    sources_are([*SOURCES, {"id": 9, "name": "Warehouse replica", "type": "clickhouse"}])

    with pytest.raises(ApiError) as refusal:
        warehouse_data_source_id(redash, api_key="service")

    assert refusal.value.error_id == ErrorId.WAREHOUSE_SOURCE_UNRESOLVABLE


@respx.mock
def test_an_unreachable_redash_refuses_rather_than_binding(redash):
    """`data_source_names` swallows this and labels nothing, which is right for a
    label. Here it must not: a swallowed failure would bind the query to whatever
    the caller passed as a fallback, which is the bug being fixed."""
    respx.get(f"{REDASH}/api/data_sources").mock(return_value=httpx.Response(502))

    with pytest.raises(ApiError):
        warehouse_data_source_id(redash, api_key="service")


@respx.mock
def test_a_row_without_an_integer_id_is_not_a_candidate(redash):
    sources_are([{"id": None, "name": "Broken", "type": "clickhouse"}, *SOURCES])

    assert warehouse_data_source_id(redash, api_key="service") == 8

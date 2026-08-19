"""What data source the feed staleness probe is written against.

`probe_sql` reads `historical.<table>` in the warehouse, so the probe can only
run on the Redash data source that speaks ClickHouse. `arm` used to be handed
the data source of the CAPTURE QUERY instead, which on every deployment here is
the API connector the feed is ingested through, and those runners parse query
text as JSON. The probe was therefore written to a runner that could never
execute it.

The whole file asserts on the OUTBOUND create, for the reason
test_redash_query_writes.py gives: a respx route ignores the body it is sent, so
a probe bound to the wrong data source returns the mocked 200 and leaves a green
suite behind. That is how this shipped.
"""

import json

import httpx
import pytest
import respx

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services import feed_alert
from veodyn_api.services.redash import RedashClient

REDASH = "http://redash.test"

GBFS_CONNECTOR = {"id": 1, "name": "GBFS", "type": "url"}
WAREHOUSE = {"id": 8, "name": "Historical", "type": "clickhouse"}


@pytest.fixture
def client() -> RedashClient:
    return RedashClient(REDASH)


def redash_has(sources: list[dict[str, object]]) -> respx.Route:
    respx.get(f"{REDASH}/api/data_sources").mock(return_value=httpx.Response(200, json=sources))
    respx.post(f"{REDASH}/api/alerts").mock(return_value=httpx.Response(200, json={"id": 77}))
    return respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json={"id": 41}))


def arm(client: RedashClient) -> tuple[int, int]:
    return feed_alert.arm(
        client,
        feed_id="q_bike_share_stations_1",
        feed_name="Metro stations",
        database="historical",
        table="q_bike_share_stations_1",
        expected_interval_seconds=300,
        api_key="service",
    )


@respx.mock
def test_the_probe_is_bound_to_the_warehouse_not_the_capture_connector(client: RedashClient) -> None:
    """The regression. With the bug in place this asserted 1, the gbfs connector."""
    created = redash_has([GBFS_CONNECTOR, WAREHOUSE])

    query_id, alert_id = arm(client)

    body = json.loads(created.calls.last.request.content)
    assert body["data_source_id"] == WAREHOUSE["id"]
    assert "historical.q_bike_share_stations_1" in body["query"]
    assert (query_id, alert_id) == (41, 77)


@respx.mock
def test_no_warehouse_source_refuses_before_a_probe_is_written(client: RedashClient) -> None:
    """A refusal costs nothing; a probe written to a runner that cannot parse it
    is an orphan query plus an alert that can never fire."""
    created = redash_has([GBFS_CONNECTOR])

    with pytest.raises(ApiError) as refusal:
        arm(client)

    assert refusal.value.error_id == ErrorId.WAREHOUSE_SOURCE_UNRESOLVABLE
    assert not created.called

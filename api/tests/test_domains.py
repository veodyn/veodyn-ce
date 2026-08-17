"""Domain hubs: what a hub is joined from, and whose permissions decide it.

The shape asserted here is DomainHub in app/src/types/catalog.ts.

A hub is not stored. It is Redash's `domain:<key>` tags on queries and
dashboards, the warehouse tables those queries capture into, and whatever a
registered counter provider files under the same key. These tests pin that join,
and that a domain nobody has tagged yet reads as empty rather than as missing.

The provider used to be the KPI one, wired in from this tree. It is a pack's
now, so these register `tests/fixture_objects.py`'s instead. That is the sharper
test of the two: `services/domains.py` must reach the registry rather than any
particular contributor, and a provider it has never heard of is what proves it.
"""

from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import REDASH_TEST_URL, session_payload
from tests.fixture_objects import make_widget, registered_fixture_hub

REDASH = REDASH_TEST_URL
WAREHOUSE = "http://clickhouse.test"
USER = session_payload(user_id=7, name="Jane Analyst", email="jane@x.org")

TRANSIT_TAG = "domain:transit"


@pytest.fixture
def domains_api(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("VEODYN_CLICKHOUSE_URL", WAREHOUSE)
    from veodyn_api.settings import get_settings

    get_settings.cache_clear()
    with registered_fixture_hub():
        yield api


def as_user(payload: dict[str, Any]) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(200, json=payload))


def tagged(queries: list[dict[str, Any]], dashboards: list[dict[str, Any]]) -> None:
    """Redash's tag-filtered lists. Matching on the `tags` param keeps the stub
    honest: asking for a different tag must not silently return these rows."""

    def filtered(rows: list[dict[str, Any]], request: httpx.Request) -> httpx.Response:
        # No tags param at all means no filter, which is how Redash behaves and
        # how domain discovery asks for the whole list.
        wanted = request.url.params.get("tags")
        kept = rows if wanted is None else [r for r in rows if wanted in (r.get("tags") or [])]
        return httpx.Response(200, json={"count": len(kept), "results": kept})

    def query_handler(request: httpx.Request) -> httpx.Response:
        return filtered(queries, request)

    def dashboard_handler(request: httpx.Request) -> httpx.Response:
        return filtered(dashboards, request)

    # url__startswith, not a bare url: respx matches the query string exactly,
    # and these calls carry ?tags=&page_size=.
    respx.get(url__startswith=f"{REDASH}/api/queries").mock(side_effect=query_handler)
    respx.get(url__startswith=f"{REDASH}/api/dashboards").mock(side_effect=dashboard_handler)


def warehouse_catalog(rows: list[dict[str, Any]]) -> None:
    respx.post(WAREHOUSE).mock(return_value=httpx.Response(200, json={"data": rows}))


def filed_under(db: Session, *, object_id: str, name: str, domain: str | None, reading: float | None) -> None:
    """One object the registered provider will find, or leave out if it has no
    reading. Its shape is the provider's business, not the hub's."""
    make_widget(db, object_id=object_id, name=name, domain=domain, reading=reading)


@respx.mock
def test_unauthenticated_callers_get_nothing(domains_api: TestClient) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(404))

    response = domains_api.get("/domains/transit")

    assert response.status_code == 401
    assert response.json()["error"]["id"] == "VEODYN_UNAUTHENTICATED"


@respx.mock
def test_joins_tagged_queries_dashboards_and_counters_into_one_hub(domains_api: TestClient, db: Session) -> None:
    as_user(USER)
    tagged(
        queries=[{"id": 21, "tags": [TRANSIT_TAG]}, {"id": 99, "tags": ["domain:environment"]}],
        dashboards=[{"id": 6, "tags": [TRANSIT_TAG]}],
    )
    warehouse_catalog([{"table_name": "historical.q_rail_vehicle_positions_21"}])
    filed_under(db, object_id="on-time", name="On-Time Performance", domain="transit", reading=82.5)

    response = domains_api.get("/domains/transit", cookies={"session": "s"})

    assert response.status_code == 200
    hub = response.json()
    assert set(hub) == {"key", "label", "icon", "datasetIds", "dashboardIds", "counters"}
    assert hub["key"] == "transit"
    assert hub["label"] == "Transit"
    # The bare table name, matching the ids /catalog emits, because the page
    # resolves these against that list.
    assert hub["datasetIds"] == ["q_rail_vehicle_positions_21"]
    assert hub["dashboardIds"] == [6]
    assert hub["counters"] == [
        {
            "label": "On-Time Performance",
            "value": 82.5,
            "unit": None,
            "delta": None,
            "deltaUnit": None,
            "queryId": None,
            "kpiId": "on-time",
        }
    ]


@respx.mock
def test_leaves_out_an_object_that_has_never_been_evaluated(domains_api: TestClient, db: Session) -> None:
    as_user(USER)
    tagged(queries=[], dashboards=[])
    warehouse_catalog([])
    filed_under(db, object_id="unread", name="Never Evaluated", domain="transit", reading=None)

    hub = domains_api.get("/domains/transit", cookies={"session": "s"}).json()

    # Zero would be a number this service invented. An object with no reading has
    # nothing to show, so it shows nothing.
    assert hub["counters"] == []


@respx.mock
def test_a_domain_nobody_has_tagged_reads_as_empty_not_missing(domains_api: TestClient) -> None:
    as_user(USER)
    tagged(queries=[], dashboards=[])
    warehouse_catalog([])

    response = domains_api.get("/domains/air-quality", cookies={"session": "s"})

    # 404 would claim this is not a domain, and this service has no registry to
    # know that. The tenant's domain list lives in veodyn-de's config.
    assert response.status_code == 200
    hub = response.json()
    assert hub == {
        "key": "air-quality",
        "label": "Air Quality",
        "icon": None,
        "datasetIds": [],
        "dashboardIds": [],
        "counters": [],
    }


@respx.mock
def test_lists_every_domain_anything_is_filed_under(domains_api: TestClient, db: Session) -> None:
    as_user(USER)
    tagged(
        queries=[{"id": 21, "tags": [TRANSIT_TAG, "regional-history"]}],
        dashboards=[{"id": 6, "tags": ["domain:environment"]}],
    )
    warehouse_catalog([])
    filed_under(db, object_id="fleet", name="Fleet", domain="operations", reading=1.0)

    hubs = domains_api.get("/domains", cookies={"session": "s"}).json()

    # Discovered from the tags and from the registered key provider, not from a
    # list that can go stale. Non-domain tags are ignored.
    assert [h["key"] for h in hubs] == ["environment", "operations", "transit"]


@respx.mock
def test_asks_redash_for_the_tag_as_this_caller(domains_api: TestClient) -> None:
    as_user(USER)
    tagged(queries=[], dashboards=[])
    warehouse_catalog([])

    domains_api.get("/domains/transit", headers={"Authorization": "Key user-key"})

    query_calls = [c for c in respx.calls if c.request.url.path == "/api/queries"]
    assert query_calls, "the hub never asked Redash for its tagged queries"
    request = query_calls[0].request
    assert request.url.params.get("tags") == TRANSIT_TAG
    # The caller's own key, so Redash's permissions decide what the hub holds.
    assert request.headers.get("authorization") == "Key user-key"


@respx.mock
def test_discovery_asks_for_everything_rather_than_the_empty_tag(domains_api: TestClient) -> None:
    """Redash reads `tags=` as a filter for a tag equal to the empty string,
    which nothing carries, so sending it discovered no domains at all."""
    as_user(USER)
    tagged(queries=[{"id": 21, "tags": [TRANSIT_TAG]}], dashboards=[])
    warehouse_catalog([])

    hubs = domains_api.get("/domains", cookies={"session": "s"}).json()

    assert [h["key"] for h in hubs] == ["transit"]
    discovery = [c.request for c in respx.calls if c.request.url.path == "/api/queries"][0]
    assert "tags" not in discovery.url.params


@respx.mock
def test_a_hub_on_a_warehouse_with_nothing_captured_is_empty_not_broken(domains_api: TestClient) -> None:
    """A fresh install has no historical._catalog: Redash creates it on its
    first capture. The hub for a tagged query then has no datasets, which is
    what this reads back, rather than a 502 that says the warehouse is down.

    Uses the shape a real ClickHouse 25.3 sends, pretty-printed JSON with the
    code inside an `exception` field, because a compact body would not exercise
    the parsing that makes the distinction possible.
    """
    as_user(USER)
    tagged([{"id": 1, "name": "Rail positions", "tags": [TRANSIT_TAG]}], [])
    body = (
        '{\n\t"meta":\n\t[\n\n\t],\n\n\t"data":\n\t[\n\n\t],\n\n\t"rows": 0,\n\n'
        '\t"exception": "Code: 60. DB::Exception: Unknown table expression identifier '
        "'historical._catalog'. (UNKNOWN_TABLE) (version 25.3.14.14 (official build))\"\n}\n"
    )
    respx.post(WAREHOUSE).mock(
        return_value=httpx.Response(404, text=body, headers={"content-type": "application/json"})
    )

    response = domains_api.get("/domains/transit", cookies={"session": "s"})

    assert response.status_code == 200
    assert response.json()["datasetIds"] == []
    assert response.json()["counters"] == []


@respx.mock
def test_a_hub_on_a_warehouse_with_no_historical_database_is_empty_not_broken(domains_api: TestClient) -> None:
    """One step earlier than the case above: on a stack fresh enough that the
    `historical` database itself has never been created, ClickHouse answers
    UNKNOWN_DATABASE (code 81) rather than UNKNOWN_TABLE (code 60). Splitting
    WarehouseTableMissing into two classes narrowed the except clause this hub
    read used to rely on, so this case regressed to a 502 until the catch here
    was widened back to both.
    """
    as_user(USER)
    tagged([{"id": 1, "name": "Rail positions", "tags": [TRANSIT_TAG]}], [])
    body = (
        '{\n\t"meta":\n\t[\n\n\t],\n\n\t"data":\n\t[\n\n\t],\n\n\t"rows": 0,\n\n'
        '\t"exception": "Code: 81. DB::Exception: Database historical does not exist. '
        '(UNKNOWN_DATABASE) (version 25.3.14.14 (official build))"\n}\n'
    )
    respx.post(WAREHOUSE).mock(
        return_value=httpx.Response(404, text=body, headers={"content-type": "application/json"})
    )

    response = domains_api.get("/domains/transit", cookies={"session": "s"})

    assert response.status_code == 200
    assert response.json()["datasetIds"] == []
    assert response.json()["counters"] == []


@respx.mock
def test_a_hub_still_fails_when_the_warehouse_really_fails(domains_api: TestClient) -> None:
    """The control. Swallowing the missing registry must not swallow a warehouse
    that is genuinely refusing, or a hub would report "no datasets" for a
    domain that has them."""
    as_user(USER)
    tagged([{"id": 1, "name": "Rail positions", "tags": [TRANSIT_TAG]}], [])
    respx.post(WAREHOUSE).mock(side_effect=httpx.ConnectError("refused"))

    response = domains_api.get("/domains/transit", cookies={"session": "s"})

    assert response.status_code == 502
    assert response.json()["error"]["id"] == "VEODYN_WAREHOUSE_UNREACHABLE"


@respx.mock
def test_an_unshadowed_table_keeps_its_own_name(domains_api: TestClient, db: Session) -> None:
    as_user(USER)
    tagged(queries=[{"id": 9, "name": "Trips", "tags": [TRANSIT_TAG]}], dashboards=[])
    warehouse_catalog([{"table_name": "historical.q_trips_9"}])
    body = domains_api.get("/domains/transit", cookies={"session": "s"}).json()
    assert body["datasetIds"] == ["q_trips_9"]


# The shadow-id tests (a single rename, and a chain of renames) live in
# test_domains_shadowing.py: adding the chain test here pushed this file past
# the 300-line block, the same reason test_registry_providers.py split off
# test_dataset_source_registry.py.

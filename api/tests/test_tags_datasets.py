"""Tagging a dataset, which is the odd one of the three.

A dataset has no row in this database at all: its id is a ClickHouse registry
table name, so existence is answered by the registry rather than by a SELECT,
and the tags are the only thing this service stores about it. The warehouse is
stubbed at the HTTP layer the same way test_catalog.py stubs it.
"""

from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.tag_stubs import JANE, JANE_ELSEWHERE, SAM, as_user, auth, put_tags, vocabulary

WAREHOUSE = "http://clickhouse.test"

RAIL_TABLE = "q_regional_demo_transit_rail_vehicle_positions_21"
REGISTRY = [
    {
        "query_id": 21,
        "table_name": f"historical.{RAIL_TABLE}",
        "query_name": "Regional Demo - Transit: rail vehicle positions",
    },
]


def warehouse_answers() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        sql = request.content.decode()
        if "_catalog" in sql:
            return httpx.Response(200, json={"data": REGISTRY})
        if "system.columns" in sql or "system.tables" in sql:
            return httpx.Response(200, json={"data": []})
        if "min(captured_at)" in sql:
            return httpx.Response(200, json={"data": [{"start": None, "end": None}]})
        return httpx.Response(500, text=f"unrouted statement: {sql}")

    respx.post(WAREHOUSE).mock(side_effect=handler)


@pytest.fixture
def catalog_api(api: TestClient, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("VEODYN_CLICKHOUSE_URL", WAREHOUSE)
    from veodyn_api.settings import get_settings

    get_settings.cache_clear()
    return api


def datasets(api: TestClient, cookie: str = "jane") -> list[dict[str, Any]]:
    response = api.get("/catalog", headers=auth(cookie))
    assert response.status_code == 200
    return list(response.json())


@respx.mock
def test_a_dataset_reports_the_tags_it_was_given(catalog_api: TestClient) -> None:
    """The literal "historical" every dataset used to carry is gone, so an
    untagged dataset says so and a tagged one says what it actually is."""
    as_user(JANE)
    warehouse_answers()

    assert [dataset["tags"] for dataset in datasets(catalog_api)] == [[]]

    stored = put_tags(catalog_api, "dataset", RAIL_TABLE, ["Rail", "positions"])

    assert stored.json() == {"tags": ["positions", "rail"]}
    assert [dataset["tags"] for dataset in datasets(catalog_api)] == [["positions", "rail"]]


@respx.mock
def test_a_dataset_the_registry_does_not_list_is_a_404(catalog_api: TestClient) -> None:
    """The tag would be unreadable rather than wrong (dataset tags are joined
    onto the registry), which is exactly why it is refused here instead of
    discovered never."""
    as_user(JANE)
    warehouse_answers()

    refused = put_tags(catalog_api, "dataset", "no_such_table", ["rail"])

    assert refused.status_code == 404
    assert refused.json()["error"]["id"] == "VEODYN_DATASET_NOT_FOUND"
    assert vocabulary(catalog_api) == []


@respx.mock
def test_any_member_of_the_org_may_tag_a_dataset(catalog_api: TestClient) -> None:
    """A dataset has no owner to check against, so tagging shared warehouse
    tables is a curation surface rather than an edit of someone's document."""
    as_user(SAM)
    warehouse_answers()

    assert put_tags(catalog_api, "dataset", RAIL_TABLE, ["rail"], "sam").status_code == 200


@respx.mock
def test_dataset_tags_do_not_cross_orgs(catalog_api: TestClient) -> None:
    """The registry is shared between tenants; the labels on it are not. Both
    orgs see the same dataset, and only the one that tagged it sees the tag."""
    as_user(JANE)
    warehouse_answers()
    put_tags(catalog_api, "dataset", RAIL_TABLE, ["rail"])

    as_user(JANE_ELSEWHERE)
    elsewhere = datasets(catalog_api, "jane-other")

    assert [dataset["id"] for dataset in elsewhere] == [RAIL_TABLE]
    assert [dataset["tags"] for dataset in elsewhere] == [[]]
    assert vocabulary(catalog_api, "jane-other") == []


@respx.mock
def test_a_dataset_tag_counts_in_the_shared_vocabulary(catalog_api: TestClient) -> None:
    """Datasets are in the same union as KPIs and reports, so a tag used on one
    is suggested when tagging the others."""
    as_user(JANE)
    warehouse_answers()

    put_tags(catalog_api, "dataset", RAIL_TABLE, ["rail"])

    assert vocabulary(catalog_api) == [{"name": "rail", "count": 1}]

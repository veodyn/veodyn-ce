"""One registered table shaped differently must not fail the catalog for every
other dataset, and a warehouse that is actually down must still say so.

Both halves matter. The guard added here is narrow on purpose: a blanket catch
would turn an outage into "no coverage yet", which reads as a fresh install.

A second pair of tests covers the other call site the same ruling protects:
capture_sources.py's own catch, which means "nothing has been captured yet,
this is a fresh install" and must keep meaning only that. It swallows a
genuinely missing registry table and a genuinely missing database (both are
still a fresh install) and must NOT start swallowing a table that is merely
missing a column, or a registered table shaped differently would disappear
from the catalog exactly like an empty warehouse.

Round 2 adds three cases a mutation-testing pass found untested: a missing
TABLE (not just a missing column) through catalog.py's own guard, a missing
DATABASE swallowed by capture_sources.py's catch, and the code-47 mapping in
clickhouse.py driven through a real ClickHouse response body rather than
constructed by hand, so deleting that mapping line actually fails a test.
"""

import json
from typing import Any

import httpx
import pytest
import respx

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.registry import DatasetSource
from veodyn_api.services import capture_sources as capture_sources_service
from veodyn_api.services import catalog as catalog_service
from veodyn_api.services.clickhouse import (
    ClickHouseClient,
    WarehouseColumnMissing,
    WarehouseDatabaseMissing,
    WarehouseTableMissing,
)
from veodyn_api.settings import Settings

WAREHOUSE = "http://clickhouse.test"


class Warehouse:
    """Answers the coverage read for one table and refuses it for the other."""

    def __init__(self, failure: Exception) -> None:
        self.failure = failure

    def query(self, statement: str, params: dict[str, str] | None = None) -> list[dict[str, Any]]:
        if "shaped_differently" in statement:
            raise self.failure
        return [{"start": "2026-08-01 00:00:00.000", "end": "2026-08-16 00:00:00.000"}]


def sources() -> list[DatasetSource]:
    return [
        DatasetSource(table="q_trips_9", database="historical", name="Trips"),
        DatasetSource(table="shaped_differently", database="historical", name="Odd one"),
    ]


@pytest.fixture(autouse=True)
def _no_other_warehouse_reads(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(catalog_service, "_columns_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_rows_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service.registry, "dataset_sources", lambda client, database: sources())


def test_a_table_without_captured_at_loses_only_its_own_coverage() -> None:
    warehouse = Warehouse(WarehouseColumnMissing(ErrorId.WAREHOUSE_UNREACHABLE, "no such column", status_code=502))
    datasets = catalog_service.build_catalog(warehouse, database="historical", stale_after_minutes=60)
    assert [dataset.id for dataset in datasets] == ["q_trips_9", "shaped_differently"]
    odd = next(dataset for dataset in datasets if dataset.id == "shaped_differently")
    assert odd.coverage.start == ""
    assert odd.coverage.end == ""
    assert odd.freshness.status == "stale"
    healthy = next(dataset for dataset in datasets if dataset.id == "q_trips_9")
    assert healthy.coverage.end == "2026-08-16T00:00:00Z"


def test_a_missing_table_also_loses_only_its_own_coverage() -> None:
    """The same guard, driven by the other class it has to catch: a table
    gone between the registry read and now, not just a column gone from it."""
    warehouse = Warehouse(WarehouseTableMissing(ErrorId.WAREHOUSE_UNREACHABLE, "no such table", status_code=502))
    datasets = catalog_service.build_catalog(warehouse, database="historical", stale_after_minutes=60)
    assert [dataset.id for dataset in datasets] == ["q_trips_9", "shaped_differently"]
    odd = next(dataset for dataset in datasets if dataset.id == "shaped_differently")
    assert odd.coverage.start == ""
    assert odd.coverage.end == ""
    healthy = next(dataset for dataset in datasets if dataset.id == "q_trips_9")
    assert healthy.coverage.end == "2026-08-16T00:00:00Z"


def test_a_warehouse_outage_is_still_reported() -> None:
    """The failure this catches: a guard wide enough to hide a broken warehouse
    behind an empty coverage window, which looks exactly like a fresh install."""
    warehouse = Warehouse(ApiError(ErrorId.WAREHOUSE_UNREACHABLE, "connection refused", status_code=502))
    with pytest.raises(ApiError):
        catalog_service.build_catalog(warehouse, database="historical", stale_after_minutes=60)


class SingleQueryWarehouse:
    """Refuses the one statement capture_sources.capture_sources sends."""

    def __init__(self, failure: Exception) -> None:
        self.failure = failure

    def query(self, statement: str, params: dict[str, str] | None = None) -> list[dict[str, Any]]:
        raise self.failure


def test_capture_sources_still_swallows_a_genuinely_missing_registry_table() -> None:
    """The fresh-install case this ruling protects: capture_sources' own catch
    must keep working exactly as it did before this change."""
    warehouse = SingleQueryWarehouse(
        WarehouseTableMissing(ErrorId.WAREHOUSE_UNREACHABLE, "no such table", status_code=502)
    )
    assert capture_sources_service.capture_sources(warehouse, "historical") == []


def test_capture_sources_also_swallows_a_genuinely_missing_database() -> None:
    """The other half of a fresh install: a stack new enough that `historical`
    itself has never been created answers UNKNOWN_DATABASE, not UNKNOWN_TABLE,
    and that must read as an empty catalog too, not a 502."""
    warehouse = SingleQueryWarehouse(
        WarehouseDatabaseMissing(ErrorId.WAREHOUSE_UNREACHABLE, "no such database", status_code=502)
    )
    assert capture_sources_service.capture_sources(warehouse, "historical") == []


def test_capture_sources_does_not_swallow_a_missing_column() -> None:
    """The regression this ruling exists to prevent: widening the fresh-install
    catch to a missing column would make a table shaped differently read as an
    empty warehouse, silently. It must still raise."""
    warehouse = SingleQueryWarehouse(
        WarehouseColumnMissing(ErrorId.WAREHOUSE_UNREACHABLE, "no such column", status_code=502)
    )
    with pytest.raises(WarehouseColumnMissing):
        capture_sources_service.capture_sources(warehouse, "historical")


# What a real ClickHouse 25.3 sends for a missing column, captured the same
# way as tests/test_catalog_warehouse_errors.py's UNKNOWN_TABLE body: status
# 404, pretty-printed JSON whose first line is `{`. Constructing
# WarehouseColumnMissing by hand (as every test above does) proves the guard
# catches the class; it does nothing to prove the client ever raises that
# class from a real response, which is the mapping in clickhouse.py this test
# exists to cover.
UNKNOWN_IDENTIFIER_BODY = (
    "Code: 47. DB::Exception: Missing columns: 'captured_at' while processing "
    "query: SELECT min(captured_at), max(captured_at) FROM historical.shaped_differently. "
    "(UNKNOWN_IDENTIFIER) (version 25.3.14.14 (official build))"
)


def _clickhouse_error(exception: str) -> httpx.Response:
    body = (
        "{\n"
        '\t"meta":\n\t[\n\n\t],\n\n'
        '\t"data":\n\t[\n\n\t],\n\n'
        '\t"rows": 0,\n\n'
        f'\t"exception": {json.dumps(exception)}\n'
        "}\n"
    )
    return httpx.Response(404, text=body, headers={"content-type": "application/json"})


@respx.mock
def test_code_47_from_a_real_response_body_raises_column_missing() -> None:
    """Drives an actual ClickHouse error body through ClickHouseClient.query,
    rather than constructing WarehouseColumnMissing directly. Deleting the
    code-47 branch in clickhouse.py's cause selection must fail this test."""
    respx.post(WAREHOUSE).mock(return_value=_clickhouse_error(UNKNOWN_IDENTIFIER_BODY))
    client = ClickHouseClient(Settings(clickhouse_url=WAREHOUSE))

    with pytest.raises(WarehouseColumnMissing):
        client.query("SELECT min(captured_at), max(captured_at) FROM historical.shaped_differently")

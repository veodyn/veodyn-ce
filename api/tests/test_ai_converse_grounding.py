"""The per-kind grounding and its TTL cache.

Tests the module of the same name, split from test_ai_converse_route.py when the
assembly and caching moved out of ai_grounding.py. The route's own gate, caps and
transcript repair are still there; what a kind is ALLOWED to name is here.
"""

from collections.abc import Iterator
from typing import cast

import httpx
import pytest
import respx

from tests.conftest import REDASH_TEST_URL
from tests.converse_stubs import FakeChatLlm, ask, grounding_settings, mock_data_sources, turn
from veodyn_api.schemas.ai_create import CreateKind
from veodyn_api.schemas.catalog import DatasetCoverageOut, DatasetFreshnessOut, DatasetOut
from veodyn_api.services import ai_converse_grounding
from veodyn_api.services.ai_converse_grounding import build_grounding, clear_grounding_cache
from veodyn_api.services.ai_grounding import MAX_GROUNDED_DATASETS
from veodyn_api.services.redash import RedashClient
from veodyn_api.settings import Settings

ALL_KINDS = ("query", "dashboard", "kpi", "report", "snippet")


@pytest.fixture(autouse=True)
def _clear_grounding() -> Iterator[None]:
    clear_grounding_cache()
    yield
    clear_grounding_cache()


def dataset_at(table: str, day: str) -> DatasetOut:
    """A catalog entry that differs only in name and freshness."""
    return DatasetOut(
        id=table,
        name=table,
        description="",
        domain=None,
        schema=[],
        freshness=DatasetFreshnessOut(last_updated_at=f"{day}T00:00:00Z", status="fresh"),
        coverage=DatasetCoverageOut(start="", end=""),
        row_count=1,
        sources=[],
        tags=[],
        sample_query_id=None,
    )


def catalog_settings() -> Settings:
    return Settings(redash_url=REDASH_TEST_URL, ai_max_grounded_queries=60, clickhouse_url="http://clickhouse:8123")


@respx.mock
def test_the_grounding_cache_is_keyed_by_kind() -> None:
    """A single-slot cache would hand the query list to a `query` conversation,
    whose grounding is the warehouse catalog, and do it silently."""
    mock_data_sources((1, "Warehouse"))
    listing = respx.get(f"{REDASH_TEST_URL}/api/queries").mock(
        return_value=httpx.Response(200, json={"results": [{"id": 11, "name": "Speeds", "updated_at": "2026-07-20"}]})
    )
    redash, settings = RedashClient(REDASH_TEST_URL), grounding_settings()

    report = build_grounding("report", redash=redash, api_key="k", settings=settings)
    snippet = build_grounding("snippet", redash=redash, api_key="k", settings=settings)
    again = build_grounding("report", redash=redash, api_key="k", settings=settings)

    assert [one.id for one in report.queries] == [11]
    assert snippet.queries == ()
    # Cached: the second report build did not go back to Redash for the list.
    assert again.queries == report.queries
    assert listing.call_count == 1


def test_every_kind_is_given_the_catalog(monkeypatch: pytest.MonkeyPatch) -> None:
    """Three kinds had no catalog and so could name no table.

    That is why a KPI conversation could only offer the query list, and a report
    section nothing answered became prose. A snippet writes no SQL through the
    generator and still needs the tables: one naming a column that does not exist
    fails the first time somebody expands it.
    """
    catalog = [dataset_at("regional_speeds", "2026-07-27")]
    monkeypatch.setattr(ai_converse_grounding, "build_catalog", lambda *_args, **_kwargs: catalog)
    monkeypatch.setattr(ai_converse_grounding, "get_clickhouse_client", lambda _settings: object())
    monkeypatch.setattr(ai_converse_grounding, "list_queries", lambda *_args, **_kwargs: [])
    settings = catalog_settings()

    tables = {
        name: build_grounding(
            cast(CreateKind, name), redash=RedashClient(REDASH_TEST_URL), api_key="k", settings=settings
        ).datasets
        for name in ALL_KINDS
    }

    assert {name: [one.id for one in datasets] for name, datasets in tables.items()} == {
        name: ["regional_speeds"] for name in tables
    }


def test_the_catalog_is_built_once_for_all_five_kinds(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keyed by kind, giving every kind the catalog would be five full ClickHouse
    introspections per TTL for five identical answers.

    Counted rather than asserted on identity: the cache returning the same tuple
    object would also pass an implementation that rebuilt it and happened to
    memoize elsewhere.
    """
    builds = 0

    def counted(*_args: object, **_kwargs: object) -> list[DatasetOut]:
        nonlocal builds
        builds += 1
        return [dataset_at("regional_speeds", "2026-07-27")]

    monkeypatch.setattr(ai_converse_grounding, "build_catalog", counted)
    monkeypatch.setattr(ai_converse_grounding, "get_clickhouse_client", lambda _settings: object())
    monkeypatch.setattr(ai_converse_grounding, "list_queries", lambda *_args, **_kwargs: [])
    settings = catalog_settings()

    for name in ALL_KINDS:
        build_grounding(cast(CreateKind, name), redash=RedashClient(REDASH_TEST_URL), api_key="k", settings=settings)

    assert builds == 1


@respx.mock
def test_one_kinds_grounding_does_not_reach_another_kinds_prompt() -> None:
    """The cache-level version of this is above. This is the one that matters to
    a reader: the material must not turn up in the other kind's system block."""
    mock_data_sources((1, "Warehouse"))
    respx.get(f"{REDASH_TEST_URL}/api/queries").mock(
        return_value=httpx.Response(
            200, json={"results": [{"id": 11, "name": "Speeds by corridor", "updated_at": "2026-07-20"}]}
        )
    )
    redash, settings = RedashClient(REDASH_TEST_URL), grounding_settings()
    llm = FakeChatLlm(
        {"reply": "a", "suggestedAnswers": [], "ready": False},
        {"reply": "b", "suggestedAnswers": [], "ready": False},
    )

    for name in ("report", "snippet"):
        kind = cast(CreateKind, name)
        ask(llm, turn(kind), build_grounding(kind, redash=redash, api_key="k", settings=settings))

    assert "Speeds by corridor" in llm.systems[0]
    assert "Speeds by corridor" not in llm.systems[1]


def test_the_catalog_grounding_keeps_the_freshest_datasets_and_no_more(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The one grounding list build_catalog does not bound for us.

    An instance capturing two hundred feeds would otherwise build a system
    prompt with no ceiling, and the failure is not a clean one: past the context
    window it comes back as a provider 400 that the relay reports as "AI is
    broken".
    """
    everything = [dataset_at(f"table_{index:03d}", f"2026-07-{index % 28 + 1:02d}") for index in range(120)]
    monkeypatch.setattr(ai_converse_grounding, "build_catalog", lambda *_args, **_kwargs: everything)
    monkeypatch.setattr(ai_converse_grounding, "get_clickhouse_client", lambda _settings: object())
    settings = catalog_settings()

    grounding = build_grounding("query", redash=RedashClient(REDASH_TEST_URL), api_key="k", settings=settings)

    assert len(grounding.datasets) == MAX_GROUNDED_DATASETS
    kept = [dataset.freshness.last_updated_at for dataset in grounding.datasets]
    # Freshest first, and every one kept is at least as fresh as every one
    # dropped. Asserting the count alone would pass an implementation that took
    # an arbitrary 40.
    assert kept == sorted(kept, reverse=True)
    dropped = {dataset.id for dataset in everything} - {dataset.id for dataset in grounding.datasets}
    assert min(kept) >= max(dataset.freshness.last_updated_at for dataset in everything if dataset.id in dropped)

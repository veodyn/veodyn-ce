import time
from dataclasses import dataclass
from typing import Literal

from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.ai_grounding import GroundedQuery, bounded_datasets, list_queries
from veodyn_api.services.catalog import build_catalog
from veodyn_api.services.clickhouse import get_clickhouse_client
from veodyn_api.services.dataset_profile_cache import clear_profile_cache
from veodyn_api.services.redash import RedashClient
from veodyn_api.services.redash_lookups import data_source_names
from veodyn_api.settings import Settings

CreateKind = Literal["query", "dashboard", "kpi", "report", "snippet", "message"]

GROUNDING_TTL_SECONDS = 300


@dataclass(frozen=True)
class Grounding:
    kind: CreateKind
    queries: tuple[GroundedQuery, ...] = ()
    datasets: tuple[DatasetOut, ...] = ()


_grounding_cache: dict[str, tuple[float, Grounding]] = {}

_catalog_cache: tuple[float, tuple[DatasetOut, ...]] | None = None


def clear_grounding_cache() -> None:
    global _catalog_cache
    _grounding_cache.clear()
    _catalog_cache = None
    clear_profile_cache()


def _cached_catalog(settings: Settings) -> tuple[DatasetOut, ...]:
    global _catalog_cache
    if not settings.clickhouse_url:
        return ()
    now = time.monotonic()
    if _catalog_cache is not None and now - _catalog_cache[0] < GROUNDING_TTL_SECONDS:
        return _catalog_cache[1]
    datasets = bounded_datasets(
        build_catalog(
            get_clickhouse_client(settings),
            database=settings.clickhouse_database,
            stale_after_minutes=settings.catalog_stale_after_minutes,
        )
    )
    _catalog_cache = (now, datasets)
    return datasets


def build_grounding(kind: CreateKind, *, redash: RedashClient, api_key: str, settings: Settings) -> Grounding:
    cached = _grounding_cache.get(kind)
    now = time.monotonic()
    if cached is not None and now - cached[0] < GROUNDING_TTL_SECONDS:
        return cached[1]

    queries: tuple[GroundedQuery, ...] = ()
    datasets = _cached_catalog(settings)
    if kind in ("dashboard", "kpi", "report"):
        sources = data_source_names(redash, api_key=api_key)
        queries = tuple(list_queries(redash, api_key, settings.ai_max_grounded_queries, sources))

    grounding = Grounding(kind=kind, queries=queries, datasets=datasets)
    _grounding_cache[kind] = (now, grounding)
    return grounding

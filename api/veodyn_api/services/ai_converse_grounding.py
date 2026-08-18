"""Everything one Create-with-AI kind may name, assembled and cached.

The model chooses FROM these lists and the caller checks its choice against the
same list, so a bad generation can only point at the wrong real thing.
"""

import time
from dataclasses import dataclass, replace

from veodyn_api.schemas.ai_create import CreateKind
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.ai_grounding import DashboardWidget, GroundedQuery, bounded_datasets, list_queries
from veodyn_api.services.catalog import build_catalog
from veodyn_api.services.clickhouse import get_clickhouse_client
from veodyn_api.services.dataset_profile_cache import clear_profile_cache
from veodyn_api.services.redash import RedashClient
from veodyn_api.services.redash_lookups import data_source_names
from veodyn_api.settings import Settings

# Long enough that one conversation reuses a single build, short enough that a
# query published mid-chat lands in the next conversation.
GROUNDING_TTL_SECONDS = 300


@dataclass(frozen=True)
class Grounding:
    """Everything one Create-with-AI kind may name, per spec section 5."""

    kind: CreateKind
    queries: tuple[GroundedQuery, ...] = ()
    datasets: tuple[DatasetOut, ...] = ()


# One build per kind, not one per caller: the same instance-level material for
# everyone.
_grounding_cache: dict[str, tuple[float, Grounding]] = {}

# NOT keyed by kind: every kind gets the same catalog, so keying it would be one
# full ClickHouse introspection per kind per TTL for identical answers.
_catalog_cache: tuple[float, tuple[DatasetOut, ...]] | None = None


def clear_grounding_cache() -> None:
    """Test seam, like routers.ai.clear_digest_cache.

    Clears the catalog and the per-table profiles with it, or a test installing a
    second warehouse fake would be answered from the first one's reads.
    """
    global _catalog_cache
    _grounding_cache.clear()
    _catalog_cache = None
    clear_profile_cache()


def _cached_catalog(settings: Settings) -> tuple[DatasetOut, ...]:
    """The bounded warehouse catalog, built at most once per TTL."""
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
    """The real objects a kind may be built from, cached behind a TTL.

    Every kind gets the catalog. The query list varies by kind, so the cache is
    keyed by kind: a `query` conversation must not be shown one.
    """
    cached = _grounding_cache.get(kind)
    now = time.monotonic()
    if cached is not None and now - cached[0] < GROUNDING_TTL_SECONDS:
        return cached[1]

    queries: tuple[GroundedQuery, ...] = ()
    datasets = _cached_catalog(settings)
    if kind in ("dashboard", "kpi", "report"):
        # Labelled with what each one reads, or the model cannot tell that two
        # queries run against different systems.
        sources = data_source_names(redash, api_key=api_key)
        queries = tuple(list_queries(redash, api_key, settings.ai_max_grounded_queries, sources))

    grounding = Grounding(kind=kind, queries=queries, datasets=datasets)
    _grounding_cache[kind] = (now, grounding)
    return grounding


def with_widget_queries(grounding: Grounding, editing: tuple[DashboardWidget, ...]) -> Grounding:
    """The grounding plus the queries the dashboard being edited already shows.

    build_grounding lists published queries capped at `ai_max_grounded_queries`,
    so a widget's query can be a draft or too old to be in it while EDIT_RULES
    still requires the widget be kept.

    Returns a NEW Grounding rather than mutating: build_grounding's instance is
    shared by every conversation of this kind until its TTL runs out.
    """
    if not editing:
        return grounding
    known = {query.id for query in grounding.queries}
    # By query id: two widgets over the same query are one entry.
    unlisted = {widget.query_id: widget for widget in editing if widget.query_id not in known}
    if not unlisted:
        return grounding
    # Only the id and the name are recoverable from a widget, which is what
    # as_prompt_row leans on anyway.
    extra = tuple(
        GroundedQuery(id=widget.query_id, name=widget.query_name, description="", tags=[], updated_at="")
        for widget in unlisted.values()
    )
    # Ahead of the rest: an edit is certain to need these, and they carry no
    # `updated_at` to be ordered by.
    return replace(grounding, queries=extra + grounding.queries)

"""Everything one Create-with-AI kind may name, assembled and cached.

Split from ai_grounding.py, which is now the Redash and warehouse lookups
themselves. Those are stateless calls any AI route makes. This is the per-kind
assembly of them plus the TTL cache that keeps a twelve-turn conversation from
rebuilding the same lists twelve times, which is a different concern and the only
one with process state in it.

The rule both halves serve is unchanged: the model chooses FROM these lists, and
the caller checks its choice against the same list, so the worst a bad generation
can do is point at the wrong real thing rather than at something that does not
exist.
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

# A Create-with-AI chat sends one request per TURN, and rebuilding the catalog
# on each of them is a wait the analyst sits through twelve times over. Five
# minutes is long enough that one conversation reuses a single build, short
# enough that a query published while someone is chatting is in the next
# conversation rather than the next deploy. Not a setting: there is no operator
# judgement in it that the digest's own knob does not already cover.
GROUNDING_TTL_SECONDS = 300


@dataclass(frozen=True)
class Grounding:
    """Everything one Create-with-AI kind may name, per spec section 5."""

    kind: CreateKind
    queries: tuple[GroundedQuery, ...] = ()
    datasets: tuple[DatasetOut, ...] = ()


# One build per kind, not one per caller: this is the same instance-level
# material for everyone, exactly like routers.ai._digest_cache.
_grounding_cache: dict[str, tuple[float, Grounding]] = {}

# The catalog is cached apart from the per-kind entries above, and is NOT keyed by
# kind. Every kind is now given it, and keyed by kind this would be one full
# ClickHouse introspection per kind per TTL for five identical answers. The query
# list stays inside the per-kind entry, because `ai_max_grounded_queries` is the
# only thing that bounds it and a kind that wanted a different bound would need
# its own entry.
_catalog_cache: tuple[float, tuple[DatasetOut, ...]] | None = None


def clear_grounding_cache() -> None:
    """Test seam, like routers.ai.clear_digest_cache.

    Clears the catalog and the per-table profiles with it. A test that seeds one
    catalog and then asks for a second kind must not be served the first one's
    tables out of a cache it thought it had emptied, and the same is true one
    level down: a profile outlives this call by five minutes, so a test that
    installs a second warehouse fake would be answered from the first one's
    reads and might never call it at all.
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

    Every kind gets the catalog now, because every kind that proposes something
    can need a query the instance does not have and a real table to name for it.
    Snippet is the one that writes no SQL through the generator, and it needs the
    tables anyway: a snippet naming a column that does not exist is one that
    fails the first time somebody expands it.

    The query list is the half that still varies by kind. A `query` conversation
    has no use for it, since it is building the thing that would go in it. The
    other four point at or assemble existing queries, so serving one kind's entry
    to another would put a list in front of a model that was not asked to choose
    from one, and would do it silently.
    """
    cached = _grounding_cache.get(kind)
    now = time.monotonic()
    if cached is not None and now - cached[0] < GROUNDING_TTL_SECONDS:
        return cached[1]

    queries: tuple[GroundedQuery, ...] = ()
    datasets = _cached_catalog(settings)
    if kind in ("dashboard", "kpi", "report"):
        # Labelled with what each one reads. One extra Redash call per kind per
        # TTL, and without it the model is shown a list of queries with no way
        # to tell that two of them run against different systems.
        sources = data_source_names(redash, api_key=api_key)
        queries = tuple(list_queries(redash, api_key, settings.ai_max_grounded_queries, sources))

    grounding = Grounding(kind=kind, queries=queries, datasets=datasets)
    _grounding_cache[kind] = (now, grounding)
    return grounding


def with_widget_queries(grounding: Grounding, editing: tuple[DashboardWidget, ...]) -> Grounding:
    """The grounding plus the queries the dashboard being edited already shows.

    build_grounding lists PUBLISHED queries, newest first, capped at
    `ai_max_grounded_queries`. A widget already on the dashboard can sit outside
    that list on either count: its query may be a draft, or simply older than the
    newest sixty. Meanwhile the edit block names that widget and EDIT_RULES tells
    the model to keep every widget the user did not ask about. Leaving its query
    off the list the model may choose from therefore demands a proposal that is
    rejected for obeying the rules it was given, which is what reached the
    analyst as "I could not resolve query 50".

    Returns a NEW Grounding rather than mutating: the instance build_grounding
    hands back is shared by every conversation of this kind until its TTL runs
    out, so appending one dashboard's queries to it would silently ground the
    next unrelated chat on them.
    """
    if not editing:
        return grounding
    known = {query.id for query in grounding.queries}
    # By query id, because two widgets over the same query are one entry in a
    # list of queries the model may name.
    unlisted = {widget.query_id: widget for widget in editing if widget.query_id not in known}
    if not unlisted:
        return grounding
    # Only the id and the name are recoverable from a widget. That is what
    # as_prompt_row leans on anyway, and the alternative is one extra Redash
    # round trip per widget on every turn of the conversation.
    extra = tuple(
        GroundedQuery(id=widget.query_id, name=widget.query_name, description="", tags=[], updated_at="")
        for widget in unlisted.values()
    )
    # Ahead of the rest: these are the queries an edit is certain to need, and
    # they carry no `updated_at` to be ordered by.
    return replace(grounding, queries=extra + grounding.queries)

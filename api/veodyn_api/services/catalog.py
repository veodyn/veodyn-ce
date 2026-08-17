"""The Data Catalog, assembled from every registered dataset source.

A dataset is a row from `registry.dataset_sources`: the warehouse registry
(services/capture_sources.py, reading `historical._catalog`,
node/redash/historical/catalog.py) is one provider among however many are
registered, not the only way a dataset can exist. This module's job is to take
whatever the registry hands back and fill in the rest from ClickHouse's own
`system` tables, wherever a provider left it unsaid:

    dataset_sources()   -> id, name, database/table, origin, writability, and
                            whatever else a provider already knows
    system.tables        -> row count, when a provider does not supply its own
    system.columns        -> the schema
    min/max captured_at  -> coverage, and how fresh it is

A capture's description, row count, origin and writability come from the
defaults on DatasetSource; a contributed dataset supplies its own. Nothing is
invented on top of what a provider states or ClickHouse reports: a dataset
with no rows reports no coverage rather than a plausible range, and `domain`
is null because nothing here has a notion of one.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from veodyn_api import registry
from veodyn_api.registry import DatasetSource
from veodyn_api.schemas.catalog import (
    DatasetColumnOut,
    DatasetCoverageOut,
    DatasetFreshnessOut,
    DatasetOut,
)
from veodyn_api.services.capture_sources import iso_utc
from veodyn_api.services.clickhouse import ClickHouseClient, WarehouseColumnMissing, WarehouseTableMissing


def _columns_by_table(client: ClickHouseClient, databases: set[str]) -> dict[str, list[dict[str, Any]]]:
    if not databases:
        return {}
    rows = client.query(
        "SELECT database, table, name, type "
        "FROM system.columns "
        "WHERE database IN {databases:Array(String)} "
        "ORDER BY position",
        {"databases": "['" + "','".join(sorted(databases)) + "']"},
    )
    by_table: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        key = f"{row.get('database')}.{row.get('table')}"
        by_table.setdefault(key, []).append(row)
    return by_table


def _rows_by_table(client: ClickHouseClient, databases: set[str]) -> dict[str, int]:
    if not databases:
        return {}
    rows = client.query(
        "SELECT database, name, total_rows FROM system.tables WHERE database IN {databases:Array(String)}",
        {"databases": "['" + "','".join(sorted(databases)) + "']"},
    )
    return {f"{row.get('database')}.{row.get('name')}": int(row.get("total_rows") or 0) for row in rows}


def _span(client: ClickHouseClient, entry: DatasetSource) -> tuple[str | None, str | None]:
    """Earliest and latest capture in one table.

    One statement per table: ClickHouse reads min/max off the primary index
    (the tables are ORDER BY captured_at), so this does not scan the data.
    """
    rows = client.query(
        f"SELECT min(captured_at) AS start, max(captured_at) AS end FROM {entry.database}.{entry.table}"
    )
    if not rows:
        return None, None
    return iso_utc(rows[0].get("start")), iso_utc(rows[0].get("end"))


# Both are written by the capture rather than by the query, and captured_at is
# the column every time filter and every dedup over this table is written
# against. The old wording ("Added by the capture, not by the query") read as
# "ignore this", which is how an AI-written query ended up averaging across
# every snapshot ever taken.
CAPTURE_COLUMN_ABOUT = {
    "captured_at": "The capture timestamp: one distinct value per scheduled run of the source query.",
    "query_id": "The Redash query this capture came from. Constant within one table.",
}


def _column_out(row: dict[str, Any]) -> DatasetColumnOut:
    name = str(row.get("name") or "")
    return DatasetColumnOut(name=name, type=str(row.get("type") or ""), description=CAPTURE_COLUMN_ABOUT.get(name))


def _describe(entry: DatasetSource, row_count: int) -> str:
    """Says where the data came from and nothing more. Every claim here is one
    the source actually makes; there is no summary of what the data means,
    because the warehouse does not know.

    A provider that knows better supplies its own sentence. Without this branch
    a hand-typed dataset is described as captured from a Redash query, which is
    a false statement about provenance rather than a cosmetic one.

    That branch was not enough on its own. A provider supplies a description it
    holds, and a managed dataset declared without one holds the empty string,
    which is falsy: the first managed dataset on the stage instance therefore
    read "Captured from Redash on every scheduled run" on its own page. The
    origin, not the presence of a description, is what settles whether a
    capture sentence may be written at all.
    """
    if entry.description:
        return entry.description
    if entry.origin != "capture":
        # Nothing truthful left to say about provenance: this provider knows
        # where the rows come from and chose to say nothing. A row count is
        # the one claim still supported, and it is already on the page beside
        # this, so an empty description is the honest answer.
        return ""
    captured = f"Captured from Redash query {entry.query_id}" if entry.query_id else "Captured from Redash"
    return f"{captured} on every scheduled run. {row_count:,} rows so far."


def _matches(entry: DatasetSource, needle: str) -> bool:
    return needle in entry.name.lower() or needle in entry.table.lower()


def dataset_ids(client: ClickHouseClient, default_database: str) -> set[str]:
    """Every dataset id any provider lists.

    A dataset has no row of its own anywhere: its id is a table name. So "does
    this dataset exist" is answered by asking every registered source, which for
    a community build is one small registry table this service already reads on
    every catalog request. Exposed so the tag endpoint can refuse to hang a label
    on a table nobody captured or declared, rather than storing a row that will
    never be read back.

    Shadowing is applied here for the same reason build_catalog applies it: a
    shadowed source's raw table name (the renamed physical table, before a pack
    put a view in its place) never appears in a catalog response, so accepting
    it as a tag target would store a label that can never be read back either.
    """
    return {source.table for source in apply_shadowing(list(registry.dataset_sources(client, default_database)))}


def apply_shadowing(sources: list[DatasetSource]) -> list[DatasetSource]:
    """Drop every source another source has taken the place of.

    A pack shadows a captured dataset by renaming its table and creating a view
    under the original name. The warehouse registry knows nothing about that: it
    still returns a row, now naming the renamed table. Listing both would put
    the same dataset in the catalog twice, under two ids, and the frontend
    resolves a dataset by matching the id exactly.

    Shadowing a name nobody registered is a no-op rather than an error, because
    a declaration is a state machine and the rename may not have run yet.
    """
    shadowed = {source.shadows for source in sources if source.shadows}
    return [source for source in sources if source.table not in shadowed]


def build_catalog(
    client: ClickHouseClient,
    *,
    database: str,
    stale_after_minutes: int,
    q: str | None = None,
    now: datetime | None = None,
    tags: dict[str, list[str]] | None = None,
) -> list[DatasetOut]:
    sources = apply_shadowing(list(registry.dataset_sources(client, database)))
    needle = (q or "").strip().lower()
    if needle:
        sources = [source for source in sources if _matches(source, needle)]
    if not sources:
        return []

    # After shadowing, not before: a shadowed source can be the only reason a
    # database is in this set, and reading system.columns for a database no
    # surviving dataset lives in is a wasted round trip on every catalog request.
    databases = {source.database for source in sources}
    columns = _columns_by_table(client, databases)
    row_counts = _rows_by_table(client, databases)
    moment = now or datetime.now(UTC)
    stale_before = moment - timedelta(minutes=stale_after_minutes)

    datasets = []
    for source in sources:
        key = f"{source.database}.{source.table}"
        try:
            start, end = _span(client, source)
        except (WarehouseTableMissing, WarehouseColumnMissing):
            # This one table is shaped differently: no `captured_at`, or gone
            # between the registry read and now. Its own coverage is unknown
            # and every other dataset in this response is unaffected. Before
            # this guard, one such row answered 502 for the whole catalog,
            # and for /feeds and /domains with it, because they are built on
            # this.
            #
            # Narrow on purpose. Any other refusal, including a warehouse
            # that is simply down, still raises: rendering an outage as "no
            # coverage yet" would be indistinguishable from a fresh install.
            #
            # WarehouseDatabaseMissing is deliberately absent from this catch,
            # unlike in capture_sources.py. There, an absent `historical`
            # database is a fresh install and belongs with a missing table.
            # Here, a source already came out of the registry naming a
            # database, so that database not existing means the provider
            # named one wrong: a deployment fault to surface, not a shape
            # this one dataset happens to have.
            start, end = None, None
        # No rows yet means no coverage to state. The registry row exists from
        # the first capture attempt, so an empty table is a real state.
        last_seen = end or ""
        fresh = end is not None and datetime.fromisoformat(end.replace("Z", "+00:00")) >= stale_before
        # A provider serving a view has to answer this itself: a view stores no
        # rows, so system.tables reports null and the coercion below reads 0.
        row_count = source.row_count if source.row_count is not None else row_counts.get(key, 0)
        datasets.append(
            DatasetOut(
                id=source.table,
                name=source.name,
                description=_describe(source, row_count),
                domain=None,
                schema=[_column_out(row) for row in columns.get(key, [])],
                freshness=DatasetFreshnessOut(
                    last_updated_at=last_seen,
                    status="fresh" if fresh else "stale",
                    # The feed that fills this table, which IS this table: one
                    # query captures into exactly one table, so the dataset and
                    # the feed share an id (services/feeds.py). Declared on the
                    # contract from the start and left null until now, which
                    # left Feed Health's Datasets column reading 0 on every row
                    # even once the feeds themselves resolved.
                    #
                    # None for anything that is not a capture: build_feeds
                    # deliberately excludes a contributed dataset (it has no
                    # cadence and nothing feeds it), so naming one here would
                    # advertise a feed link that resolves to nothing.
                    feed_id=source.table if source.origin == "capture" else None,
                ),
                coverage=DatasetCoverageOut(start=start or "", end=end or ""),
                row_count=row_count,
                sources=[source.query_name] if source.query_name else [],
                # Whatever the org has actually tagged this table with, and
                # nothing else. Every dataset used to carry a literal
                # "historical", which could not discriminate between them: a
                # `?tag=historical` filter just meant "every dataset".
                tags=(tags or {}).get(source.table, []),
                sample_query_id=source.query_id or None,
                origin=source.origin,
                writable=source.writable,
            )
        )
    return datasets

"""The Data Catalog, read out of the historical warehouse.

Redash captures each scheduled query's result set into its own ClickHouse table
and registers it in `historical._catalog` (node/redash/historical/catalog.py).
That registry plus ClickHouse's own `system` tables is everything a catalog
entry needs, so nothing is stored twice and nothing has to be kept in sync:

    _catalog          -> which query a table came from, and its name
    system.tables     -> row count
    system.columns    -> the schema
    min/max captured_at -> coverage, and how fresh it is

Every field the contract asks for is derived from one of those. Nothing is
invented: a dataset with no rows reports no coverage rather than a plausible
range, and `domain` is null because the warehouse has no notion of one.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from veodyn_api.schemas.catalog import (
    DatasetColumnOut,
    DatasetCoverageOut,
    DatasetFreshnessOut,
    DatasetOut,
)
from veodyn_api.services.clickhouse import ClickHouseClient, WarehouseTableMissing


@dataclass(frozen=True)
class _Entry:
    query_id: int
    table: str
    query_name: str
    database: str
    name: str


def _split(qualified: str, default_database: str) -> tuple[str, str]:
    database, _, table = qualified.partition(".")
    return (database, table) if table else (default_database, qualified)


# ClickHouse cannot bind an identifier as a query parameter, so the one
# statement that names a table interpolates it. Registered names are generated
# by slugify_query_name, which cannot produce anything else; a row that does not
# match is not a table this service will name in a statement.
def is_identifier(value: str) -> bool:
    return (
        bool(value)
        and (value[0].isalpha() or value[0] == "_")
        and all(char.isalnum() or char == "_" for char in value)
    )


def _iso(value: Any) -> str | None:
    """ClickHouse DateTime64 arrives as 'YYYY-MM-DD HH:MM:SS.mmm'. The contract
    wants ISO 8601, and the column is declared UTC, so it is stamped as UTC."""
    if not value:
        return None
    text = str(value).strip()
    if not text or text.startswith("1970-01-01 00:00:00"):
        return None  # ClickHouse's zero value for an empty min()/max()
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _entries(client: ClickHouseClient, default_database: str) -> list[_Entry]:
    """The registry, or nothing when the registry table does not exist yet.

    Redash creates `historical._catalog` the first time it captures a result,
    so on a fresh install the table is genuinely absent and ClickHouse answers
    UNKNOWN_TABLE. Until this was handled, /catalog, /domains and /feeds all
    answered 502 on a stack that had just come up, which reads to a new user as
    "the catalog service is broken" when the true answer is "nothing has been
    captured yet". An empty warehouse is an empty catalog, not a failure.

    Narrow on purpose: only the warehouse saying the table is not there is
    swallowed. Any other refusal, and any connection failure, still raises, so
    a warehouse that is genuinely broken is still reported as broken.
    """
    try:
        rows = client.query(
            "SELECT query_id, table_name, query_name FROM historical._catalog FINAL ORDER BY query_name, query_id"
        )
    except WarehouseTableMissing:
        return []
    entries = []
    for row in rows:
        database, table = _split(str(row.get("table_name", "")), default_database)
        if not is_identifier(table) or not is_identifier(database):
            continue
        entries.append(
            _Entry(
                query_id=int(row.get("query_id") or 0),
                table=table,
                query_name=str(row.get("query_name") or "").strip(),
                database=database,
                name=str(row.get("query_name") or "").strip() or table,
            )
        )
    return entries


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


def _span(client: ClickHouseClient, entry: _Entry) -> tuple[str | None, str | None]:
    """Earliest and latest capture in one table.

    One statement per table: ClickHouse reads min/max off the primary index
    (the tables are ORDER BY captured_at), so this does not scan the data.
    """
    rows = client.query(
        f"SELECT min(captured_at) AS start, max(captured_at) AS end FROM {entry.database}.{entry.table}"
    )
    if not rows:
        return None, None
    return _iso(rows[0].get("start")), _iso(rows[0].get("end"))


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


def _describe(entry: _Entry, row_count: int) -> str:
    """Says where the data came from and nothing more. Every claim here is one
    the registry actually makes; there is no summary of what the data means,
    because the warehouse does not know."""
    captured = f"Captured from Redash query {entry.query_id}" if entry.query_id else "Captured from Redash"
    return f"{captured} on every scheduled run. {row_count:,} rows so far."


def _matches(entry: _Entry, needle: str) -> bool:
    return needle in entry.name.lower() or needle in entry.table.lower()


def dataset_ids(client: ClickHouseClient, default_database: str) -> set[str]:
    """Every dataset id the registry lists.

    A dataset has no row of its own anywhere: its id is a ClickHouse registry
    table name. So "does this dataset exist" is answered by reading the registry,
    which is one small table this service already reads on every catalog request.
    Exposed so the tag endpoint can refuse to hang a label on a table nobody
    captured, rather than storing a row that will never be read back.
    """
    return {entry.table for entry in _entries(client, default_database)}


def build_catalog(
    client: ClickHouseClient,
    *,
    database: str,
    stale_after_minutes: int,
    q: str | None = None,
    now: datetime | None = None,
    tags: dict[str, list[str]] | None = None,
) -> list[DatasetOut]:
    entries = _entries(client, database)
    needle = (q or "").strip().lower()
    if needle:
        entries = [entry for entry in entries if _matches(entry, needle)]
    if not entries:
        return []

    databases = {entry.database for entry in entries}
    columns = _columns_by_table(client, databases)
    row_counts = _rows_by_table(client, databases)
    moment = now or datetime.now(UTC)
    stale_before = moment - timedelta(minutes=stale_after_minutes)

    datasets = []
    for entry in entries:
        key = f"{entry.database}.{entry.table}"
        start, end = _span(client, entry)
        # No rows yet means no coverage to state. The registry row exists from
        # the first capture attempt, so an empty table is a real state.
        last_seen = end or ""
        fresh = end is not None and datetime.fromisoformat(end.replace("Z", "+00:00")) >= stale_before
        row_count = row_counts.get(key, 0)
        datasets.append(
            DatasetOut(
                id=entry.table,
                name=entry.name,
                description=_describe(entry, row_count),
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
                    feed_id=entry.table,
                ),
                coverage=DatasetCoverageOut(start=start or "", end=end or ""),
                row_count=row_count,
                sources=[entry.query_name] if entry.query_name else [],
                # Whatever the org has actually tagged this table with, and
                # nothing else. Every dataset used to carry a literal
                # "historical", which could not discriminate between them: a
                # `?tag=historical` filter just meant "every dataset".
                tags=(tags or {}).get(entry.table, []),
                sample_query_id=entry.query_id or None,
            )
        )
    return datasets

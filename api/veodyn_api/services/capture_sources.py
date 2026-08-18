"""Where a captured dataset comes from: the warehouse's own registry.

Redash registers each scheduled query's capture table in `historical._catalog`
(node/redash/historical/catalog.py), and this is the reader for it. One dataset
source among however many services/catalog.py has registered.
"""

from datetime import UTC, datetime
from typing import Any

from veodyn_api.registry import DatasetSource
from veodyn_api.services.clickhouse import ClickHouseClient, WarehouseDatabaseMissing, WarehouseTableMissing


def split_qualified(qualified: str, default_database: str) -> tuple[str, str]:
    database, _, table = qualified.partition(".")
    return (database, table) if table else (default_database, qualified)


# ClickHouse cannot bind an identifier as a query parameter, so the statement that
# names a table interpolates it. Registered names come from slugify_query_name; a
# row that does not match is not a table this service will name in a statement.
def is_identifier(value: str) -> bool:
    return (
        bool(value)
        and (value[0].isalpha() or value[0] == "_")
        and all(char.isalnum() or char == "_" for char in value)
    )


def iso_utc(value: Any) -> str | None:
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


def capture_sources(client: ClickHouseClient, default_database: str) -> list[DatasetSource]:
    """The warehouse registry, or nothing when the registry table does not exist.

    Redash creates `historical._catalog` on its first capture, so a fresh install
    answers UNKNOWN_TABLE, or UNKNOWN_DATABASE one step earlier. An empty
    warehouse is an empty catalog, not a 502.

    Narrow: only those two are swallowed. Any other refusal and any connection
    failure still raises, including WarehouseColumnMissing, which is a registered
    table shaped differently and belongs to catalog.py's own guard.
    """
    try:
        rows = client.query(
            "SELECT query_id, table_name, query_name FROM historical._catalog FINAL ORDER BY query_name, query_id"
        )
    except (WarehouseTableMissing, WarehouseDatabaseMissing):
        return []
    sources = []
    for row in rows:
        database, table = split_qualified(str(row.get("table_name", "")), default_database)
        if not is_identifier(table) or not is_identifier(database):
            continue
        query_name = str(row.get("query_name") or "").strip()
        sources.append(
            DatasetSource(
                table=table,
                database=database,
                name=query_name or table,
                query_id=int(row.get("query_id") or 0),
                query_name=query_name,
            )
        )
    return sources

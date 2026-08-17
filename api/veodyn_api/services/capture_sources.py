"""Where a captured dataset comes from: the warehouse's own registry.

Redash registers each scheduled query's capture table in `historical._catalog`
(node/redash/historical/catalog.py). This module is the reader for that, and
since services/catalog.py became provider-driven it is one dataset source among
however many are registered, rather than the only way a dataset can exist.

Split out of services/catalog.py rather than living there, because assembling a
catalog entry and knowing where datasets come from are two jobs, and only the
first one is the catalog's.
"""

from datetime import UTC, datetime
from typing import Any

from veodyn_api.registry import DatasetSource
from veodyn_api.services.clickhouse import ClickHouseClient, WarehouseDatabaseMissing, WarehouseTableMissing


def split_qualified(qualified: str, default_database: str) -> tuple[str, str]:
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

    Redash creates `historical._catalog` the first time it captures a result, so
    on a fresh install the table is genuinely absent and ClickHouse answers
    UNKNOWN_TABLE. On a stack fresh enough that `historical` itself has never
    been created, ClickHouse answers UNKNOWN_DATABASE instead: the same fresh
    install, one step earlier. Until the first of those was handled, /catalog,
    /domains and /feeds all answered 502 on a stack that had just come up,
    which reads to a new user as "the catalog service is broken" when the true
    answer is "nothing has been captured yet". An empty warehouse is an empty
    catalog, not a failure, whichever of the two is missing.

    Narrow on purpose: only the warehouse saying the table or the database is
    not there is swallowed. Any other refusal, and any connection failure,
    still raises. In particular a missing COLUMN on a table that does exist
    (WarehouseColumnMissing) is not caught here: that is a registered table
    shaped differently, not an absent warehouse, and catalog.py's own guard is
    where it belongs.
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

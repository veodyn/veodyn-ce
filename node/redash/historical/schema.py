import json
import re
from datetime import date, datetime, timezone

from redash.query_runner import (
    TYPE_BOOLEAN,
    TYPE_DATE,
    TYPE_DATETIME,
    TYPE_FLOAT,
    TYPE_INTEGER,
    TYPE_STRING,
    guess_type,
)

TYPE_MAP = {
    TYPE_INTEGER: "Nullable(Int64)",
    TYPE_FLOAT: "Nullable(Float64)",
    TYPE_BOOLEAN: "Nullable(Bool)",
    TYPE_DATETIME: "Nullable(DateTime64(3, 'UTC'))",
    TYPE_DATE: "Nullable(Date32)",
    TYPE_STRING: "Nullable(String)",
}

RESERVED_COLUMNS = {"captured_at", "query_id"}

_IDENTIFIER_RE = re.compile(r"[^a-z0-9_]+")


def map_column_type(redash_type, sample_value=None):
    """Map a Redash result-column type to a ClickHouse column type.

    Falls back to sniffing `sample_value` when a column arrives untyped,
    since Redash query results are normally pre-typed per-column.
    """
    if not redash_type and sample_value is not None:
        redash_type = guess_type(sample_value)
    return TYPE_MAP.get(redash_type, TYPE_MAP[TYPE_STRING])


def sanitize_identifier(name, seen=None):
    """Make a ClickHouse-safe column/table identifier, collision-suffixed against `seen`."""
    slug = _IDENTIFIER_RE.sub("_", (name or "").strip().lower()).strip("_") or "col"
    if slug[0].isdigit():
        slug = f"_{slug}"
    if slug in RESERVED_COLUMNS:
        slug = f"{slug}_field"
    if seen is None:
        return slug
    candidate = slug
    n = 1
    while candidate in seen:
        n += 1
        candidate = f"{slug}_{n}"
    seen.add(candidate)
    return candidate


def slugify_query_name(query_name, query_id):
    """Slug generated once at first capture; the caller persists it so it never changes again."""
    slug = sanitize_identifier(query_name)
    return f"q_{slug}_{query_id}"


def format_clickhouse_datetime(value):
    """
    Format a datetime for a `DateTime64(3, 'UTC')` column's JSONEachRow insert.

    ClickHouse's JSONEachRow parser rejects Python's `isoformat()` output (the
    'T' separator and a '+00:00' offset) — the column's timezone is already
    fixed by its type, so the value must be a bare 'YYYY-MM-DD HH:MM:SS.mmm'
    string in UTC, no separator/offset.
    """
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def serialize_value(value):
    """Prep a raw result-cell value for JSONEachRow insertion."""
    if isinstance(value, (dict, list)):
        return json.dumps(value, default=str)
    if isinstance(value, datetime):
        return format_clickhouse_datetime(value)
    if isinstance(value, date):
        return value.isoformat()
    return value


def build_create_table_sql(table_name, columns, retention_days=0):
    """`columns` is an iterable of (ch_column_name, ch_type) pairs, already sanitized."""
    column_defs = ",\n    ".join(f"`{name}` {ch_type}" for name, ch_type in columns)
    ttl_clause = f"\nTTL captured_at + INTERVAL {int(retention_days)} DAY" if retention_days else ""
    return (
        f"CREATE TABLE IF NOT EXISTS {table_name} (\n"
        f"    captured_at DateTime64(3, 'UTC'),\n"
        f"    query_id UInt32,\n"
        f"    {column_defs}\n"
        f")\n"
        f"ENGINE = MergeTree\n"
        f"PARTITION BY toYYYYMM(captured_at)\n"
        f"ORDER BY captured_at"
        f"{ttl_clause}"
    )


def build_add_column_sql(table_name, column_name, column_type):
    return f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS `{column_name}` {column_type}"


def diff_columns(existing_columns, incoming_columns):
    """
    existing_columns / incoming_columns: {ch_column_name: ch_type}

    Returns (new_columns, conflicts):
      - new_columns: {name: ch_type} for columns present in `incoming` but not `existing`.
      - conflicts: {name: widened_column_name} for columns whose type changed; the widened
        column (`<name>_str String`) is where future values for that field should land,
        per the "widen and log, never drop the row" policy.
    """
    new_columns = {}
    conflicts = {}
    for name, ch_type in incoming_columns.items():
        existing_type = existing_columns.get(name)
        if existing_type is None:
            new_columns[name] = ch_type
        elif existing_type != ch_type:
            conflicts[name] = f"{name}_str"
    return new_columns, conflicts

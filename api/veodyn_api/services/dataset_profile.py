"""What one warehouse table actually holds, for the model that must query it.

Value facts are read from the LATEST SNAPSHOT only: these are append-only
captures, so averaging a column over months of re-captures describes the capture
schedule as much as the data. Table facts (span, row count, snapshot count) come
from the whole table, off the primary index.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.capture_sources import is_identifier

logger = logging.getLogger(__name__)

# The ceiling the prompt already applies to a table's columns.
MAX_PROFILED_COLUMNS = 60

# Few enough values to be a category rather than an identifier. The same ceiling
# the shape guide gives a bar chart.
MAX_CATEGORY_DISTINCT = 25

# At or above this share of distinct values, a column identifies its row. Not 1.0:
# a snapshot with a few duplicate rows is still keyed by that column.
IDENTIFIER_SHARE = 0.9

EXAMPLE_VALUES = 3

CAPTURE_COLUMN = "captured_at"
NUMERIC_PREFIXES = ("Int", "UInt", "Float", "Decimal")
TIME_PREFIXES = ("Date", "DateTime")
GEO_NAMES = ("lat", "latitude", "lon", "lng", "longitude")


@dataclass(frozen=True)
class ColumnProfile:
    name: str
    type: str
    role: str
    nulls: float
    distinct: int
    low: str | None
    high: str | None
    examples: tuple[str, ...]


@dataclass(frozen=True)
class DatasetProfile:
    table: str
    rows: int
    snapshots: int
    latest_at: str | None
    latest_rows: int
    cadence_seconds: float | None
    columns: tuple[ColumnProfile, ...]

    def as_prompt_block(self) -> dict[str, Any]:
        """The profile as the prompt carries it: facts, no prose.

        Cadence is in seconds and is span / (snapshots - 1), which is wrong for an
        irregular schedule, so the snapshot count and span are stated alongside it.
        """
        block: dict[str, Any] = {
            "table": self.table,
            "rows": self.rows,
            "snapshots": self.snapshots,
            "latestSnapshotRows": self.latest_rows,
        }
        if self.latest_at:
            block["latestSnapshotAt"] = self.latest_at
        if self.cadence_seconds is not None:
            block["approxSecondsBetweenSnapshots"] = round(self.cadence_seconds)
        block["columns"] = [_column_block(column) for column in self.columns]
        return block


def _column_block(column: ColumnProfile) -> dict[str, Any]:
    block: dict[str, Any] = {"name": column.name, "type": column.type, "role": column.role}
    if column.distinct:
        block["distinct"] = column.distinct
    if column.low is not None:
        block["min"] = column.low
    if column.high is not None:
        block["max"] = column.high
    if column.examples:
        block["examples"] = list(column.examples)
    if column.nulls > 0:
        block["nullShare"] = round(column.nulls, 3)
    return block


def unwrap(declared: str) -> str:
    """`Nullable(LowCardinality(String))` is a String.

    Loops until nothing changes, because the wrappers nest in either order and one
    pass each would leave `LowCardinality(Nullable(DateTime))` as
    `Nullable(DateTime)`.

    `SimpleAggregateFunction(` is not here: its first argument is a function name,
    so stripping it yields "sum, UInt64". Nothing in a capture table can be one
    (node/redash/historical/schema.py maps every column to a Nullable scalar).
    """
    inner = declared.strip()
    changed = True
    while changed:
        changed = False
        for wrapper in ("Nullable(", "LowCardinality("):
            if inner.startswith(wrapper) and inner.endswith(")"):
                inner = inner[len(wrapper) : -1].strip()
                changed = True
    return inner


def _is_number(declared: str) -> bool:
    return unwrap(declared).startswith(NUMERIC_PREFIXES)


def _is_time(declared: str) -> bool:
    return unwrap(declared).startswith(TIME_PREFIXES)


def role_of(name: str, declared: str, distinct: int, rows: int) -> str:
    """What this column is FOR, as far as the shape of its values can say.

    A hint the model may overrule, offered beside the raw counts.
    """
    if name == CAPTURE_COLUMN or _is_time(declared):
        return "time"
    if name.lower() in GEO_NAMES:
        return "geo"
    if name.lower().endswith("id") or (rows > 0 and distinct >= rows * IDENTIFIER_SHARE):
        return "identifier"
    if _is_number(declared):
        return "measure"
    if 0 < distinct <= MAX_CATEGORY_DISTINCT:
        return "category"
    return "other"


def _table_facts(client: Any, table: str) -> dict[str, Any] | None:
    """Span, volume and snapshot count in one read.

    count() and min/max over the ORDER BY key come off the primary index, so this
    does not scan the data.
    """
    rows = client.query(
        f"SELECT count() AS rows, uniqExact({CAPTURE_COLUMN}) AS snapshots, "
        f"min({CAPTURE_COLUMN}) AS first_at, max({CAPTURE_COLUMN}) AS last_at, "
        f"countIf({CAPTURE_COLUMN} = (SELECT max({CAPTURE_COLUMN}) FROM {table})) AS latest_rows "
        f"FROM {table}"
    )
    return rows[0] if rows else None


def _column_expressions(name: str, declared: str) -> list[str]:
    quoted = f"`{name}`"
    parts = [f"countIf({quoted} IS NULL) AS `{name}__nulls`", f"uniqExact({quoted}) AS `{name}__distinct`"]
    if _is_number(declared) or _is_time(declared):
        parts.append(f"toString(min({quoted})) AS `{name}__low`")
        parts.append(f"toString(max({quoted})) AS `{name}__high`")
    else:
        parts.append(f"arrayMap(value -> toString(value), topK({EXAMPLE_VALUES})({quoted})) AS `{name}__top`")
    return parts


def _snapshot_facts(client: Any, table: str, columns: list[tuple[str, str]]) -> dict[str, Any]:
    """Every column's values, from the latest snapshot, in one statement.

    One statement rather than sixty round trips inside a turn someone waits on.
    """
    selects = ["count() AS n"]
    for name, declared in columns:
        selects.extend(_column_expressions(name, declared))
    rows = client.query(
        f"SELECT {', '.join(selects)} FROM {table} "
        f"WHERE {CAPTURE_COLUMN} = (SELECT max({CAPTURE_COLUMN}) FROM {table})"
    )
    return rows[0] if rows else {}


def _iso(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text or text.startswith("1970-01-01 00:00:00"):
        return None
    return text


def _seconds_between(first: str | None, last: str | None, snapshots: int) -> float | None:
    if not first or not last or snapshots < 2:
        return None
    try:
        start, end = datetime.fromisoformat(first), datetime.fromisoformat(last)
    except ValueError:
        return None
    return (end - start).total_seconds() / (snapshots - 1)


def _number(row: dict[str, Any], key: str) -> int:
    value = row.get(key)
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else 0


def _column_profile(name: str, declared: str, row: dict[str, Any], rows: int) -> ColumnProfile:
    distinct = _number(row, f"{name}__distinct")
    examples = row.get(f"{name}__top")
    return ColumnProfile(
        name=name,
        type=unwrap(declared),
        role=role_of(name, declared, distinct, rows),
        nulls=(_number(row, f"{name}__nulls") / rows) if rows else 0.0,
        distinct=distinct,
        low=str(row[f"{name}__low"]) if row.get(f"{name}__low") is not None else None,
        high=str(row[f"{name}__high"]) if row.get(f"{name}__high") is not None else None,
        examples=tuple(str(value) for value in examples)[:EXAMPLE_VALUES] if isinstance(examples, list) else (),
    )


def profile_dataset(client: Any, dataset: DatasetOut) -> DatasetProfile | None:
    """The profile, or None when the warehouse cannot answer.

    None rather than an exception: a warehouse that is down must not take the
    interview down with it.
    """
    table = dataset.id
    if not is_identifier(table):
        return None
    columns = [
        (column.name, column.type) for column in dataset.schema_[:MAX_PROFILED_COLUMNS] if is_identifier(column.name)
    ]
    try:
        facts = _table_facts(client, table)
        snapshot = _snapshot_facts(client, table, columns) if columns else {}
    except Exception:
        # Broad: httpx errors, ApiError and an unexpected response shape all get
        # the same answer, no profile.
        logger.warning("could not profile %s; the prompt will carry the catalog entry alone", table, exc_info=True)
        return None
    if facts is None:
        return None

    rows_in_snapshot = _number(snapshot, "n")
    snapshots = _number(facts, "snapshots")
    profiled = tuple(_column_profile(name, declared, snapshot, rows_in_snapshot) for name, declared in columns)
    return DatasetProfile(
        table=table,
        rows=_number(facts, "rows"),
        snapshots=snapshots,
        latest_at=_iso(facts.get("last_at")),
        latest_rows=_number(facts, "latest_rows"),
        cadence_seconds=_seconds_between(_iso(facts.get("first_at")), _iso(facts.get("last_at")), snapshots),
        columns=profiled,
    )

"""The columns a statement will return, asked for without running it.

A chart is bound to column NAMES, and the names in a generated statement are its
aliases, not the source table's columns: `avg(speed_kph) AS speed` produces
`speed`, which no catalog entry mentions. So the only honest source for a chart
mapping is the statement's own result shape, and ClickHouse will describe it
without executing anything.

Two rules this module keeps. The statement must already have passed
validate_sql: DESCRIBE plans whatever it is given, and planning an unvalidated
statement is a boundary this service does not cross. And a failure here is an
empty shape, never an exception: everything downstream of it is cosmetic, and a
chart that falls back to the frontend's own inference is last week's behaviour
rather than a broken turn.
"""

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# How a value is stored, not what it means. LowCardinality is a compression
# choice and Nullable is a column property; both wrap the type a chart cares
# about, and they nest in either order.
WRAPPERS = ("Nullable(", "LowCardinality(")

NUMERIC_PREFIXES = ("Int", "UInt", "Float", "Decimal")
TIME_PREFIXES = ("Date", "DateTime")


@dataclass(frozen=True)
class ResultColumn:
    name: str
    # The unwrapped type. A chart cares that a column is a String, not that the
    # warehouse stores it as a LowCardinality(Nullable(String)).
    type: str
    kind: str


def unwrap(declared: str) -> str:
    inner = declared.strip()
    changed = True
    while changed:
        changed = False
        for wrapper in WRAPPERS:
            if inner.startswith(wrapper) and inner.endswith(")"):
                inner = inner[len(wrapper) : -1].strip()
                changed = True
    return inner


def kind_of(declared: str) -> str:
    inner = unwrap(declared)
    if inner.startswith(TIME_PREFIXES):
        return "time"
    if inner.startswith("Bool"):
        return "bool"
    if inner.startswith(NUMERIC_PREFIXES):
        return "number"
    if inner.startswith("String") or inner.startswith("FixedString"):
        return "text"
    return "other"


def describe_result(client: Any, sql: str) -> tuple[ResultColumn, ...]:
    """The statement's result columns, or () when anything at all goes wrong."""
    try:
        rows = client.query(f"DESCRIBE (\n{sql}\n)")
    except Exception:
        logger.info("could not describe a generated statement; the chart will fall back", exc_info=True)
        return ()
    columns = []
    for row in rows:
        name = row.get("name")
        declared = str(row.get("type") or "")
        if not isinstance(name, str) or not name:
            continue
        columns.append(ResultColumn(name=name, type=unwrap(declared), kind=kind_of(declared)))
    return tuple(columns)


def columns_named(columns: tuple[ResultColumn, ...]) -> set[str]:
    return {column.name for column in columns}

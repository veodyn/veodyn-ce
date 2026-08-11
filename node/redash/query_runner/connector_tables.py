"""
Table shaping for connectors whose rows are not all the same shape.

`connector_base.to_redash_table` derives the column set AND each column's
type from record one. A resource whose first row is an error row, or is just
missing an optional field, therefore types a numeric column as a string or
drops the column outright for the whole table. This module is the explicit
alternative. It lives here rather than in connector_base.py because that
file is at 291 lines against a 300-line limit.
"""

import json
from datetime import date, datetime


def to_fixed_table(column_names, column_types, records):
    columns = [{"name": n, "friendly_name": n, "type": column_types[n]} for n in column_names]
    rows = [{n: _fixed_cell(record.get(n)) for n in column_names} for record in records]
    return columns, rows


def _fixed_cell(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, default=str)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value

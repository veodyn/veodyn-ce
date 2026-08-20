"""
Static GTFS query runner.

Fetches a GTFS zip archive over HTTP and serves the `.txt` tables inside it as
query results, so schedule data (stops, routes, trips, stop_times, calendar)
is queryable beside the realtime vehicle feeds.

Query format (JSON):

    {"resource": "list"}                       # tables in the archive
    {"table": "stops"}                         # every row of one table
    {"table": "stops", "columns": ["stop_id", "stop_lat", "stop_lon"]}
    {"table": "trips", "filter": {"route_id": ["12", "14"]}}

Filter values are compared as strings, and several keys AND together. The
archive is fetched once per query; there is no cache.
"""

import csv
import io
import json
import logging
import zipfile

import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    REQUEST_HEADERS,
    BaseResourceRunner,
    build_configuration_schema,
    serialize_result,
    to_redash_table,
)
from redash.query_runner.connector_validation import (
    parse_object_query,
    require_configured,
)
from redash.query_runner.gtfs_realtime_transport import read_bounded, sanitize_feed_url
from redash.query_runner.gtfs_static_tables import (
    DEFAULT_MAX_ROWS,
    MAX_ROWS_CEILING,
    DecompressionBudget,
    check_archive_bounds,
    coerce,
    column_type_for,
    matches,
    open_table,
    parse_max_rows,
    table_members,
)

logger = logging.getLogger(__name__)


class GtfsStatic(BaseResourceRunner):
    default_resource = "list"
    noop_query = '{"resource": "list"}'

    def __init__(self, configuration):
        super().__init__(configuration)
        self.gtfs_url = self.configuration.get("gtfs_url", "")

    @classmethod
    def name(cls):
        return "Static GTFS"

    @classmethod
    def type(cls):
        return "gtfs_static"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "gtfs_url": {
                    "type": "string",
                    "title": "GTFS archive URL",
                    "description": (
                        "http:// or https:// URL of the GTFS zip archive, e.g. "
                        "https://transit.example.org/gtfs/feed.zip"
                    ),
                },
                "max_rows": {
                    "type": "number",
                    "title": "Max rows per query",
                    "default": DEFAULT_MAX_ROWS,
                    "minimum": 1,
                    "maximum": MAX_ROWS_CEILING,
                    # Whole numbers only, without declaring type integer, which
                    # the app's form maps to a text input rather than a number.
                    "multipleOf": 1,
                },
            },
            required=["gtfs_url"],
            include_redis=False,
        )

    def _fetch_archive(self, safe_url):
        try:
            response = requests.get(self.gtfs_url, timeout=self.timeout, stream=True, headers=REQUEST_HEADERS)
            response.raise_for_status()
            content = read_bounded(response, safe_url)
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else "unknown"
            raise ValueError(f"GTFS request to {safe_url} failed with HTTP {status}") from exc
        except requests.RequestException as exc:
            raise ValueError(f"GTFS request to {safe_url} failed: {type(exc).__name__}") from exc

        try:
            archive = zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile as exc:
            raise ValueError(f"GTFS archive from {safe_url} is not a readable zip: {exc}") from exc

        check_archive_bounds(archive, safe_url)
        return archive

    def _list_tables(self, archive, members, budget):
        rows = []
        for name in sorted(members):
            with open_table(archive, members[name], budget) as text:
                reader = csv.reader(text)
                header = next(reader, [])
                row_count = sum(1 for values in reader if values)
            rows.append({"table": name, "row_count": row_count, "columns": json.dumps(header)})
        return rows

    def _select_fields(self, table, header, projection):
        if not projection:
            return list(header)
        if isinstance(projection, str):
            projection = [projection]
        for field in projection:
            if field not in header:
                available = ", ".join(header)
                raise ValueError(f"Unknown column {field!r} in table {table!r}. Available columns: {available}")
        return list(projection)

    def _read_table(self, archive, table, member, projection, filters, max_rows, budget):
        """Stream one table, filtering then capping, so an oversized table is never held whole."""
        records = []
        truncated = False
        with open_table(archive, member, budget) as text:
            reader = csv.DictReader(text)
            header = reader.fieldnames or []
            fields = self._select_fields(table, header, projection)
            for record in reader:
                if filters and not matches(record, filters, header):
                    continue
                if len(records) >= max_rows:
                    truncated = True
                    break
                records.append({field: record.get(field) or "" for field in fields})

        columns = [
            {"name": field, "friendly_name": field, "type": column_type_for(field, records)} for field in fields
        ]
        rows = [
            {column["name"]: coerce(record[column["name"]], column["type"]) for column in columns}
            for record in records
        ]
        return columns, rows, truncated

    def run_query(self, query, user):
        config, _params, error = parse_object_query(query)
        if error:
            return None, error

        error = require_configured(self.name(), gtfs_url=self.gtfs_url)
        if error:
            return None, error

        resource = config.get("resource") or self.default_resource
        if resource != "list":
            return None, f"Unknown resource {resource!r}. Available resources: list"

        max_rows, error = parse_max_rows(self.configuration.get("max_rows"))
        if error:
            return None, error

        safe_url = sanitize_feed_url(self.gtfs_url)
        budget = DecompressionBudget(safe_url)

        try:
            archive = self._fetch_archive(safe_url)
            members = table_members(archive)
            table = config.get("table")
            if table is None:
                columns, rows = to_redash_table(self._list_tables(archive, members, budget))
                return serialize_result(columns, rows), None
            if table not in members:
                available = ", ".join(sorted(members)) or "none"
                raise ValueError(f"Unknown table {table!r}. Available tables: {available}")
            columns, rows, truncated = self._read_table(
                archive,
                table,
                members[table],
                config.get("columns"),
                config.get("filter") or {},
                max_rows,
                budget,
            )
        except Exception as e:
            return None, str(e)

        data = serialize_result(columns, rows)
        if truncated:
            logger.warning("Truncated GTFS table %s at %s rows.", table, max_rows)
            data["truncated"] = True
        return data, None

    def get_schema(self, get_stats=False):
        # The archive lives behind an HTTP fetch, so the schema browser
        # documents the query format rather than downloading it; {"resource":
        # "list"} is how the tables themselves are discovered.
        return [
            {
                "name": "__ Query Format __",
                "columns": [
                    "resource: list (default) - one row per table in the archive",
                    "table: name of a GTFS table without .txt, e.g. stops",
                    "columns: array of column names to return (default all)",
                    "filter: {column: value | [values]}, compared as strings and ANDed",
                    f"row cap: the max_rows configuration, default {DEFAULT_MAX_ROWS}",
                ],
            },
            {
                "name": "__ Query Examples __",
                "columns": [
                    "─────────────────────────────────────",
                    "List the tables in the archive",
                    "─────────────────────────────────────",
                    '{"resource": "list"}',
                    "",
                    "Every stop",
                    '{"table": "stops"}',
                    "",
                    "Stop coordinates only, for a map",
                    '{"table": "stops", "columns": ["stop_id", "stop_name", "stop_lat", "stop_lon"]}',
                    "",
                    "Trips on two routes",
                    '{"table": "trips", "filter": {"route_id": ["12", "14"]}}',
                ],
            },
        ]


register(GtfsStatic)

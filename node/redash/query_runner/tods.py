import csv
import logging

from redash.query_runner import register
from redash.query_runner.connector_base import (
    build_configuration_schema,
    serialize_result,
    to_redash_table,
)
from redash.query_runner.connector_validation import (
    parse_object_query,
    require_configured,
)
from redash.query_runner.gtfs_realtime_transport import sanitize_feed_url
from redash.query_runner.gtfs_static import GtfsStatic
from redash.query_runner.gtfs_static_tables import (
    DEFAULT_MAX_ROWS,
    MAX_ROWS_CEILING,
    DecompressionBudget,
    matches,
    open_table,
    parse_max_rows,
    table_members,
    typed_result,
)
from redash.query_runner.tods_merge import (
    PRIMARY_KEYS,
    SupplementIndex,
    read_rows,
    supplement_name,
)

logger = logging.getLogger(__name__)


class TODS(GtfsStatic):
    def __init__(self, configuration):
        super().__init__(configuration)
        self.tods_url = self.configuration.get("tods_url", "")

    @classmethod
    def name(cls):
        return "TODS Operational Data"

    @classmethod
    def type(cls):
        return "tods"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "tods_url": {
                    "type": "string",
                    "title": "TODS archive URL",
                    "description": (
                        "http:// or https:// URL of the zip archive holding the TODS supplement and "
                        "operational tables (run_events, vehicles, vehicle_assignments, ...)"
                    ),
                },
                "gtfs_url": {
                    "type": "string",
                    "title": "Base GTFS archive URL (optional)",
                    "description": "The public GTFS the supplements patch; needed for merged reads only",
                },
                "max_rows": {
                    "type": "number",
                    "title": "Max rows per query",
                    "default": DEFAULT_MAX_ROWS,
                    "minimum": 1,
                    "maximum": MAX_ROWS_CEILING,
                    "multipleOf": 1,
                },
            },
            required=["tods_url"],
            include_redis=False,
        )

    def _base_table_member(self, table):
        if not self.gtfs_url:
            raise ValueError("A merged read needs the base GTFS archive URL configured on this data source")
        base_archive = self._fetch_archive(sanitize_feed_url(self.gtfs_url), url=self.gtfs_url)
        base_members = table_members(base_archive)
        if table not in base_members:
            available = ", ".join(sorted(base_members)) or "none"
            raise ValueError(f"Unknown base GTFS table {table!r}. Available tables: {available}")
        return base_archive, base_members[table]

    def _read_merged(self, tods_archive, tods_members, table, config, max_rows, budget):
        base_archive, base_member = self._base_table_member(table)
        filters = config.get("filter") or {}
        records = []
        truncated = False
        with open_table(base_archive, base_member, budget) as text:
            reader = csv.DictReader(text)
            header = list(reader.fieldnames or [])
            merged = ({field: record.get(field) or "" for field in header} for record in reader)
            supplement = tods_members.get(supplement_name(table))
            if supplement:
                supplement_header, supplement_rows = read_rows(tods_archive, supplement, budget)
                index = SupplementIndex(table, header, supplement_header, supplement_rows)
                header, merged = index.header, index.merge(merged)
            fields = self._select_fields(table, header, config.get("columns"))
            for row in merged:
                if filters and not matches(row, filters, header):
                    continue
                if len(records) >= max_rows:
                    truncated = True
                    break
                records.append({field: row.get(field) or "" for field in fields})

        columns, rows = typed_result(fields, records)
        return columns, rows, truncated

    def run_query(self, query, user):
        config, _params, error = parse_object_query(query)
        if error:
            return None, error

        error = require_configured(self.name(), tods_url=self.tods_url)
        if error:
            return None, error

        resource = config.get("resource") or self.default_resource
        if resource != "list":
            return None, f"Unknown resource {resource!r}. Available resources: list"

        max_rows, error = parse_max_rows(self.configuration.get("max_rows"))
        if error:
            return None, error

        safe_url = sanitize_feed_url(self.tods_url)
        budget = DecompressionBudget(safe_url)

        try:
            archive = self._fetch_archive(safe_url, url=self.tods_url)
            members = table_members(archive)
            table = config.get("table")
            if table is None:
                columns, rows = to_redash_table(self._list_tables(archive, members, budget))
                return serialize_result(columns, rows), None
            if config.get("merged"):
                columns, rows, truncated = self._read_merged(archive, members, table, config, max_rows, budget)
            elif table not in members:
                available = ", ".join(sorted(members)) or "none"
                raise ValueError(f"Unknown table {table!r}. Available tables: {available}")
            else:
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
            logger.warning("Truncated TODS table %s at %s rows.", table, max_rows)
            data["truncated"] = True
        return data, None

    def get_schema(self, get_stats=False):
        return [
            {
                "name": "__ Query Format __",
                "columns": [
                    "resource: list (default) - one row per table in the TODS archive",
                    "table: name of a table without .txt, e.g. run_events or trips_supplement",
                    "merged: true - read a base GTFS table with its *_supplement applied (needs the base GTFS URL)",
                    f"merged tables: {', '.join(sorted(PRIMARY_KEYS))}",
                    "columns: array of column names to return (default all)",
                    "filter: {column: value | [values]}, compared as strings and ANDed",
                    f"row cap: the max_rows configuration, default {DEFAULT_MAX_ROWS}",
                ],
            },
            {
                "name": "__ Query Examples __",
                "columns": [
                    '{"resource": "list"}',
                    '{"table": "run_events"}',
                    '{"table": "vehicle_assignments", "filter": {"date": "20260908"}}',
                    '{"table": "trips", "merged": true}',
                    '{"table": "trips", "merged": true, "filter": {"TODS_trip_type": "deadhead"}}',
                ],
            },
        ]


register(TODS)

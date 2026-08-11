from datetime import datetime, timezone

from redash import models, settings, statsd_client
from redash.historical import catalog, schema, shape_cache
from redash.historical.client import ClickHouseHistoricalClient
from redash.worker import get_job_logger, job

logger = get_job_logger(__name__)


def _build_client():
    return ClickHouseHistoricalClient(
        url=settings.HISTORICAL_CLICKHOUSE_URL,
        user=settings.HISTORICAL_CLICKHOUSE_USER,
        password=settings.HISTORICAL_CLICKHOUSE_PASSWORD,
        database=settings.HISTORICAL_CLICKHOUSE_DATABASE,
    )


@job("historical", timeout=300)
def capture_query_result(query_result_id, data_source_id, query_id):
    """
    Fire-and-forget: append a scheduled query's result set into its historical
    ClickHouse table. Never allowed to raise — a capture failure must never
    affect the user-facing query path that triggered it.
    """
    try:
        _capture_query_result(query_result_id, data_source_id, query_id, client=_build_client())
    except Exception:
        logger.exception(
            "historical capture failed for query_result_id=%s data_source_id=%s query_id=%s",
            query_result_id,
            data_source_id,
            query_id,
        )
        statsd_client.incr("historical.capture.errors")


def _reconcile_table_schema(client, table_name, incoming_columns, column_name_map, retention_days):
    """
    Bring the ClickHouse table in line with the shape this result set carries:
    create it, or add whatever columns are new since the last capture.

    Mutates `column_name_map` in place. A column whose type conflicts with the
    stored one is widened into a separate `_str` column, and every field
    pointing at the old name has to be redirected there for this insert and all
    later ones.
    """
    existing_columns = client.get_columns(table_name)
    if existing_columns is None:
        client.execute(
            schema.build_create_table_sql(table_name, list(incoming_columns.items()), retention_days=retention_days)
        )
        return

    new_columns, conflicts = schema.diff_columns(existing_columns, incoming_columns)
    for name, ch_type in new_columns.items():
        client.execute(schema.build_add_column_sql(table_name, name, ch_type))
    for name, widened_name in conflicts.items():
        logger.warning(
            "historical capture: type conflict on %s.%s, widening into %s",
            table_name,
            name,
            widened_name,
        )
        client.execute(schema.build_add_column_sql(table_name, widened_name, "Nullable(String)"))
        for original_name, ch_name in column_name_map.items():
            if ch_name == name:
                column_name_map[original_name] = widened_name


def _capture_query_result(query_result_id, data_source_id, query_id, client):
    if settings.HISTORICAL_DATA_SOURCE_ID and data_source_id == settings.HISTORICAL_DATA_SOURCE_ID:
        return  # loop guard: never capture queries run against the historical store itself

    if not settings.HISTORICAL_CLICKHOUSE_URL:
        return  # capture globally disabled

    if not query_id:
        logger.warning("historical capture skipped: no query_id for query_result_id=%s", query_result_id)
        return

    query_result = models.QueryResult.query.get(query_result_id)
    if query_result is None or not query_result.data:
        return

    columns = query_result.data.get("columns") or []
    result_rows = query_result.data.get("rows") or []
    if not columns:
        return

    query_model = models.Query.query.get(query_id)
    query_name = query_model.name if query_model else str(query_id)
    data_source = models.DataSource.query.get(data_source_id)
    retention_days = data_source.options.get("historical_retention_days", 0) if data_source else 0

    table_name = catalog.get_or_create_table_name(client, query_id, query_name, data_source_id)

    seen_names = set()
    column_name_map = {}  # original Redash column name -> ClickHouse column name to write into
    incoming_columns = {}  # ClickHouse column name -> ClickHouse type
    for col in columns:
        ch_name = schema.sanitize_identifier(col["name"], seen_names)
        column_name_map[col["name"]] = ch_name
        sample = result_rows[0].get(col["name"]) if result_rows else None
        incoming_columns[ch_name] = schema.map_column_type(col.get("type"), sample)

    incoming_shape = frozenset(incoming_columns.keys())
    cached_shape = shape_cache.get_cached_shape(query_id)

    if cached_shape is None or cached_shape != incoming_shape:
        with shape_cache.table_lock(table_name):
            _reconcile_table_schema(client, table_name, incoming_columns, column_name_map, retention_days)
            shape_cache.set_cached_shape(query_id, incoming_shape)

    captured_at = schema.format_clickhouse_datetime(query_result.retrieved_at or datetime.now(timezone.utc))

    rows_to_insert = []
    for row in result_rows:
        record = {"captured_at": captured_at, "query_id": int(query_id)}
        for col in columns:
            ch_name = column_name_map[col["name"]]
            value = schema.serialize_value(row.get(col["name"]))
            if ch_name.endswith("_str") and value is not None:
                value = str(value)
            record[ch_name] = value
        rows_to_insert.append(record)

    client.insert_jsoneachrow(table_name, rows_to_insert)

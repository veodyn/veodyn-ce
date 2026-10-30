from datetime import datetime, timezone

from redash.historical.schema import slugify_query_name


def catalog_table(client):
    return f"{client.database}._catalog"


def ensure_database(client):
    client.execute(f"CREATE DATABASE IF NOT EXISTS {client.database}")


def ensure_catalog_table(client):
    client.execute(
        f"CREATE TABLE IF NOT EXISTS {catalog_table(client)} (\n"
        "    query_id UInt32,\n"
        "    table_name String,\n"
        "    query_name String,\n"
        "    data_source_id UInt32,\n"
        "    created_at DateTime('UTC'),\n"
        "    updated_at DateTime('UTC')\n"
        ")\n"
        "ENGINE = ReplacingMergeTree(updated_at)\n"
        "ORDER BY query_id"
    )


def _lookup_table_name(client, query_id):
    result = client.query_json(
        f"SELECT table_name FROM {catalog_table(client)} FINAL WHERE query_id = {int(query_id)} LIMIT 1"
    )
    rows = result.get("data", [])
    return rows[0]["table_name"] if rows else None


def get_or_create_table_name(client, query_id, query_name, data_source_id):
    """
    Resolve the (never-changing, rename-proof) historical table name for a query.

    The slug is generated once, at first capture, and persisted here — later
    renames of the query must never orphan its accumulated history.
    """
    ensure_database(client)
    ensure_catalog_table(client)

    existing = _lookup_table_name(client, query_id)
    if existing:
        return existing

    table_name = "{}.{}".format(client.database, slugify_query_name(query_name, query_id))
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    client.insert_jsoneachrow(
        catalog_table(client),
        [
            {
                "query_id": int(query_id),
                "table_name": table_name,
                "query_name": query_name or "",
                "data_source_id": int(data_source_id),
                "created_at": now,
                "updated_at": now,
            }
        ],
    )
    return table_name

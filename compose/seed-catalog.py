#!/usr/bin/env python3
"""Fill a seeded-but-empty local stack with content: sources, queries, dashboards,
a warehouse with history in it, and the sidecar rows that make the catalog and the
feed-health board render something.

`seed-redash.py` is the other half and runs first. It produces a stack that WORKS;
this one produces a stack that SHOWS something. They are separate because they fail
differently: without the first, nothing starts, and compose holds `server` back
until it exits 0. Without this one everything starts and every surface is empty,
which is a stack you can develop the shell of the product against but not the
parts that read data.

Behind the `seed` compose profile, so `docker compose up` never runs it.

WHY THE DATA SOURCES ARE NOT A SQL FIXTURE. compose/init-secrets.sh generates
REDASH_SECRET_KEY per stack and keeps it in a volume. That key encrypts
data_sources.encrypted_options, so a checked-in dump of that column decrypts on
exactly one machine and reports a connection error on every other one. They are
created here, through the models, so the local key is the one that encrypts them.

RE-RUNNING IT IS SAFE AND FINISHES THE JOB. Each of the four phases records its
own completion marker in ClickHouse, so a run interrupted after the queries were
committed resumes at the warehouse rather than reporting itself already done. That
is also what lets a stack seeded as ce later take the enterprise fixture.
"""

import json
import os
import sys
from pathlib import Path

import requests

# Sibling modules, importable because compose/ is mounted whole and is sys.path[0]
# when this runs. The first holds fixture parsing, testable with no datastore at
# all; the second holds everything that needs a Redash app context.
from seed_catalog_fixtures import expand, split_statements, substitute
from seed_catalog_redash import create_dashboards, create_queries, create_sources, find_queries

APP_DIR = "/app"
# Bind-mounted outside the image's WORKDIR, so sys.path[0] is the mount directory
# and not /app, and the `redash` package is not importable without this even though
# the container is built around it. Same three lines, and the same reason, as
# compose/seed-redash.py.
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

FIXTURES = Path(os.environ.get("VEODYN_FIXTURES_DIR", "/opt/veodyn/fixtures"))
CLICKHOUSE_URL = os.environ.get("REDASH_HISTORICAL_CLICKHOUSE_URL", "http://clickhouse:8123")
CLICKHOUSE_DB = os.environ.get("REDASH_HISTORICAL_CLICKHOUSE_DATABASE", "historical")
SIDECAR_DSN = os.environ.get("VEODYN_SIDECAR_DSN", "postgresql://postgres@postgres/veodyn")
ADMIN_EMAIL = os.environ.get("VEODYN_ADMIN_EMAIL", "admin@example.com")

MARKER_TABLE = f"{CLICKHOUSE_DB}._seed_state"


def log(message):
    print(f"seed-catalog: {message}", flush=True)


def clickhouse(sql):
    """Run one statement. Raises on anything but 200, with ClickHouse's own message."""
    response = requests.post(CLICKHOUSE_URL, data=sql.encode("utf-8"), timeout=60)
    if response.status_code != 200:
        raise RuntimeError(f"ClickHouse refused a statement:\n{sql[:400]}\n{response.text.strip()}")
    return response.text


def is_done(component):
    return clickhouse(f"SELECT count() FROM {MARKER_TABLE} FINAL WHERE component = '{component}'").strip() != "0"


def mark_done(component):
    clickhouse(f"INSERT INTO {MARKER_TABLE} (component, at) VALUES ('{component}', now())")


def ensure_clickhouse_schema():
    clickhouse(f"CREATE DATABASE IF NOT EXISTS {CLICKHOUSE_DB}")
    # Which phases have finished. In ClickHouse rather than Postgres because both
    # editions have one, the seed already talks to it, and neither application
    # database has a table this could live in without a migration to add one.
    clickhouse(
        f"CREATE TABLE IF NOT EXISTS {MARKER_TABLE} (\n"
        "    component String,\n"
        "    at DateTime('UTC')\n"
        ")\n"
        "ENGINE = ReplacingMergeTree(at)\n"
        "ORDER BY component"
    )
    # The capture registry. Its schema is node/redash/historical/catalog.py's.
    clickhouse(
        f"CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}._catalog (\n"
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


def load_warehouse(fixture, queries, tokens, schema):
    """Capture tables in the shape a real capture would build, and rows in them.

    The DDL is GENERATED from the fork's own helpers rather than written into the
    fixture, so a seeded table is the same shape a captured one. Writing it by hand
    would be a second description of a schema the fork already owns, and the first
    change to that schema would leave the two disagreeing with nothing to notice.
    """
    for spec in fixture["queries"]:
        if not spec.get("captured"):
            continue
        query = queries[spec["key"]]
        qualified = tokens[f"__TABLE_{spec['key']}__"]

        seen = set()
        columns = [
            (schema.sanitize_identifier(name, seen), schema.map_column_type(kind))
            for name, kind in spec["columns"]
        ]
        # Dropped first, so a retry after a failure part-way through this phase
        # starts from nothing. These are plain MergeTree tables with no dedup, and
        # the phase only runs with its marker unset, which means either a first run
        # or a retry of one that did not finish. Re-running the inserts over rows a
        # failed attempt already landed would double every capture and with it every
        # feed measurement computed from them.
        clickhouse(f"DROP TABLE IF EXISTS {qualified}")
        clickhouse(schema.build_create_table_sql(qualified, columns))
        clickhouse(
            f"INSERT INTO {CLICKHOUSE_DB}._catalog "
            "(query_id, table_name, query_name, data_source_id, created_at, updated_at) VALUES "
            f"({query.id}, '{qualified}', '{spec['name']}', {query.data_source_id}, now(), now())"
        )
        log(f"warehouse table {qualified}")

    rows_sql = substitute((FIXTURES / "historical.sql").read_text(), tokens)
    for statement in split_statements(rows_sql):
        clickhouse(statement)

    # Count what landed rather than trusting that the statements ran. This is not
    # belt and braces: the first version of split_statements dropped every INSERT
    # in the file and this step reported the rows loaded, because "no error" and
    # "something happened" are different claims and only the second is worth
    # printing. An empty capture table is also exactly what a working stack with a
    # broken seed looks like from the catalog.
    for key, table in ((k, v) for k, v in tokens.items() if k.startswith("__TABLE_")):
        count = int(clickhouse(f"SELECT count() FROM {table}").strip())
        if not count:
            raise RuntimeError(f"{table} is empty after loading historical.sql")
        log(f"{table} holds {count} rows")


def apply_sidecar(sql):
    """One transaction against the `veodyn` database.

    A second connection rather than the ORM: this container runs the node image and
    has no veodyn_api to import. Nothing is lost by it, because none of the tables
    involved has an encrypted column.
    """
    import psycopg2

    connection = psycopg2.connect(SIDECAR_DSN)
    try:
        connection.autocommit = False
        with connection.cursor() as cursor:
            cursor.execute(sql)
        connection.commit()
    finally:
        connection.close()


def main():
    from redash import create_app, models
    from redash.historical import schema
    from redash.query_runner import query_runners
    from redash.utils import gen_query_hash
    from redash.utils.configuration import ConfigurationContainer

    fixture = expand(json.loads((FIXTURES / "catalog.json").read_text()), os.environ)
    ensure_clickhouse_schema()

    app = create_app()
    with app.app_context():
        org = models.Organization.get_by_slug("default")
        if org is None:
            print("seed-catalog: no default organization; run redash-bootstrap first", file=sys.stderr)
            return 1
        admin = models.User.query.filter(models.User.email == ADMIN_EMAIL).one()

        if is_done("catalog"):
            log("catalog already seeded, reusing it")
            queries = find_queries(models, org, fixture)
        else:
            sources = create_sources(models, org, fixture, query_runners, ConfigurationContainer, log)
            queries, visualizations = create_queries(models, org, admin, fixture, sources, gen_query_hash, log)
            create_dashboards(models, org, admin, fixture, visualizations, log)
            mark_done("catalog")

        tokens = {"__ADMIN_USER_ID__": str(admin.id)}
        for spec in fixture["queries"]:
            query = queries[spec["key"]]
            tokens[f"__QID_{spec['key']}__"] = str(query.id)
            if not spec.get("captured"):
                continue
            bare = schema.slugify_query_name(spec["name"], query.id)
            tokens[f"__TABLE_{spec['key']}__"] = f"{CLICKHOUSE_DB}.{bare}"
            tokens[f"__TABLENAME_{spec['key']}__"] = bare

        if is_done("warehouse"):
            log("warehouse already loaded")
        else:
            load_warehouse(fixture, queries, tokens, schema)
            mark_done("warehouse")

        if is_done("sidecar"):
            log("sidecar rows already loaded")
        else:
            apply_sidecar(substitute((FIXTURES / "sidecar.sql").read_text(), tokens))
            mark_done("sidecar")
            log("sidecar rows loaded")

        # Its own phase and its own marker, so a stack seeded as ce and later
        # brought up as ee takes the enterprise rows on the next seed instead of
        # reporting itself already done.
        ee_fixture = os.environ.get("VEODYN_EE_FIXTURE")
        if ee_fixture and not is_done("enterprise"):
            apply_sidecar(substitute(Path(ee_fixture).read_text(), tokens))
            mark_done("enterprise")
            log(f"enterprise rows loaded from {ee_fixture}")

    log("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())

import json
import logging

import requests

logger = logging.getLogger(__name__)


class ClickHouseHistoricalClient:
    """
    Minimal ClickHouse HTTP-interface client for the historical capture pipeline.

    Deliberately mirrors query_runner/clickhouse.py's request pattern (bare
    `requests.post`, `FORMAT JSON` / `FORMAT JSONEachRow`) rather than adding a
    new dependency or reusing that runner's instance methods, which are bound
    to a query-runner instance rather than reusable standalone.
    """

    def __init__(self, url, user="default", password="", database="historical", timeout=30, verify=True):
        self.url = url
        self.user = user
        self.password = password
        self.database = database
        self.timeout = timeout
        self.verify = verify

    def _params(self):
        return {
            "user": self.user,
            "password": self.password,
            "database": self.database,
            "default_format": "JSON",
        }

    def execute(self, statement):
        """Run a statement with no expected tabular response (CREATE/ALTER/INSERT)."""
        try:
            response = requests.post(
                self.url,
                data=statement.encode("utf-8", "ignore"),
                timeout=self.timeout,
                params=self._params(),
                verify=self.verify,
            )
        except requests.RequestException as e:
            raise Exception(f"Connection error to {self.url}: {e}") from e

        if not response.ok:
            raise Exception(response.text)
        return response.text

    def query_json(self, query):
        """Run a SELECT and parse a FORMAT JSON response into {"meta": [...], "data": [...]}."""
        text = self.execute(query.rstrip().rstrip(";") + "\nFORMAT JSON")
        if not text:
            return {"meta": [], "data": []}
        response = json.loads(text)
        if "exception" in response:
            raise Exception(response["exception"])
        return response

    def get_columns(self, table_name):
        """Return {column_name: ch_type} for a table, or None if it doesn't exist yet."""
        database, _, table = table_name.partition(".")
        result = self.query_json(
            "SELECT name, type FROM system.columns WHERE database = '{}' AND table = '{}'".format(
                database.replace("'", "''"), table.replace("'", "''")
            )
        )
        rows = result.get("data", [])
        if not rows:
            return None
        return {row["name"]: row["type"] for row in rows}

    def insert_jsoneachrow(self, table_name, rows):
        """Insert a batch of dict rows via a single FORMAT JSONEachRow statement."""
        if not rows:
            return
        body = "\n".join(json.dumps(row, default=str) for row in rows)
        self.execute(f"INSERT INTO {table_name} FORMAT JSONEachRow\n{body}")

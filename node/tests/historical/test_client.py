import json
from unittest import TestCase
from unittest.mock import Mock, patch

import requests

from redash.historical.client import ClickHouseHistoricalClient


def _client():
    return ClickHouseHistoricalClient(url="http://clickhouse:8123", database="historical")


class TestExecute(TestCase):
    @patch("requests.post")
    def test_posts_statement_with_expected_params(self, post_request):
        client = _client()
        response = Mock(ok=True, text="")
        post_request.return_value = response

        client.execute("CREATE DATABASE IF NOT EXISTS historical")

        (url,), kwargs = post_request.call_args
        self.assertEqual(url, "http://clickhouse:8123")
        self.assertEqual(kwargs["data"], b"CREATE DATABASE IF NOT EXISTS historical")
        self.assertEqual(
            kwargs["params"],
            {"user": "default", "password": "", "database": "historical", "default_format": "JSON"},
        )

    @patch("requests.post")
    def test_raises_on_non_ok_response(self, post_request):
        client = _client()
        post_request.return_value = Mock(ok=False, text="Code: 60. Table doesn't exist")

        with self.assertRaises(Exception):
            client.execute("SELECT 1")

    @patch("requests.post")
    def test_wraps_connection_errors(self, post_request):
        client = _client()
        post_request.side_effect = requests.ConnectionError("boom")

        with self.assertRaises(Exception):
            client.execute("SELECT 1")


class TestQueryJson(TestCase):
    @patch("requests.post")
    def test_appends_format_json_and_parses_response(self, post_request):
        client = _client()
        payload = {"meta": [{"name": "name", "type": "String"}], "data": [{"name": "speed"}]}
        post_request.return_value = Mock(ok=True, text=json.dumps(payload))

        result = client.query_json("SELECT name FROM system.columns")

        (_,), kwargs = post_request.call_args
        self.assertTrue(kwargs["data"].decode("utf-8").endswith("FORMAT JSON"))
        self.assertEqual(result, payload)

    @patch("requests.post")
    def test_raises_on_exception_field(self, post_request):
        client = _client()
        post_request.return_value = Mock(ok=True, text=json.dumps({"exception": "Code: 60"}))

        with self.assertRaises(Exception):
            client.query_json("SELECT 1")

    @patch("requests.post")
    def test_empty_response_body(self, post_request):
        client = _client()
        post_request.return_value = Mock(ok=True, text="")

        result = client.query_json("SELECT 1 WHERE 0")

        self.assertEqual(result, {"meta": [], "data": []})


class TestGetColumns(TestCase):
    @patch("requests.post")
    def test_returns_none_when_table_missing(self, post_request):
        client = _client()
        post_request.return_value = Mock(ok=True, text=json.dumps({"meta": [], "data": []}))

        self.assertIsNone(client.get_columns("historical.q_foo_1"))

    @patch("requests.post")
    def test_returns_column_map_when_table_exists(self, post_request):
        client = _client()
        payload = {"data": [{"name": "speed", "type": "Nullable(Float64)"}, {"name": "captured_at", "type": "DateTime64(3, 'UTC')"}]}
        post_request.return_value = Mock(ok=True, text=json.dumps(payload))

        columns = client.get_columns("historical.q_foo_1")

        self.assertEqual(columns, {"speed": "Nullable(Float64)", "captured_at": "DateTime64(3, 'UTC')"})


class TestInsertJsonEachRow(TestCase):
    @patch("requests.post")
    def test_builds_newline_delimited_body(self, post_request):
        client = _client()
        post_request.return_value = Mock(ok=True, text="")

        client.insert_jsoneachrow("historical.q_foo_1", [{"a": 1}, {"a": 2}])

        (_,), kwargs = post_request.call_args
        body = kwargs["data"].decode("utf-8")
        self.assertEqual(body, 'INSERT INTO historical.q_foo_1 FORMAT JSONEachRow\n{"a": 1}\n{"a": 2}')

    @patch("requests.post")
    def test_noop_on_empty_rows(self, post_request):
        client = _client()

        client.insert_jsoneachrow("historical.q_foo_1", [])

        post_request.assert_not_called()

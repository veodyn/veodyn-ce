from unittest.mock import MagicMock, patch

from redash import settings
from redash.historical import shape_cache
from redash.historical.tasks import _capture_query_result, capture_query_result
from redash.utils.configuration import ConfigurationContainer
from tests import BaseTestCase


def _mock_client(existing_columns=None):
    client = MagicMock()
    client.get_columns.return_value = existing_columns
    return client


class TestCaptureQueryResult(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.data_source = self.factory.create_data_source(
            options=ConfigurationContainer.from_json('{"dbname": "test", "enable_historical_capture": true}')
        )
        self.query = self.factory.create_query(data_source=self.data_source)
        self.query_result = self.factory.create_query_result(
            data_source=self.data_source,
            data={
                "columns": [{"name": "speed", "type": "float"}, {"name": "vehicle_id", "type": "string"}],
                "rows": [{"speed": 12.5, "vehicle_id": "bus-1"}],
            },
        )

    def test_loop_guard_skips_historical_data_source(self):
        client = _mock_client()
        with patch.object(settings, "HISTORICAL_DATA_SOURCE_ID", self.data_source.id):
            _capture_query_result(self.query_result.id, self.data_source.id, self.query.id, client=client)
        client.get_columns.assert_not_called()

    def test_noop_when_capture_globally_disabled(self):
        client = _mock_client()
        with patch.object(settings, "HISTORICAL_CLICKHOUSE_URL", ""):
            _capture_query_result(self.query_result.id, self.data_source.id, self.query.id, client=client)
        client.get_columns.assert_not_called()

    def test_noop_when_query_id_missing(self):
        client = _mock_client()
        with patch.object(settings, "HISTORICAL_CLICKHOUSE_URL", "http://clickhouse:8123"):
            _capture_query_result(self.query_result.id, self.data_source.id, None, client=client)
        client.get_columns.assert_not_called()

    def test_first_capture_creates_table_then_inserts(self):
        client = _mock_client(existing_columns=None)
        client.query_json.return_value = {"data": []}  # catalog lookup: no existing row

        with patch.object(settings, "HISTORICAL_CLICKHOUSE_URL", "http://clickhouse:8123"):
            _capture_query_result(self.query_result.id, self.data_source.id, self.query.id, client=client)

        create_calls = [
            c for c in client.execute.call_args_list if "CREATE TABLE IF NOT EXISTS historical.q_" in c.args[0]
        ]
        self.assertEqual(len(create_calls), 1)
        self.assertIn("`speed` Nullable(Float64)", create_calls[0].args[0])
        self.assertIn("`vehicle_id` Nullable(String)", create_calls[0].args[0])
        # Called twice: once to register the new catalog row, once for the data rows.
        self.assertEqual(client.insert_jsoneachrow.call_count, 2)
        table_name, rows = client.insert_jsoneachrow.call_args.args
        self.assertEqual(rows[0]["speed"], 12.5)
        self.assertEqual(rows[0]["vehicle_id"], "bus-1")
        self.assertEqual(rows[0]["query_id"], self.query.id)

    def test_fast_path_skips_ddl_when_shape_cached(self):
        client = _mock_client(existing_columns={"speed": "Nullable(Float64)", "vehicle_id": "Nullable(String)"})
        client.query_json.return_value = {"data": [{"table_name": "historical.q_query_1"}]}
        shape_cache.set_cached_shape(self.query.id, frozenset({"speed", "vehicle_id"}))

        with patch.object(settings, "HISTORICAL_CLICKHOUSE_URL", "http://clickhouse:8123"):
            _capture_query_result(self.query_result.id, self.data_source.id, self.query.id, client=client)

        client.get_columns.assert_not_called()
        client.insert_jsoneachrow.assert_called_once()

    def test_drift_triggers_add_column_then_updates_cache(self):
        client = _mock_client(existing_columns={"speed": "Nullable(Float64)"})
        client.query_json.return_value = {"data": [{"table_name": "historical.q_query_1"}]}
        shape_cache.set_cached_shape(self.query.id, frozenset({"speed"}))

        with patch.object(settings, "HISTORICAL_CLICKHOUSE_URL", "http://clickhouse:8123"):
            _capture_query_result(self.query_result.id, self.data_source.id, self.query.id, client=client)

        alter_calls = [c for c in client.execute.call_args_list if "ADD COLUMN" in c.args[0]]
        self.assertEqual(len(alter_calls), 1)
        self.assertIn("`vehicle_id`", alter_calls[0].args[0])
        self.assertEqual(shape_cache.get_cached_shape(self.query.id), frozenset({"speed", "vehicle_id"}))

    def test_capture_query_result_swallows_exceptions_and_records_statsd(self):
        with patch("redash.historical.tasks._build_client", side_effect=RuntimeError("boom")):
            with patch("redash.historical.tasks.statsd_client") as statsd_client:
                capture_query_result(self.query_result.id, self.data_source.id, self.query.id)
                statsd_client.incr.assert_called_once_with("historical.capture.errors")

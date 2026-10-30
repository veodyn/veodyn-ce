from unittest import TestCase
from unittest.mock import MagicMock

from redash.historical import catalog


def _client_with_lookup(existing_table_name=None, database="historical"):
    client = MagicMock()
    client.database = database
    client.query_json.return_value = (
        {"data": [{"table_name": existing_table_name}]} if existing_table_name else {"data": []}
    )
    return client


class TestGetOrCreateTableName(TestCase):
    def test_first_capture_creates_catalog_row_with_slug_and_id_suffix(self):
        client = _client_with_lookup(existing_table_name=None)

        table_name = catalog.get_or_create_table_name(
            client, query_id=142, query_name="GTFS Vehicle Positions", data_source_id=3
        )

        self.assertEqual(table_name, "historical.q_gtfs_vehicle_positions_142")
        client.execute.assert_any_call("CREATE DATABASE IF NOT EXISTS historical")
        insert_call = client.insert_jsoneachrow.call_args
        table_arg, rows_arg = insert_call.args
        self.assertEqual(table_arg, "historical._catalog")
        self.assertEqual(rows_arg[0]["query_id"], 142)
        self.assertEqual(rows_arg[0]["table_name"], "historical.q_gtfs_vehicle_positions_142")
        self.assertEqual(rows_arg[0]["data_source_id"], 3)

    def test_second_capture_returns_existing_name_unchanged_even_after_rename(self):
        client = _client_with_lookup(existing_table_name="historical.q_gtfs_vehicle_positions_142")

        table_name = catalog.get_or_create_table_name(
            client, query_id=142, query_name="Renamed Query Title", data_source_id=3
        )

        self.assertEqual(table_name, "historical.q_gtfs_vehicle_positions_142")
        client.insert_jsoneachrow.assert_not_called()

    def test_a_configured_database_holds_the_catalog_and_every_table(self):
        client = _client_with_lookup(existing_table_name=None, database="historical_stage")

        table_name = catalog.get_or_create_table_name(
            client, query_id=1, query_name="Bike Share Stations", data_source_id=2
        )

        self.assertEqual(table_name, "historical_stage.q_bike_share_stations_1")
        client.execute.assert_any_call("CREATE DATABASE IF NOT EXISTS historical_stage")
        statements = [c.args[0] for c in client.execute.call_args_list]
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS historical_stage._catalog" in s for s in statements))
        self.assertIn("FROM historical_stage._catalog FINAL", client.query_json.call_args.args[0])
        self.assertEqual(client.insert_jsoneachrow.call_args.args[0], "historical_stage._catalog")

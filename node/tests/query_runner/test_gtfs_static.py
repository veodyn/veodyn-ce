"""Static GTFS query runner: table discovery, table reads, projection, filters and caps.

Transport and archive bounds live in test_gtfs_static_archive.py.
"""

import json
from unittest import TestCase
from unittest.mock import patch

import jsonschema

from redash.query_runner.gtfs_static import GtfsStatic
from redash.query_runner.gtfs_static_tables import MAX_ROWS_CEILING
from tests.query_runner.gtfs_static_fixtures import (
    STOPS,
    BoundedLines,
    build_archive,
    column_types,
    run_query,
)


class TestListResource(TestCase):
    def test_no_resource_lists_the_tables(self):
        data, error, _get = run_query("{}")
        self.assertIsNone(error)
        by_table = {row["table"]: row for row in data["rows"]}
        self.assertEqual(sorted(by_table), ["routes", "stops", "trips"])

    def test_explicit_list_resource_lists_the_tables(self):
        data, error, _get = run_query('{"resource": "list"}')
        self.assertIsNone(error)
        self.assertEqual(sorted(row["table"] for row in data["rows"]), ["routes", "stops", "trips"])

    def test_row_count_counts_data_rows_not_the_header(self):
        data, error, _get = run_query('{"resource": "list"}')
        self.assertIsNone(error)
        by_table = {row["table"]: row for row in data["rows"]}
        self.assertEqual(by_table["stops"]["row_count"], 2)
        self.assertEqual(by_table["trips"]["row_count"], 4)
        self.assertEqual(column_types(data)["row_count"], "integer")

    def test_columns_are_a_json_array_of_header_names(self):
        data, error, _get = run_query('{"resource": "list"}')
        self.assertIsNone(error)
        by_table = {row["table"]: row for row in data["rows"]}
        self.assertEqual(
            json.loads(by_table["stops"]["columns"]),
            ["stop_id", "stop_name", "stop_lat", "stop_lon"],
        )

    def test_a_nested_member_is_named_by_its_basename_and_mac_metadata_is_skipped(self):
        body = build_archive({"feed/stops.txt": STOPS, "__MACOSX/feed/._stops.txt": "junk", "feed/notes.md": "x"})
        data, error, _get = run_query('{"resource": "list"}', body=body)
        self.assertIsNone(error)
        self.assertEqual([row["table"] for row in data["rows"]], ["stops"])
        self.assertEqual(data["rows"][0]["row_count"], 2)

    def test_an_unknown_resource_is_rejected_without_fetching(self):
        data, error, get = run_query('{"resource": "stops"}')
        self.assertIsNone(data)
        self.assertIn("Unknown resource 'stops'", error)
        get.assert_not_called()


class TestTableRead(TestCase):
    def test_rows_come_back_with_guessed_column_types(self):
        data, error, _get = run_query('{"table": "stops"}')
        self.assertIsNone(error)
        self.assertEqual(
            [column["name"] for column in data["columns"]],
            ["stop_id", "stop_name", "stop_lat", "stop_lon"],
        )
        self.assertEqual(column_types(data)["stop_lat"], "float")
        self.assertEqual(column_types(data)["stop_lon"], "float")
        self.assertEqual(data["rows"][0]["stop_lat"], 34.0562)
        self.assertEqual(data["rows"][0]["stop_lon"], -118.2365)
        self.assertEqual(len(data["rows"]), 2)

    def test_a_numeric_column_that_is_not_an_id_is_typed_and_converted(self):
        data, error, _get = run_query('{"table": "routes"}')
        self.assertIsNone(error)
        self.assertEqual(column_types(data)["route_type"], "integer")
        self.assertEqual(data["rows"][0]["route_type"], 3)

    def test_a_utf8_bom_does_not_end_up_in_the_first_column_name(self):
        data, error, _get = run_query('{"table": "stops"}', body=build_archive(bom=True))
        self.assertIsNone(error)
        self.assertEqual(data["columns"][0]["name"], "stop_id")
        self.assertEqual(data["rows"][0]["stop_id"], "S1")

    def test_a_header_only_table_still_reports_its_columns(self):
        body = build_archive({"stops.txt": "stop_id,stop_name\n"})
        data, error, _get = run_query('{"table": "stops"}', body=body)
        self.assertIsNone(error)
        self.assertEqual([column["name"] for column in data["columns"]], ["stop_id", "stop_name"])
        self.assertEqual(data["rows"], [])

    def test_an_empty_value_reads_as_null(self):
        body = build_archive({"stops.txt": "stop_id,stop_code\nS1,\n"})
        data, error, _get = run_query('{"table": "stops"}', body=body)
        self.assertIsNone(error)
        self.assertIsNone(data["rows"][0]["stop_code"])

    def test_an_unknown_table_names_the_available_ones(self):
        data, error, _get = run_query('{"table": "shapes"}')
        self.assertIsNone(data)
        self.assertIn("Unknown table 'shapes'", error)
        self.assertIn("routes, stops, trips", error)


class TestProjection(TestCase):
    def test_columns_projects_and_keeps_the_requested_order(self):
        data, error, _get = run_query('{"table": "stops", "columns": ["stop_lat", "stop_id"]}')
        self.assertIsNone(error)
        self.assertEqual([column["name"] for column in data["columns"]], ["stop_lat", "stop_id"])
        self.assertEqual(data["rows"][0], {"stop_lat": 34.0562, "stop_id": "S1"})

    def test_an_unknown_column_names_it_and_the_available_ones(self):
        data, error, _get = run_query('{"table": "stops", "columns": ["stop_id", "platform"]}')
        self.assertIsNone(data)
        self.assertIn("Unknown column 'platform'", error)
        self.assertIn("stops", error)
        self.assertIn("stop_lat", error)


class TestFilter(TestCase):
    def test_a_single_value_filters_by_equality(self):
        data, error, _get = run_query('{"table": "trips", "filter": {"route_id": "12"}}')
        self.assertIsNone(error)
        self.assertEqual([row["trip_id"] for row in data["rows"]], ["t1", "t3"])

    def test_a_list_of_values_matches_any_of_them(self):
        # The list excludes the two WD trips and names one service that is not
        # in the feed, so a runner treating any list as a wildcard fails here.
        data, error, _get = run_query('{"table": "trips", "filter": {"service_id": ["SU", "HOL"]}}')
        self.assertIsNone(error)
        self.assertEqual([row["trip_id"] for row in data["rows"]], ["t3", "t4"])

    def test_several_keys_and_together(self):
        data, error, _get = run_query('{"table": "trips", "filter": {"route_id": "14", "service_id": "SU"}}')
        self.assertIsNone(error)
        self.assertEqual([row["trip_id"] for row in data["rows"]], ["t4"])

    def test_values_are_compared_as_strings(self):
        # route_type is an integer column, and the filter value arrives from
        # JSON as a number.
        data, error, _get = run_query('{"table": "routes", "filter": {"route_type": 3}}')
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 2)

    def test_a_filter_matching_nothing_returns_no_rows_rather_than_an_error(self):
        data, error, _get = run_query('{"table": "trips", "filter": {"route_id": "99"}}')
        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])

    def test_a_filter_on_a_column_the_table_does_not_have_matches_nothing(self):
        # Including the empty string, which is what a missing field reads as
        # once it has been defaulted.
        for value in ('"12"', '""'):
            with self.subTest(value=value):
                data, error, _get = run_query('{"table": "trips", "filter": {"platform": %s}}' % value)
                self.assertIsNone(error)
                self.assertEqual(data["rows"], [])

    def test_filtering_for_the_empty_string_matches_only_genuinely_empty_fields(self):
        body = build_archive({"stops.txt": "stop_id,stop_code\nS1,\nS2,7\n"})
        data, error, _get = run_query('{"table": "stops", "filter": {"stop_code": ""}}', body=body)
        self.assertIsNone(error)
        self.assertEqual([row["stop_id"] for row in data["rows"]], ["S1"])


class TestRowCap(TestCase):
    def test_max_rows_caps_the_result_and_flags_it_truncated(self):
        data, error, _get = run_query('{"table": "trips"}', config={"max_rows": 2})
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 2)
        self.assertTrue(data["truncated"])

    def test_an_uncapped_result_carries_no_truncated_flag(self):
        data, error, _get = run_query('{"table": "trips"}', config={"max_rows": 4})
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 4)
        self.assertNotIn("truncated", data)

    def test_the_cap_applies_after_filtering(self):
        # trips has four rows and only two match. A cap counted before the
        # filter reaches 2 on the fourth row and flags a truncation that did
        # not happen; counted after, the two matches fit exactly.
        data, error, _get = run_query(
            '{"table": "trips", "filter": {"route_id": "12"}}',
            config={"max_rows": 2},
        )
        self.assertIsNone(error)
        self.assertEqual([row["trip_id"] for row in data["rows"]], ["t1", "t3"])
        self.assertNotIn("truncated", data)


class TestMaxRowsConfiguration(TestCase):
    def test_an_absent_cap_falls_back_to_the_default(self):
        data, error, _get = run_query('{"table": "trips"}')
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 4)

    def test_a_whole_number_written_as_a_string_is_accepted(self):
        data, error, _get = run_query('{"table": "trips"}', config={"max_rows": "2"})
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 2)

    def test_zero_is_a_configuration_error_not_a_silent_default(self):
        data, error, _get = run_query('{"table": "trips"}', config={"max_rows": 0})
        self.assertIsNone(data)
        self.assertIn("max_rows", error)

    def test_a_negative_cap_is_a_configuration_error_not_an_empty_result(self):
        data, error, _get = run_query('{"table": "trips"}', config={"max_rows": -5})
        self.assertIsNone(data)
        self.assertIn("max_rows", error)

    def test_a_fractional_cap_is_rejected_rather_than_floored(self):
        data, error, _get = run_query('{"table": "trips"}', config={"max_rows": 2.5})
        self.assertIsNone(data)
        self.assertIn("max_rows", error)

    def test_a_non_numeric_cap_is_rejected(self):
        data, error, _get = run_query('{"table": "trips"}', config={"max_rows": "lots"})
        self.assertIsNone(data)
        self.assertIn("max_rows", error)

    def test_a_cap_over_the_ceiling_is_rejected(self):
        data, error, _get = run_query('{"table": "trips"}', config={"max_rows": MAX_ROWS_CEILING + 1})
        self.assertIsNone(data)
        self.assertIn(str(MAX_ROWS_CEILING), error)

    def test_a_bad_cap_is_reported_before_the_archive_is_fetched(self):
        _data, _error, get = run_query('{"table": "trips"}', config={"max_rows": 0})
        get.assert_not_called()


class TestStreaming(TestCase):
    def test_the_cap_stops_the_read_instead_of_slicing_a_materialized_table(self):
        # Four data rows, a cap of two: the reader must stop one row past the
        # cap (which is what proves the truncation) and never reach the fourth.
        lines = [
            "route_id,service_id,trip_id\n",
            "12,WD,t1\n",
            "14,WD,t2\n",
            "12,SU,t3\n",
            "14,SU,t4\n",
        ]
        source = BoundedLines(lines, limit=4)
        with patch("redash.query_runner.gtfs_static.open_table", return_value=source):
            data, error, _get = run_query('{"table": "trips"}', config={"max_rows": 2})
        self.assertIsNone(error)
        self.assertEqual([row["trip_id"] for row in data["rows"]], ["t1", "t2"])
        self.assertTrue(data["truncated"])
        self.assertEqual(source.read, 4)


class TestRegistration(TestCase):
    def test_type_and_name(self):
        self.assertEqual(GtfsStatic.type(), "gtfs_static")
        self.assertEqual(GtfsStatic.name(), "Static GTFS")

    def test_it_ships_in_the_default_runner_list(self):
        from redash import settings

        self.assertIn("redash.query_runner.gtfs_static", settings.default_query_runners)

    def test_the_configuration_schema_requires_the_url_and_carries_historical_capture(self):
        schema = GtfsStatic.configuration_schema()
        self.assertEqual(schema["required"], ["gtfs_url"])
        self.assertEqual(schema["properties"]["gtfs_url"]["minLength"], 1)
        self.assertEqual(schema["properties"]["max_rows"]["default"], 100000)
        # enable_historical_capture is added by the central helper, not by
        # this runner's own configuration_schema(), so check the served path.
        self.assertIn("enable_historical_capture", GtfsStatic.to_dict()["configuration_schema"]["properties"])

    def test_the_schema_rejects_a_bad_cap_at_save_time(self):
        # redash/utils/configuration.py validates a data source's configuration
        # with exactly this call, so a fractional cap has to fail here and not
        # only in the runner. max_rows stays type number: the app's form maps
        # number and not integer (app/src/components/forms/schema-fields.ts).
        schema = GtfsStatic.configuration_schema()
        self.assertEqual(schema["properties"]["max_rows"]["type"], "number")
        jsonschema.validate({"gtfs_url": "https://transit.invalid/g.zip", "max_rows": 2}, schema)
        for bad in (2.5, 0, -1, MAX_ROWS_CEILING + 1):
            with self.subTest(value=bad):
                with self.assertRaises(jsonschema.ValidationError):
                    jsonschema.validate({"gtfs_url": "https://transit.invalid/g.zip", "max_rows": bad}, schema)
        self.assertEqual(schema["properties"]["max_rows"]["default"], 100000)

from unittest import TestCase
from unittest.mock import patch

from redash.query_runner.tods import TODS
from redash.query_runner.tods_merge import merge_supplement
from tests.query_runner.gtfs_realtime_fixtures import fake_response
from tests.query_runner.gtfs_static_fixtures import (
    ROUTES,
    STOPS,
    TRIPS,
    build_archive,
    column_types,
)

TODS_URL = "https://ops.example.org/tods/feed.zip"
GTFS_URL = "https://transit.example.org/gtfs/feed.zip"

RUN_EVENTS = (
    "service_id,run_id,event_sequence,piece_id,block_id,event_type,trip_id,start_location,start_time,end_location,end_time\n"
    "WD,r1,0,,b1,pull_out,,GAR,05:30:00,S1,05:50:00\n"
    "WD,r1,1,,b1,revenue trip,t1,S1,05:50:00,S2,06:30:00\n"
    "WD,r1,2,,b1,layover,,S2,06:30:00,S2,06:40:00\n"
)
VEHICLES = "vehicle_id,vehicle_type\n101,40ft bus\n102,40ft bus\n"
VEHICLE_ASSIGNMENTS = "date,service_id,block_id,vehicle_id\n20260908,WD,b1,101\n20260908,WD,b2,102\n"
TRIPS_SUPPLEMENT = (
    "trip_id,route_id,service_id,block_id,TODS_trip_type,TODS_delete\n"
    "t1,,,b1,,\n"
    "t2,,,,,1\n"
    "dh1,12,WD,b1,deadhead,\n"
    "ghost,,,,,1\n"
)
STOP_TIMES = "trip_id,stop_sequence,stop_id,arrival_time\nt1,1,S1,05:50:00\nt1,2,S2,06:30:00\n"
STOP_TIMES_SUPPLEMENT = (
    "trip_id,stop_sequence,stop_id,arrival_time,TODS_delete\nt1,2,,06:32:00,\ndh1,1,GAR,05:30:00,\n"
)

TODS_MEMBERS = {
    "run_events.txt": RUN_EVENTS,
    "vehicles.txt": VEHICLES,
    "vehicle_assignments.txt": VEHICLE_ASSIGNMENTS,
    "trips_supplement.txt": TRIPS_SUPPLEMENT,
    "stop_times_supplement.txt": STOP_TIMES_SUPPLEMENT,
}
GTFS_MEMBERS = {"stops.txt": STOPS, "routes.txt": ROUTES, "trips.txt": TRIPS, "stop_times.txt": STOP_TIMES}


def run_query(query, tods=None, gtfs=None, config=None):
    bodies = {TODS_URL: build_archive(TODS_MEMBERS if tods is None else tods)}
    if gtfs is not False:
        bodies[GTFS_URL] = build_archive(GTFS_MEMBERS if gtfs is None else gtfs)
    configuration = {"tods_url": TODS_URL, **({} if gtfs is False else {"gtfs_url": GTFS_URL}), **(config or {})}
    runner = TODS(configuration)
    with patch("redash.query_runner.gtfs_static.requests.get") as get:
        get.side_effect = lambda url, **kwargs: fake_response(bodies[url])
        data, error = runner.run_query(query, None)
    return data, error, get


class TestRawTables(TestCase):
    def test_list_names_every_table_in_the_tods_archive(self):
        data, error, _get = run_query('{"resource": "list"}')
        self.assertIsNone(error)
        self.assertEqual(
            [row["table"] for row in data["rows"]],
            ["run_events", "stop_times_supplement", "trips_supplement", "vehicle_assignments", "vehicles"],
        )

    def test_run_events_serve_with_gtfs_typing(self):
        data, error, _get = run_query('{"table": "run_events"}')
        self.assertIsNone(error)
        types = column_types(data)
        self.assertEqual(types["event_sequence"], "integer")
        self.assertEqual(types["run_id"], "string")
        self.assertEqual(types["start_time"], "string")
        self.assertEqual(data["rows"][1]["event_type"], "revenue trip")
        self.assertEqual(data["rows"][0]["trip_id"], None)

    def test_vehicle_assignments_filter_by_date_as_a_string(self):
        data, error, _get = run_query(
            '{"table": "vehicle_assignments", "filter": {"date": "20260908", "block_id": "b2"}}'
        )
        self.assertIsNone(error)
        self.assertEqual([row["vehicle_id"] for row in data["rows"]], ["102"])

    def test_a_supplement_reads_raw_with_its_tods_columns(self):
        data, error, _get = run_query('{"table": "trips_supplement"}')
        self.assertIsNone(error)
        self.assertIn("TODS_delete", column_types(data))
        self.assertEqual(data["rows"][1]["TODS_delete"], 1)

    def test_an_unconfigured_archive_url_fails_before_any_request(self):
        runner = TODS({"gtfs_url": GTFS_URL})
        with patch("redash.query_runner.gtfs_static.requests.get") as get:
            data, error = runner.run_query('{"resource": "list"}', None)
        self.assertIsNone(data)
        self.assertIn("tods_url", error)
        get.assert_not_called()


class TestMergedReads(TestCase):
    def test_trips_merged_updates_deletes_and_appends(self):
        data, error, _get = run_query('{"table": "trips", "merged": true}')
        self.assertIsNone(error)
        by_trip = {row["trip_id"]: row for row in data["rows"]}
        self.assertEqual(list(by_trip), ["t1", "t3", "t4", "dh1"])
        self.assertEqual(by_trip["t1"]["block_id"], "b1")
        self.assertEqual(by_trip["t1"]["route_id"], "12")
        self.assertEqual(by_trip["dh1"]["TODS_trip_type"], "deadhead")
        self.assertEqual(by_trip["dh1"]["route_id"], "12")
        self.assertEqual(by_trip["t3"]["TODS_trip_type"], None)

    def test_the_delete_marker_is_not_a_column_of_the_merged_table(self):
        data, error, _get = run_query('{"table": "trips", "merged": true}')
        self.assertIsNone(error)
        names = [column["name"] for column in data["columns"]]
        self.assertEqual(names, ["route_id", "service_id", "trip_id", "block_id", "TODS_trip_type"])

    def test_stop_times_merge_on_the_composite_key(self):
        data, error, _get = run_query('{"table": "stop_times", "merged": true}')
        self.assertIsNone(error)
        rows = {(row["trip_id"], row["stop_sequence"]): row for row in data["rows"]}
        self.assertEqual(rows[("t1", 2)]["arrival_time"], "06:32:00")
        self.assertEqual(rows[("t1", 2)]["stop_id"], "S2")
        self.assertEqual(rows[("dh1", 1)]["stop_id"], "GAR")
        self.assertEqual(len(rows), 3)

    def test_a_base_table_without_a_supplement_reads_through_unchanged(self):
        data, error, _get = run_query('{"table": "routes", "merged": true}')
        self.assertIsNone(error)
        self.assertEqual([row["route_id"] for row in data["rows"]], ["12", "14"])

    def test_merged_filter_columns_and_cap_apply_after_the_merge(self):
        query = '{"table": "trips", "merged": true, "filter": {"block_id": "b1"}, "columns": ["trip_id", "TODS_trip_type"]}'
        data, error, _get = run_query(query, config={"max_rows": 1})
        self.assertIsNone(error)
        self.assertEqual([column["name"] for column in data["columns"]], ["trip_id", "TODS_trip_type"])
        self.assertEqual(data["rows"], [{"trip_id": "t1", "TODS_trip_type": None}])
        self.assertTrue(data["truncated"])

    def test_a_merged_read_needs_the_base_gtfs_url(self):
        data, error, _get = run_query('{"table": "trips", "merged": true}', gtfs=False)
        self.assertIsNone(data)
        self.assertIn("base GTFS archive URL", error)

    def test_a_supplement_for_a_table_tods_does_not_define_is_refused(self):
        tods = dict(TODS_MEMBERS, **{"agency_supplement.txt": "agency_id,agency_name\na,Renamed\n"})
        gtfs = {"agency.txt": "agency_id,agency_name\na,A\n"}
        data, error, _get = run_query('{"table": "agency", "merged": true}', tods=tods, gtfs=gtfs)
        self.assertIsNone(data)
        self.assertIn("no supplement for table 'agency'", error)

    def test_a_base_table_missing_from_the_gtfs_archive_is_named(self):
        data, error, _get = run_query('{"table": "calendar", "merged": true}')
        self.assertIsNone(data)
        self.assertIn("Unknown base GTFS table 'calendar'", error)

    def test_both_archives_are_fetched_with_the_configured_timeout(self):
        _data, _error, get = run_query('{"table": "trips", "merged": true}', config={"request_timeout": 7})
        self.assertEqual([call.args[0] for call in get.call_args_list], [TODS_URL, GTFS_URL])
        self.assertTrue(all(call.kwargs["timeout"] == 7 for call in get.call_args_list))


class TestMergeRules(TestCase):
    def test_a_blank_supplement_value_keeps_the_base_value(self):
        header, rows = merge_supplement(
            "stops",
            ["stop_id", "stop_name"],
            [{"stop_id": "S1", "stop_name": "Union"}],
            ["stop_id", "stop_name", "TODS_location_type"],
            [{"stop_id": "S1", "stop_name": "", "TODS_location_type": "garage"}],
        )
        self.assertEqual(header, ["stop_id", "stop_name", "TODS_location_type"])
        self.assertEqual(rows, [{"stop_id": "S1", "stop_name": "Union", "TODS_location_type": "garage"}])

    def test_a_delete_row_carrying_other_values_still_deletes(self):
        _header, rows = merge_supplement(
            "stops",
            ["stop_id", "stop_name"],
            [{"stop_id": "S1", "stop_name": "Union"}, {"stop_id": "S2", "stop_name": "7th"}],
            ["stop_id", "stop_name", "TODS_delete"],
            [{"stop_id": "S1", "stop_name": "Renamed", "TODS_delete": "1"}],
        )
        self.assertEqual([row["stop_id"] for row in rows], ["S2"])

    def test_a_delete_of_an_unknown_key_is_ignored(self):
        _header, rows = merge_supplement(
            "routes",
            ["route_id"],
            [{"route_id": "12"}],
            ["route_id", "TODS_delete"],
            [{"route_id": "99", "TODS_delete": "1"}],
        )
        self.assertEqual([row["route_id"] for row in rows], ["12"])

    def test_a_supplement_missing_its_key_column_is_refused(self):
        with self.assertRaises(ValueError) as caught:
            merge_supplement("stop_times", ["trip_id", "stop_sequence"], [], ["trip_id", "arrival_time"], [])
        self.assertIn("stop_sequence", str(caught.exception))

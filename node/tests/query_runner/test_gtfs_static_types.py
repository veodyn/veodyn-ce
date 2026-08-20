"""What type each GTFS column comes back as, and what the values are coerced to.

The type is merged across every value the query returns, so a column cannot
declare one type and hand back a value of another.
"""

from unittest import TestCase

from tests.query_runner.gtfs_static_fixtures import (
    build_archive,
    column_types,
    run_query,
)


class TestGuessedTypes(TestCase):
    def test_a_numeric_column_that_is_not_an_id_is_typed_and_converted(self):
        data, error, _get = run_query('{"table": "routes"}')
        self.assertIsNone(error)
        self.assertEqual(column_types(data)["route_type"], "integer")
        self.assertEqual(data["rows"][0]["route_type"], 3)

    def test_numeric_looking_ids_stay_strings(self):
        # route_id "12" guesses as an integer, and coercing it would strip a
        # leading zero and break the join against the realtime feed's string
        # route_id.
        data, error, _get = run_query('{"table": "routes"}')
        self.assertIsNone(error)
        self.assertEqual(column_types(data)["route_id"], "string")
        self.assertEqual(data["rows"][0]["route_id"], "12")

    def test_a_stop_name_that_parses_as_a_date_stays_a_string(self):
        # guess_type reads "7th St" and "3rd St" as datetimes, so an unmapped
        # guess types a column of ordinary stop names as timestamps. Every value
        # here is one of those: a single plain name would demote the column to
        # string through the merge and hide the mapping.
        body = build_archive({"stops.txt": "stop_id,stop_name\nS2,7th St\nS3,3rd St\n"})
        data, error, _get = run_query('{"table": "stops"}', body=body)
        self.assertIsNone(error)
        self.assertEqual(column_types(data)["stop_name"], "string")
        self.assertEqual([row["stop_name"] for row in data["rows"]], ["7th St", "3rd St"])


class TestMergedTypes(TestCase):
    def test_an_integer_column_is_promoted_to_float_by_a_later_fractional_value(self):
        # GTFS distance fields start at 0 and grow fractional, so reading the
        # type off the first value alone declares integer and then hands the
        # later values back as strings under it.
        body = build_archive({"stop_times.txt": "trip_id,shape_dist_traveled\nt1,0\nt2,34.5\n"})
        data, error, _get = run_query('{"table": "stop_times"}', body=body)
        self.assertIsNone(error)
        self.assertEqual(column_types(data)["shape_dist_traveled"], "float")
        self.assertEqual([row["shape_dist_traveled"] for row in data["rows"]], [0.0, 34.5])

    def test_the_promotion_also_runs_the_other_way_round(self):
        body = build_archive({"stop_times.txt": "trip_id,shape_dist_traveled\nt1,34.5\nt2,7\n"})
        data, error, _get = run_query('{"table": "stop_times"}', body=body)
        self.assertIsNone(error)
        self.assertEqual(column_types(data)["shape_dist_traveled"], "float")
        self.assertEqual([row["shape_dist_traveled"] for row in data["rows"]], [34.5, 7.0])

    def test_a_column_with_one_unparseable_value_falls_back_to_string(self):
        body = build_archive({"stop_times.txt": "trip_id,shape_dist_traveled\nt1,12\nt2,unknown\n"})
        data, error, _get = run_query('{"table": "stop_times"}', body=body)
        self.assertIsNone(error)
        self.assertEqual(column_types(data)["shape_dist_traveled"], "string")
        self.assertEqual([row["shape_dist_traveled"] for row in data["rows"]], ["12", "unknown"])

    def test_a_boolean_column_mixed_with_a_number_falls_back_to_string(self):
        body = build_archive({"stop_times.txt": "trip_id,timepoint\nt1,true\nt2,0\n"})
        data, error, _get = run_query('{"table": "stop_times"}', body=body)
        self.assertIsNone(error)
        self.assertEqual(column_types(data)["timepoint"], "string")
        self.assertEqual([row["timepoint"] for row in data["rows"]], ["true", "0"])

    def test_an_empty_value_does_not_drag_a_typed_column_to_string(self):
        body = build_archive({"stop_times.txt": "trip_id,shape_dist_traveled\nt1,\nt2,34.5\n"})
        data, error, _get = run_query('{"table": "stop_times"}', body=body)
        self.assertIsNone(error)
        self.assertEqual(column_types(data)["shape_dist_traveled"], "float")
        self.assertEqual([row["shape_dist_traveled"] for row in data["rows"]], [None, 34.5])

    def test_the_type_is_merged_over_the_returned_rows_only(self):
        # The cap keeps the read bounded, so the declared type describes the
        # rows that came back rather than rows nobody was sent.
        body = build_archive({"stop_times.txt": "trip_id,shape_dist_traveled\nt1,0\nt2,1\nt3,2.5\n"})
        data, error, _get = run_query('{"table": "stop_times"}', body=body, config={"max_rows": 2})
        self.assertIsNone(error)
        self.assertEqual(column_types(data)["shape_dist_traveled"], "integer")
        self.assertEqual([row["shape_dist_traveled"] for row in data["rows"]], [0, 1])

import importlib
import os
import sqlite3
from unittest import TestCase

import mock
import pytest

from redash import settings
from redash.query_runner.query_results import (
    ExtensionLoadingError,
    Results,
    load_spatialite,
)
from tests import BaseTestCase

SQUARE = '{"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]}'
SQUARE_WITH_HOLE = (
    '{"type": "Polygon", "coordinates": ['
    "[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], "
    "[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]}"
)
TWO_SQUARES = (
    '{"type": "MultiPolygon", "coordinates": ['
    "[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]], "
    "[[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]]]}"
)
# Longitude range and latitude range do not overlap, so swapping MakePoint's
# arguments moves the point out of the polygon.
FAR_EAST_STRIP = '{"type": "Polygon", "coordinates": [[[100, 0], [110, 0], [110, 10], [100, 10], [100, 0]]]}'


def spatialite_available():
    """Probe the library directly, never through load_spatialite: a broken helper
    must fail the tests that cover it rather than skip them."""
    connection = sqlite3.connect(":memory:")
    try:
        connection.enable_load_extension(True)
        connection.load_extension(os.environ.get("REDASH_SPATIALITE_LIBRARY_PATH", "mod_spatialite"))
        connection.enable_load_extension(False)
        return True
    except (AttributeError, sqlite3.Error):
        return False
    finally:
        connection.close()


requires_spatialite = pytest.mark.skipif(not spatialite_available(), reason="mod_spatialite could not be loaded")


class RecordingConnection:
    """Stands in for a sqlite3 connection to record what load_spatialite does to it."""

    def __init__(self):
        self.enable_calls = []
        self.loaded = []
        self.closed = False

    def enable_load_extension(self, enabled):
        self.enable_calls.append(enabled)

    def load_extension(self, library):
        self.loaded.append(library)

    def close(self):
        self.closed = True


class DisableFailsConnection(RecordingConnection):
    def enable_load_extension(self, enabled):
        super().enable_load_extension(enabled)
        if not enabled:
            raise sqlite3.OperationalError("cannot disable extension loading")


def run(query):
    data, error = Results({}).run_query(query, None)
    assert error is None
    return data["rows"]


def within(point_sql, geojson):
    rows = run("SELECT ST_Within({}, GeomFromGeoJSON('{}')) AS inside".format(point_sql, geojson))
    return rows[0]["inside"]


@requires_spatialite
class TestSpatialPredicates(TestCase):
    def test_point_inside_a_polygon_is_within(self):
        self.assertEqual(1, within("MakePoint(5, 5)", SQUARE))

    def test_point_outside_a_polygon_is_not_within(self):
        self.assertEqual(0, within("MakePoint(50, 50)", SQUARE))

    def test_point_in_a_hole_is_not_within(self):
        self.assertEqual(1, within("MakePoint(1, 1)", SQUARE_WITH_HOLE))
        self.assertEqual(0, within("MakePoint(5, 5)", SQUARE_WITH_HOLE))

    def test_point_in_the_second_polygon_of_a_multipolygon_is_within(self):
        self.assertEqual(1, within("MakePoint(11, 11)", TWO_SQUARES))

    def test_makepoint_takes_longitude_before_latitude(self):
        rows = run(
            "SELECT 105 AS lon, 5 AS lat, "
            "ST_Within(MakePoint(105, 5), GeomFromGeoJSON('{geo}')) AS lon_first, "
            "ST_Within(MakePoint(5, 105), GeomFromGeoJSON('{geo}')) AS lat_first".format(geo=FAR_EAST_STRIP)
        )
        self.assertEqual(1, rows[0]["lon_first"])
        self.assertEqual(0, rows[0]["lat_first"])

    def test_geojson_geometry_survives_a_round_trip_through_a_column(self):
        rows = run("SELECT GeometryType(GeomFromGeoJSON('{}')) AS kind".format(SQUARE))
        self.assertEqual("POLYGON", rows[0]["kind"])


@requires_spatialite
class TestPlainSqlWithSpatialiteLoaded(TestCase):
    def test_ordinary_query_is_unaffected(self):
        data, error = Results({}).run_query("SELECT 1 AS n, 'x' AS s, 2.5 AS f", None)

        self.assertIsNone(error)
        self.assertEqual([{"n": 1, "s": "x", "f": 2.5}], data["rows"])
        self.assertEqual(["n", "s", "f"], [column["name"] for column in data["columns"]])

    def test_query_returning_no_data_still_reports_it(self):
        data, error = Results({}).run_query("CREATE TABLE t (a)", None)

        self.assertIsNone(data)
        self.assertEqual("Query completed but it returned no data.", error)


@requires_spatialite
class TestSpatialJoinAcrossQueries(BaseTestCase):
    def boundaries(self):
        result = self.factory.create_query_result(
            data={
                "columns": [{"name": "name"}, {"name": "geometry"}],
                "rows": [
                    {
                        "name": "North",
                        "geometry": '{"type": "Polygon", "coordinates": '
                        "[[[0, 10], [10, 10], [10, 20], [0, 20], [0, 10]]]}",
                    },
                    {"name": "South", "geometry": SQUARE},
                ],
            }
        )
        return self.factory.create_query(latest_query_data=result)

    def stops(self):
        result = self.factory.create_query_result(
            data={
                "columns": [{"name": "stop_id"}, {"name": "stop_lon"}, {"name": "stop_lat"}],
                "rows": [
                    {"stop_id": "a", "stop_lon": 5.0, "stop_lat": 5.0},
                    {"stop_id": "b", "stop_lon": 6.0, "stop_lat": 6.0},
                    {"stop_id": "c", "stop_lon": 5.0, "stop_lat": 15.0},
                    {"stop_id": "d", "stop_lon": 90.0, "stop_lat": 90.0},
                ],
            }
        )
        return self.factory.create_query(latest_query_data=result)

    def test_counts_points_per_boundary(self):
        boundaries = self.boundaries()
        stops = self.stops()

        query = (
            "SELECT b.name AS district, COUNT(*) AS stops "
            "FROM cached_query_{b} b JOIN cached_query_{s} s "
            "  ON ST_Within(MakePoint(s.stop_lon, s.stop_lat), GeomFromGeoJSON(b.geometry)) "
            "GROUP BY b.name ORDER BY b.name"
        ).format(b=boundaries.id, s=stops.id)

        data, error = Results({}).run_query(query, self.factory.user)

        self.assertIsNone(error)
        self.assertEqual(
            [{"district": "North", "stops": 1}, {"district": "South", "stops": 2}],
            data["rows"],
        )

    def test_plain_cross_query_sql_is_unaffected(self):
        stops = self.stops()

        query = "SELECT COUNT(*) AS n FROM cached_query_{s} WHERE stop_lat > 5".format(s=stops.id)
        data, error = Results({}).run_query(query, self.factory.user)

        self.assertIsNone(error)
        self.assertEqual([{"n": 3}], data["rows"])


class TestExtensionLoadingIsDisabledAgain(TestCase):
    # "not authorized" is the refusal. With loading left enabled SQLite reports a
    # dlopen failure instead, having already tried to open the named library.
    def test_runner_refuses_load_extension_in_sql(self):
        with pytest.raises(sqlite3.OperationalError, match="not authorized"):
            Results({}).run_query("SELECT load_extension('anything')", None)

    def test_helper_leaves_loading_disabled(self):
        connection = sqlite3.connect(":memory:")
        try:
            load_spatialite(connection)
            with pytest.raises(sqlite3.OperationalError, match="not authorized"):
                connection.execute("SELECT load_extension('anything')")
        finally:
            connection.close()

    def test_loading_is_disabled_even_when_the_library_is_missing(self):
        connection = sqlite3.connect(":memory:")
        try:
            with mock.patch.object(settings, "SPATIALITE_LIBRARY_PATH", "/nonexistent/mod_nothing"):
                load_spatialite(connection)
            with pytest.raises(sqlite3.OperationalError, match="not authorized"):
                connection.execute("SELECT load_extension('anything')")
        finally:
            connection.close()

    def test_enable_and_disable_bracket_the_load(self):
        connection = RecordingConnection()

        with mock.patch.object(settings, "SPATIALITE_LIBRARY_PATH", "/some/where/mod_spatialite.so"):
            self.assertTrue(load_spatialite(connection))

        self.assertEqual([True, False], connection.enable_calls)
        self.assertEqual(["/some/where/mod_spatialite.so"], connection.loaded)


class TestFailureToDisableIsFatal(TestCase):
    def test_helper_discards_the_connection_and_raises(self):
        connection = DisableFailsConnection()

        with pytest.raises(ExtensionLoadingError):
            load_spatialite(connection)

        self.assertTrue(connection.closed)

    def test_runner_never_reaches_user_sql(self):
        connection = DisableFailsConnection()

        with mock.patch("redash.query_runner.query_results.sqlite3.connect", return_value=connection):
            with pytest.raises(ExtensionLoadingError):
                Results({}).run_query("SELECT 1", None)

        self.assertTrue(connection.closed)


class TestGracefulDegradation(TestCase):
    def test_plain_query_still_runs_without_the_library(self):
        with mock.patch.object(settings, "SPATIALITE_LIBRARY_PATH", "/nonexistent/mod_nothing"):
            with self.assertLogs("redash.query_runner.query_results", level="WARNING") as logs:
                data, error = Results({}).run_query("SELECT 1 AS n", None)

        self.assertIsNone(error)
        self.assertEqual([{"n": 1}], data["rows"])
        self.assertEqual(1, len(logs.output))
        self.assertIn("/nonexistent/mod_nothing", logs.output[0])

    def test_load_failure_reports_not_loaded(self):
        connection = sqlite3.connect(":memory:")
        try:
            with mock.patch.object(settings, "SPATIALITE_LIBRARY_PATH", "/nonexistent/mod_nothing"):
                with self.assertLogs("redash.query_runner.query_results", level="WARNING"):
                    self.assertFalse(load_spatialite(connection))
        finally:
            connection.close()


class TestSpatialiteLibrarySetting(TestCase):
    def reload_settings(self):
        importlib.reload(settings)

    def test_defaults_to_the_os_resolver_name(self):
        original = os.environ.pop("REDASH_SPATIALITE_LIBRARY_PATH", None)
        try:
            self.reload_settings()
            self.assertEqual("mod_spatialite", settings.SPATIALITE_LIBRARY_PATH)
        finally:
            if original is not None:
                os.environ["REDASH_SPATIALITE_LIBRARY_PATH"] = original
            self.reload_settings()

    def test_environment_variable_overrides_the_default(self):
        original = os.environ.get("REDASH_SPATIALITE_LIBRARY_PATH")
        os.environ["REDASH_SPATIALITE_LIBRARY_PATH"] = "/opt/somewhere/mod_spatialite.so"
        try:
            self.reload_settings()
            self.assertEqual("/opt/somewhere/mod_spatialite.so", settings.SPATIALITE_LIBRARY_PATH)
            connection = RecordingConnection()
            load_spatialite(connection)
            self.assertEqual(["/opt/somewhere/mod_spatialite.so"], connection.loaded)
        finally:
            if original is None:
                os.environ.pop("REDASH_SPATIALITE_LIBRARY_PATH", None)
            else:
                os.environ["REDASH_SPATIALITE_LIBRARY_PATH"] = original
            self.reload_settings()

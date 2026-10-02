"""
Fixture-backed SQL test for the "Live join" query documented in
docs/docs/connectors.md's Caltrans ATMS worked example: joins the static
segment layer (as `StaticGeoJSON._feature_to_row` actually shapes it) to a
live `readings` row (as `caltrans_atms_rows.reading_row` actually shapes
it) over a `results` data source, the same harness
test_query_results_spatial.py::TestSpatialJoinAcrossQueries uses for the
non-spatial "Spatial joins across query results" example.

This exists because the design spec's own join SQL
(docs/superpowers/specs/2026-09-23-freeway-speed-segments-design.md,
"Live join") references `seg.vds_id_from`/`seg.route`/`seg.direction` as if
they were lifted top-level columns. They are not: `_feature_to_row` lifts
only `id`/`line`/`name`/`mode`/`color`, so everything the geometry builder
puts in a feature's `properties` travels as a JSON string column instead.
The corrected query, using SQLite's built-in `json_extract` (no SpatiaLite
needed, the join key is an exact id, not a spatial predicate), is what
docs/docs/connectors.md actually documents, and what this test proves runs.
"""

import json
from datetime import datetime, timezone

from redash.query_runner.caltrans_atms_rows import reading_row
from redash.query_runner.query_results import Results
from redash.query_runner.static_geojson import StaticGeoJSON
from tests import BaseTestCase

SEGMENT_FEATURE = {
    "type": "Feature",
    "properties": {
        "id": "v1__v2",
        "vds_id_from": "v1",
        "vds_id_to": "v2",
        "route": "5",
        "direction": "N",
        "postmile_start": 10.0,
        "postmile_end": 20.0,
    },
    "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
}

JOIN_SQL = """
SELECT
  seg.geometry AS geometry,
  CASE r.status
    WHEN 'ok' THEN
      CASE
        WHEN r.speed_mph >= 36 THEN '#2e7d32'
        WHEN r.speed_mph >= 21 THEN '#f9a825'
        ELSE '#c62828'
      END
    ELSE '#9e9e9e'
  END AS color,
  json_extract(seg.properties, '$.route') || ' ' || json_extract(seg.properties, '$.direction') AS name,
  r.speed_mph, r.status, r.observed_at
FROM cached_query_{seg} seg
JOIN cached_query_{r} r
  ON r.vds_id = json_extract(seg.properties, '$.vds_id_from')
"""


class TestCaltransATMSLiveJoin(BaseTestCase):
    def _segment_row(self):
        # Built through the real StaticGeoJSON row-shaping code, not a
        # hand-typed guess at its output, so this test breaks if that
        # shaping ever changes.
        runner = StaticGeoJSON({"data_path": "/unused"})
        return runner._feature_to_row("caltrans_d7_vds_segments", SEGMENT_FEATURE)

    def _reading_row(self, color_code, speed):
        raw = {"vds_id": "v1", "color_code": color_code, "speed": str(speed), "volume": "5", "good_lanes": "100"}
        return reading_row(raw, datetime(2026, 9, 23, 12, 0, tzinfo=timezone.utc))

    def _segments_query(self):
        row = self._segment_row()
        result = self.factory.create_query_result(data={"columns": [{"name": name} for name in row], "rows": [row]})
        return self.factory.create_query(latest_query_data=result)

    def _readings_query(self, color_code, speed):
        row = self._reading_row(color_code, speed)
        result = self.factory.create_query_result(data={"columns": [{"name": name} for name in row], "rows": [row]})
        return self.factory.create_query(latest_query_data=result)

    def _run(self, color_code, speed):
        seg = self._segments_query()
        r = self._readings_query(color_code, speed)
        query = JOIN_SQL.format(seg=seg.id, r=r.id)
        data, error = Results({}).run_query(query, self.factory.user)
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)
        return data["rows"][0]

    def test_green_for_a_fast_ok_reading(self):
        self.assertEqual(self._run("2", 62)["color"], "#2e7d32")

    def test_yellow_for_a_moderate_ok_reading(self):
        self.assertEqual(self._run("3", 25)["color"], "#f9a825")

    def test_red_for_a_slow_ok_reading(self):
        self.assertEqual(self._run("1", 15)["color"], "#c62828")

    def test_gray_for_no_data_regardless_of_the_raw_speed_value(self):
        # color_code 0 is undocumented -> no_data, even though a raw speed
        # value came through; the gray fallback must not be fooled by it.
        self.assertEqual(self._run("0", 62)["color"], "#9e9e9e")

    def test_name_is_route_and_direction_read_out_of_the_json_properties_column(self):
        self.assertEqual(self._run("2", 62)["name"], "5 N")

    def test_geometry_column_round_trips_as_a_geojson_string(self):
        row = self._run("2", 62)
        geometry = json.loads(row["geometry"])
        self.assertEqual(geometry, SEGMENT_FEATURE["geometry"])

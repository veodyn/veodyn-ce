import json
from unittest import TestCase

import jsonschema
import pytest

from redash.query_runner.static_geojson import StaticGeoJSON


class TestDataPathIsRequired(TestCase):
    """
    data_path used to fall back to the connector's own geo_data/ directory,
    which deliberately ships no layers: a data source created with the
    advertised default failed on an unconditional open of a missing
    manifest.json. It must now be required, with no default, so that gap is
    caught at save time instead.
    """

    def test_data_path_is_required_with_no_default(self):
        schema = StaticGeoJSON.configuration_schema()
        self.assertIn("data_path", schema["required"])
        self.assertNotIn("default", schema["properties"]["data_path"])

    def test_empty_data_path_fails_schema_validation(self):
        schema = StaticGeoJSON.configuration_schema()
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate({"data_path": ""}, schema)

    def test_missing_data_path_fails_schema_validation(self):
        schema = StaticGeoJSON.configuration_schema()
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate({}, schema)

SAMPLE_FEATURE_COLLECTION = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "id": "sample-1",
                "name": "Sample Feature",
                "line": "X_Line",
                "mode": "rail",
                "color": "#123456",
            },
            "geometry": {"type": "MultiLineString", "coordinates": [[[0, 0], [1, 1]]]},
        }
    ],
}


def test_reads_layers_from_the_configured_directory(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps({"sample": {"title": "Sample", "file": "sample.geojson"}}))
    (tmp_path / "sample.geojson").write_text(json.dumps(SAMPLE_FEATURE_COLLECTION))

    runner = StaticGeoJSON({"data_path": str(tmp_path)})
    data, error = runner.run_query('{"layers": ["sample"]}', None)

    assert error is None
    assert data["rows"][0]["layer"] == "sample"


def _feature(feature_id, line, name, mode, color, coords):
    return {
        "type": "Feature",
        "properties": {"id": feature_id, "line": line, "name": name, "mode": mode, "color": color},
        "geometry": {"type": "MultiLineString", "coordinates": coords},
    }


RAIL_FEATURES = [
    _feature("rail-1", "A_Line", "A Line", "rail", "#0000FF", [[[0, 0], [1, 1]]]),
    _feature("rail-2", "B_Line", "B Line", "rail", "#FF0000", [[[1, 1], [2, 2]]]),
    _feature("rail-3", "C_Line", "C Line", "rail", "#00FF00", [[[2, 2], [3, 3]]]),
]

BUS_FEATURES = [
    _feature("bus-1", "G_Line", "G Line", "bus", "#00FFFF", [[[0, 0], [1, 0]]]),
    _feature("bus-2", "H_Line", "H Line", "bus", "#FF9900", [[[1, 0], [2, 0]]]),
]

# The manifest maps each layer id directly to its metadata; this is the same
# shape as the real, staged manifest, not a list of layer objects.
MANIFEST = {
    "rail_lines": {
        "file": "rail_lines.geojson",
        "title": "Sample Rail Lines",
        "geometry": "MultiLineString",
        "group": "rail",
        "properties": ["id", "line", "name", "mode", "color"],
    },
    "bus_lines": {
        "file": "bus_lines.geojson",
        "title": "Sample Bus Lines",
        "geometry": "MultiLineString",
        "group": "bus",
        "properties": ["id", "line", "name", "mode", "color"],
    },
}


def _write_feature_collection(path, filename, features):
    (path / filename).write_text(json.dumps({"type": "FeatureCollection", "features": features}))


class TestStaticGeoJSON(TestCase):
    @pytest.fixture(autouse=True)
    def _inject_tmp_path(self, tmp_path):
        self.tmp_path = tmp_path
        yield

    def setUp(self):
        (self.tmp_path / "manifest.json").write_text(json.dumps(MANIFEST))
        _write_feature_collection(self.tmp_path, "rail_lines.geojson", RAIL_FEATURES)
        _write_feature_collection(self.tmp_path, "bus_lines.geojson", BUS_FEATURES)
        self.runner = StaticGeoJSON({"data_path": str(self.tmp_path)})

    def run_query(self, query):
        return self.runner.run_query(query, None)

    def test_list_resource(self):
        data, error = self.run_query('{"resource": "list"}')
        self.assertIsNone(error)
        layers = {r["layer"]: r for r in data["rows"]}
        self.assertIn("rail_lines", layers)
        self.assertIn("bus_lines", layers)
        self.assertEqual(layers["rail_lines"]["feature_count"], 3)
        self.assertEqual(layers["bus_lines"]["feature_count"], 2)

    def test_rows_mode_default(self):
        data, error = self.run_query('{"layers": ["rail_lines"]}')
        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(len(rows), 3)
        names = [c["name"] for c in data["columns"]]
        for expected in ("layer", "feature_id", "line", "color", "geometry_type", "geometry", "bbox"):
            self.assertIn(expected, names)
        a = next(r for r in rows if r["line"] == "A_Line")
        self.assertEqual(a["layer"], "rail_lines")
        self.assertEqual(a["color"], "#0000FF")
        self.assertEqual(a["geometry_type"], "MultiLineString")
        # geometry is a JSON string that parses back to a geometry object
        geom = json.loads(a["geometry"])
        self.assertEqual(geom["type"], "MultiLineString")
        self.assertTrue(geom["coordinates"])
        # bbox is [minLng, minLat, maxLng, maxLat]
        bbox = json.loads(a["bbox"])
        self.assertEqual(len(bbox), 4)
        self.assertLess(bbox[0], bbox[2])
        self.assertLess(bbox[1], bbox[3])

    def test_multi_layer_union_with_layer_column(self):
        data, error = self.run_query('{"layers": ["rail_lines", "bus_lines"]}')
        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(len(rows), 5)
        by_layer = {}
        for r in rows:
            by_layer.setdefault(r["layer"], 0)
            by_layer[r["layer"]] += 1
        self.assertEqual(by_layer, {"rail_lines": 3, "bus_lines": 2})

    def test_property_filter(self):
        data, error = self.run_query('{"layers": ["rail_lines"], "filter": {"line": ["A_Line", "B_Line"]}}')
        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual({r["line"] for r in rows}, {"A_Line", "B_Line"})

    def test_scalar_filter_value(self):
        data, error = self.run_query('{"layers": ["bus_lines"], "filter": {"line": "G_Line"}}')
        self.assertIsNone(error)
        self.assertEqual([r["line"] for r in data["rows"]], ["G_Line"])

    def test_featurecollection_mode(self):
        data, error = self.run_query('{"layers": ["rail_lines"], "format": "featurecollection"}')
        self.assertIsNone(error)
        self.assertEqual([c["name"] for c in data["columns"]], ["geojson"])
        self.assertEqual(len(data["rows"]), 1)
        fc = json.loads(data["rows"][0]["geojson"])
        self.assertEqual(fc["type"], "FeatureCollection")
        self.assertEqual(len(fc["features"]), 3)
        # each feature carries its source layer
        self.assertEqual(fc["features"][0]["properties"]["layer"], "rail_lines")

    def test_default_layers_when_omitted(self):
        data, error = self.run_query("{}")
        self.assertIsNone(error)
        # both layers unioned: 3 rail + 2 bus
        self.assertEqual(len(data["rows"]), 5)

    def test_unknown_layer_error(self):
        data, error = self.run_query('{"layers": ["does_not_exist"]}')
        self.assertIsNone(data)
        self.assertIn("Unknown layer", error)

    def test_invalid_json(self):
        data, error = self.run_query("not json")
        self.assertIsNone(data)
        self.assertIn("Invalid query JSON", error)

    def test_get_schema_lists_datasets(self):
        schema = self.runner.get_schema()
        names = " ".join(entry["name"] for entry in schema)
        self.assertIn("rail_lines", names)
        self.assertIn("bus_lines", names)
        self.assertIn("__ Query Examples __", names)

    def test_old_list_shaped_manifest_is_rejected_clearly(self):
        # The list-plus-"id" shape was a false start; a manifest written in
        # that shape must fail loudly, not with a bare KeyError and not with
        # a silently empty layer set.
        bad_dir = self.tmp_path / "list-shaped-manifest"
        bad_dir.mkdir()
        (bad_dir / "manifest.json").write_text(
            json.dumps({"layers": [{"id": "sample", "title": "Sample", "file": "sample.geojson"}]})
        )
        (bad_dir / "sample.geojson").write_text(json.dumps(SAMPLE_FEATURE_COLLECTION))

        bad_runner = StaticGeoJSON({"data_path": str(bad_dir)})

        with self.assertRaises(Exception) as ctx:
            bad_runner.run_query('{"resource": "list"}', None)

        self.assertNotIsInstance(ctx.exception, KeyError)
        self.assertIn("manifest.json", str(ctx.exception))
        self.assertIn("layers", str(ctx.exception))

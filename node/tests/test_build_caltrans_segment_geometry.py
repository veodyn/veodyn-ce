"""
Exercises bin/build_caltrans_segment_geometry.py's join/concatenation logic
and its output format against the static_geojson schema it must match.

The script is not a package, so it is loaded here by file path with
importlib, the same way tests/test_report_data_source_types.py loads its
sibling bin/ script. It has no redash import and no database dependency at
all, everything except the round-trip test below runs standalone.

Fixture coordinates are on a 0.01-degree grid (~1.1km per step) rather than
whole degrees, because build_features now grounds every match in real
distance from the station pair (see TestSpatialSanity below): a fixture
written in whole-degree steps would put its own "adjacent" stations ~157km
apart and fail the very check meant to catch that shape of error live.
"""

import importlib.util
import json
import os

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(_REPO_ROOT, "bin", f"{name}.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = _load("build_caltrans_segment_geometry")
matching = _load("caltrans_segment_matching")


def _shn_feature(route, direction, begin, end, coords):
    return {
        "type": "Feature",
        "properties": {"route": route, "direction": direction, "begin_postmile": begin, "end_postmile": end},
        "geometry": {"type": "LineString", "coordinates": coords},
    }


SHN_FEATURES = {
    "type": "FeatureCollection",
    "features": [
        _shn_feature("5", "N", 5, 15, [[0, 0], [0.01, 0.01]]),
        _shn_feature("5", "N", 15, 25, [[0.01, 0.01], [0.02, 0.02]]),
        _shn_feature("5", "N", 25, 35, [[0.02, 0.02], [0.03, 0.03]]),
        # Same route and postmile range, opposite direction: must never be
        # selected for a northbound pair.
        _shn_feature("5", "S", 5, 25, [[0, 0.01], [0.02, 0.03]]),
    ],
}

# Near enough to any of SHN_FEATURES' "N" segments to pass the spatial check;
# only the direction/postmile filters are what these particular tests probe.
NEAR_MIDPOINT = (0.005, 0.005)


def _write_json(path, data):
    with open(path, "w") as fh:
        json.dump(data, fh)


class TestSortBeforePair:
    def test_stations_are_paired_in_postmile_order_not_input_order(self, tmp_path):
        # Deliberately out of order: the prior riits_tiles experiment's
        # export_vds_segments_geojson_pairs paired adjacent rows of an
        # UNSORTED list; this must sort by postmile within (route,
        # direction) before pairing.
        stations = [
            {"vds_id": "v3", "route": "5", "direction": "N", "postmile": 30.0, "lon": 0.02, "lat": 0.02},
            {"vds_id": "v1", "route": "5", "direction": "N", "postmile": 10.0, "lon": 0.0, "lat": 0.0},
            {"vds_id": "v2", "route": "5", "direction": "N", "postmile": 20.0, "lon": 0.01, "lat": 0.01},
        ]
        shn_path = tmp_path / "shn.geojson"
        _write_json(shn_path, SHN_FEATURES)

        shn_by_route = matching.index_shn_lines(str(shn_path))
        features, skipped = builder.build_features(stations, shn_by_route)

        assert skipped == []
        pairs = {(f["properties"]["vds_id_from"], f["properties"]["vds_id_to"]) for f in features}
        assert pairs == {("v1", "v2"), ("v2", "v3")}


class TestSegmentConcatenation:
    def test_adjacent_segments_join_into_one_continuous_linestring(self, tmp_path):
        shn_path = tmp_path / "shn.geojson"
        _write_json(shn_path, SHN_FEATURES)
        shn_by_route = matching.index_shn_lines(str(shn_path))

        stations = [
            {"vds_id": "v1", "route": "5", "direction": "N", "postmile": 10.0, "lon": 0.0, "lat": 0.0},
            {"vds_id": "v2", "route": "5", "direction": "N", "postmile": 20.0, "lon": 0.01, "lat": 0.01},
        ]
        features, skipped = builder.build_features(stations, shn_by_route)

        assert skipped == []
        assert len(features) == 1
        assert features[0]["geometry"]["coordinates"] == [[0, 0], [0.01, 0.01], [0.02, 0.02]]

    def test_a_reversed_source_segment_is_re_oriented_to_stay_continuous(self):
        # The source data's own coordinate order is not assumed to already
        # run start-to-end along the route.
        selected = [
            {"lo": 5, "hi": 15, "direction": "N", "coords": [[0, 0], [1, 1]]},
            {"lo": 15, "hi": 25, "direction": "N", "coords": [[2, 2], [1, 1]]},  # reversed on disk
        ]
        assert builder.concatenate_segments(selected) == [[0, 0], [1, 1], [2, 2]]

    def test_multilinestring_geometry_is_flattened(self):
        geometry = {"type": "MultiLineString", "coordinates": [[[0, 0], [1, 1]], [[1, 1], [2, 2]]]}
        assert matching._line_coordinates(geometry) == [[0, 0], [1, 1], [1, 1], [2, 2]]


class TestDirectionMatching:
    def test_the_opposite_direction_segment_is_never_selected(self, tmp_path):
        shn_path = tmp_path / "shn.geojson"
        _write_json(shn_path, SHN_FEATURES)
        shn_by_route = matching.index_shn_lines(str(shn_path))

        selected = matching.select_shn_segments(shn_by_route, "5", "N", 10, 20, NEAR_MIDPOINT)
        assert all(seg["direction"] == "N" for seg in selected)

    def test_a_direction_less_input_falls_back_to_route_and_postmile_only(self, tmp_path):
        shn_path = tmp_path / "shn.geojson"
        _write_json(
            shn_path,
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"route": "5", "begin_postmile": 5, "end_postmile": 25},
                        "geometry": {"type": "LineString", "coordinates": [[0, 0], [0.01, 0.01]]},
                    }
                ],
            },
        )
        shn_by_route = matching.index_shn_lines(str(shn_path))
        selected = matching.select_shn_segments(shn_by_route, "5", "N", 10, 20, NEAR_MIDPOINT)
        assert len(selected) == 1


class TestNoFabrication:
    def test_a_pair_with_no_matching_shn_segment_is_skipped_not_a_straight_line(self):
        stations = [
            {"vds_id": "x1", "route": "99", "direction": "N", "postmile": 1.0, "lon": 0.0, "lat": 0.0},
            {"vds_id": "x2", "route": "99", "direction": "N", "postmile": 2.0, "lon": 0.01, "lat": 0.01},
        ]
        features, skipped = builder.build_features(stations, {})
        assert features == []
        assert skipped == [("x1", "x2", "99", "N")]


class TestSpatialSanity:
    """
    The defect caught live: two D7 stations 0.03 postmile apart on US-101
    matched a SHN segment near Ventura, and the concatenation jumped 90km to
    a same-numbered stretch near downtown LA before returning, because
    US-101's postmile numbering resets/duplicates along its length (county
    lines, PMPrefix realignments: see the module docstring). Route,
    direction and postmile overlap all agreed; only the stations' own real
    coordinates, which that filter never consults, could have caught it.
    """

    def _shn_lines(self, tmp_path, far_coords):
        shn_path = tmp_path / "shn.geojson"
        _write_json(
            shn_path,
            {
                "type": "FeatureCollection",
                "features": [
                    # Genuinely near the stations below, and overlapping their
                    # postmile range (0.16 to 0.19, matching the live case).
                    _shn_feature("101", "N", 0, 1, [[0, 0], [0.01, 0.01]]),
                    # Same route, direction and an overlapping postmile range,
                    # but tens of km away: a duplicate postmile number on a
                    # different stretch of the same route.
                    _shn_feature("101", "N", 0, 1, far_coords),
                ],
            },
        )
        return matching.index_shn_lines(str(shn_path))

    def test_a_same_postmile_segment_far_from_the_stations_is_rejected(self, tmp_path):
        # 1 degree apart, ~150km: far past MAX_SEGMENT_DISTANCE_KM.
        shn_by_route = self._shn_lines(tmp_path, [[1, 1], [1.01, 1.01]])
        selected = matching.select_shn_segments(shn_by_route, "101", "N", 0.16, 0.19, (0.005, 0.005))
        assert selected == [{"lo": 0, "hi": 1, "direction": "N", "coords": [[0, 0], [0.01, 0.01]]}]

    def test_a_genuinely_nearby_segment_still_matches(self, tmp_path):
        # Both candidates are close this time: both must survive.
        shn_by_route = self._shn_lines(tmp_path, [[0.001, 0], [0.011, 0.01]])
        selected = matching.select_shn_segments(shn_by_route, "101", "N", 0.16, 0.19, (0.005, 0.005))
        assert len(selected) == 2

    def test_the_defect_reproduced_end_to_end_through_build_features(self, tmp_path):
        shn_by_route = self._shn_lines(tmp_path, [[1, 1], [1.01, 1.01]])
        stations = [
            {"vds_id": "a", "route": "101", "direction": "N", "postmile": 0.16, "lon": 0.0, "lat": 0.0},
            {"vds_id": "b", "route": "101", "direction": "N", "postmile": 0.19, "lon": 0.01, "lat": 0.01},
        ]
        features, skipped = builder.build_features(stations, shn_by_route)

        assert skipped == []
        assert len(features) == 1
        coords = features[0]["geometry"]["coordinates"]
        # The whole point: no vertex belongs to the far-away duplicate.
        assert coords == [[0, 0], [0.01, 0.01]]


class TestRouteNormalization:
    def test_a_zero_padded_gis_route_matches_a_plain_integer_station_route(self, tmp_path):
        shn_path = tmp_path / "shn.geojson"
        _write_json(
            shn_path,
            {
                "type": "FeatureCollection",
                "features": [_shn_feature("005", "N", 5, 25, [[0, 0], [0.01, 0.01]])],
            },
        )
        shn_by_route = matching.index_shn_lines(str(shn_path))

        # The station side (webinit.txt) never zero-pads.
        selected = matching.select_shn_segments(shn_by_route, "5", "N", 10, 20, NEAR_MIDPOINT)
        assert len(selected) == 1

    def test_a_non_numeric_route_id_falls_back_to_a_stripped_string(self):
        assert matching.normalize_route(" 5 ") == "5"
        assert matching.normalize_route("SR-2") == "SR-2"


class TestPropertyAliases:
    def test_common_caltrans_field_name_spellings_are_recognized(self):
        feature = {"properties": {"Route": "10", "Dir": "S", "BPM": "1", "EPM": "2"}}
        assert matching._prop(feature, "route") == "10"
        assert matching._prop(feature, "direction") == "S"
        assert matching._prop(feature, "begin_postmile") == "1"
        assert matching._prop(feature, "end_postmile") == "2"


class TestOutputFormat:
    def test_manifest_matches_the_static_geojson_layout(self, tmp_path):
        out_dir = tmp_path / "out"
        manifest = builder.write_output(str(out_dir), "caltrans_d7_vds_segments", "Caltrans D7 VDS segments", [])

        assert manifest == {
            "caltrans_d7_vds_segments": {
                "file": "caltrans_d7_vds_segments.geojson",
                "title": "Caltrans D7 VDS segments",
                "geometry": "LineString",
                "group": "freeway",
                "properties": ["id", "route", "direction"],
            }
        }
        assert (out_dir / "manifest.json").exists()
        assert (out_dir / "caltrans_d7_vds_segments.geojson").exists()

    def test_output_round_trips_through_static_geojson(self, tmp_path):
        # Format drift here would otherwise only be discovered at render
        # time, against the design spec's Testing section.
        from redash.query_runner.static_geojson import StaticGeoJSON

        shn_path = tmp_path / "shn.geojson"
        _write_json(shn_path, SHN_FEATURES)
        shn_by_route = matching.index_shn_lines(str(shn_path))
        stations = [
            {"vds_id": "v1", "route": "5", "direction": "N", "postmile": 10.0, "lon": 0.0, "lat": 0.0},
            {"vds_id": "v2", "route": "5", "direction": "N", "postmile": 20.0, "lon": 0.01, "lat": 0.01},
        ]
        features, _skipped = builder.build_features(stations, shn_by_route)
        out_dir = tmp_path / "out"
        builder.write_output(str(out_dir), "caltrans_d7_vds_segments", "Caltrans D7 VDS segments", features)

        runner = StaticGeoJSON({"data_path": str(out_dir)})
        manifest = runner._load_manifest()
        assert "caltrans_d7_vds_segments" in manifest

        loaded = runner._load_layer("caltrans_d7_vds_segments")
        row = runner._feature_to_row("caltrans_d7_vds_segments", loaded["features"][0])
        assert row["feature_id"] == "v1__v2"
        assert row["geometry_type"] == "LineString"

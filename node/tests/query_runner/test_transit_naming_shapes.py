from unittest import TestCase

from redash.transit_naming.gtfs_routes import read_snapshot
from redash.transit_naming.gtfs_shapes import simplify
from tests.query_runner.transit_naming_gtfs_fixtures import BUS_MEMBERS, build_archive

NONFINITE_SHAPES = (
    "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
    "bad,34.0,nan,1\n"
    "bad,34.1,-118.0,2\n"
    "worse,inf,-118.0,1\n"
    "worse,34.0,-118.0,2\n"
    "mixed,34.0,-118.0,1\n"
    "mixed,-inf,-118.0,2\n"
    "mixed,34.2,-118.1,3\n"
)


class TestSimplify(TestCase):
    def test_a_point_beyond_the_segment_end_is_kept(self):
        points = [(-118.0, 34.0), (-117.98, 34.0), (-117.99, 34.0)]
        self.assertEqual(simplify(points), points)

    def test_collinear_points_inside_the_segment_are_dropped(self):
        points = [(-118.0, 34.0), (-117.9, 34.0), (-117.8, 34.0)]
        self.assertEqual(simplify(points), [points[0], points[2]])

    def test_coincident_endpoints_still_keep_a_far_point(self):
        points = [(-118.0, 34.0), (-117.0, 34.0), (-118.0, 34.0)]
        self.assertEqual(simplify(points), points)


class TestShapeReading(TestCase):
    def test_nonfinite_coordinates_are_not_read(self):
        content = build_archive({**BUS_MEMBERS, "shapes.txt": NONFINITE_SHAPES})
        shapes = read_snapshot("bus", content, "https://example.org/gtfs.zip", True, True).shapes
        self.assertEqual(shapes.get("bad", []), [(2, 34.1, -118.0)])
        self.assertEqual(shapes.get("worse", []), [(2, 34.0, -118.0)])
        self.assertEqual(shapes["mixed"], [(1, 34.0, -118.0), (3, 34.2, -118.1)])

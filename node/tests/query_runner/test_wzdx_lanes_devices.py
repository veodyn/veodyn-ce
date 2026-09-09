import json
from unittest import TestCase

from tests.query_runner.wzdx_fixtures import (
    ARROW_BOARD,
    DEVICE_URL,
    FEED_URL,
    LANED,
    SEQUENCED,
    WORK_ZONE_FEED,
    rows_by_id,
    run,
)


class TestLanes(TestCase):
    def test_lanes_serve_one_row_per_lane_per_event(self):
        data, error, _get = run('{"resource": "lanes"}')
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 5)
        first = data["rows"][0]
        self.assertEqual(first["road_event_id"], LANED["id"])
        self.assertEqual(first["order"], 1)
        self.assertEqual(first["type"], "general")
        self.assertEqual(json.loads(first["restrictions"])[0]["type"], "reduced-width")
        self.assertEqual(data["rows"][1]["restrictions"], None)

    def test_lanes_filter_by_status(self):
        data, error, _get = run('{"resource": "lanes", "params": {"filter": {"status": "closed"}}}')
        self.assertIsNone(error)
        self.assertEqual(
            [(row["road_event_id"], row["order"]) for row in data["rows"]],
            [(LANED["id"], 2), (SEQUENCED["id"], 1), (SEQUENCED["id"], 2)],
        )

    def test_lanes_are_capped_too(self):
        data, error, _get = run('{"resource": "lanes"}', max_rows=3)
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 3)
        self.assertTrue(data["truncated"])


class TestDevices(TestCase):
    def test_devices_read_the_device_feed(self):
        data, error, get = run('{"resource": "devices"}', device_feed_url=DEVICE_URL)
        self.assertIsNone(error)
        self.assertEqual(get.call_args[0][0], DEVICE_URL)
        rows = rows_by_id(data)
        board = rows[ARROW_BOARD["id"]]
        self.assertEqual(board["device_type"], "arrow-board")
        self.assertEqual(board["device_status"], "ok")
        self.assertEqual(json.loads(board["road_names"]), ["I-80", "I-35"])
        self.assertEqual(board["has_automatic_location"], True)
        self.assertEqual(board["is_moving"], False)
        self.assertEqual(board["geometry_type"], "Point")
        self.assertEqual(json.loads(board["bbox"]), [-93.776684, 41.617961, -93.776684, 41.617961])
        self.assertEqual(
            json.loads(board["properties"]), {"pattern": "right-arrow-flashing", "is_in_transport_position": False}
        )
        camera = rows["camera-1"]
        self.assertEqual(json.loads(camera["status_messages"]), ["No image for 2 hours"])
        self.assertEqual(camera["road_names"], None)

    def test_devices_filter_and_featurecollection(self):
        query = (
            '{"resource": "devices", "params": {"filter": {"device_status": "error"}, "format": "featurecollection"}}'
        )
        data, error, _get = run(query, device_feed_url=DEVICE_URL)
        self.assertIsNone(error)
        collection = json.loads(data["rows"][0]["geojson"])
        self.assertEqual([feature["id"] for feature in collection["features"]], ["camera-1"])

    def test_devices_without_a_device_feed_url_is_an_error(self):
        data, error, get = run('{"resource": "devices"}')
        self.assertIsNone(data)
        self.assertIn("device feed URL", error)
        get.assert_not_called()

    def test_a_3x_device_feed_names_the_device_feed(self):
        legacy = {"road_event_feed_info": {}, "type": "FeatureCollection", "features": []}
        data, error, _get = run(
            '{"resource": "devices"}',
            payloads={FEED_URL: WORK_ZONE_FEED, DEVICE_URL: legacy},
            device_feed_url=DEVICE_URL,
        )
        self.assertIsNone(data)
        self.assertIn("device feed", error)
        self.assertIn("WZDx 3.x", error)

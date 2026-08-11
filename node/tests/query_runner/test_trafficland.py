from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.trafficland import TrafficLand

SAMPLE_FEEDS = [
    {"publicId": "40011", "name": "Route 1 @ Main St"},
    {"publicId": "40012", "name": "Route 2 @ Second St"},
]


def mock_response(payload):
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


class TestTrafficLand(TestCase):
    def setUp(self):
        self.runner = TrafficLand({"api_key": "tl-key", "system": "demo"})

    def test_video_feeds(self):
        with patch(
            "redash.query_runner.trafficland.requests.get", return_value=mock_response(SAMPLE_FEEDS)
        ) as get:
            data, error = self.runner.run_query('{"resource": "video_feeds"}', None)

        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 2)

        url = get.call_args.args[0]
        params = get.call_args.kwargs["params"]
        self.assertEqual(url, "https://api.trafficland.com/v2.2/json/video_feeds")
        self.assertEqual(params["system"], "demo")
        self.assertEqual(params["key"], "tl-key")

    def test_ids_filter(self):
        with patch("redash.query_runner.trafficland.requests.get", return_value=mock_response(SAMPLE_FEEDS)):
            data, error = self.runner.run_query('{"resource": "video_feeds", "params": {"ids": "40012"}}', None)

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["publicId"], "40012")

    def test_missing_system_fails_before_any_request(self):
        # A pre-existing row saved before system became required can still
        # have it empty: this must fail as configuration, naming the field,
        # rather than sending system="" to TrafficLand.
        runner = TrafficLand({"api_key": "tl-key"})
        with patch("redash.query_runner.trafficland.requests.get") as get:
            data, error = runner.run_query('{"resource": "video_feeds"}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "trafficland: 'system' is not configured")
        get.assert_not_called()

    def test_missing_api_key_fails_before_any_request(self):
        runner = TrafficLand({"system": "demo"})
        with patch("redash.query_runner.trafficland.requests.get") as get:
            data, error = runner.run_query('{"resource": "video_feeds"}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "trafficland: 'api_key' is not configured")
        get.assert_not_called()

    def test_missing_base_url_fails_before_any_request(self):
        # A pre-existing row saved before base_url became required can still
        # have it empty; this must fail as configuration rather than sending
        # a malformed request built from an empty base URL.
        runner = TrafficLand({"api_key": "tl-key", "system": "demo", "base_url": ""})
        with patch("redash.query_runner.trafficland.requests.get") as get:
            data, error = runner.run_query('{"resource": "video_feeds"}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "trafficland: 'base_url' is not configured")
        get.assert_not_called()

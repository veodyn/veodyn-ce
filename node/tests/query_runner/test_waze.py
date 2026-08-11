from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.waze import Waze

FEED_URL = "https://na-georss.waze.com/rtserver/web/TGeoRSS?tk=test-token&format=JSON&types=alerts,irregularities"

SAMPLE_FEED = {
    "alerts": [
        {"type": "ACCIDENT", "reliability": 8, "street": "Main St", "city": "Springfield"},
        {"type": "ACCIDENT", "reliability": 3, "street": "1st Ave", "city": "Shelbyville"},
        {"type": "WEATHERHAZARD", "reliability": 9, "street": "2nd St", "city": "Capital City"},
    ],
    "irregularities": [{"type": "SMALL", "street": "Elm St", "speed": 5.2}],
}


def mock_response(payload):
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


def make_runner(**overrides):
    config = {"feed_url": FEED_URL, "request_timeout": 5}
    config.update(overrides)
    return Waze(config)


class TestWaze(TestCase):
    def setUp(self):
        self.runner = make_runner()

    def test_alerts_with_filters(self):
        with patch("redash.query_runner.waze.requests.get", return_value=mock_response(SAMPLE_FEED)) as get:
            data, error = self.runner.run_query(
                '{"resource": "alerts", "params": {"type": "ACCIDENT", "min_reliability": 5}}', None
            )

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["street"], "Main St")

        # The feed URL must be requested verbatim, with no extra params kwarg.
        self.assertNotIn("params", get.call_args.kwargs)
        self.assertIn("na-georss.waze.com", get.call_args.args[0])

    def test_irregularities(self):
        with patch("redash.query_runner.waze.requests.get", return_value=mock_response(SAMPLE_FEED)):
            data, error = self.runner.run_query('{"resource": "irregularities"}', None)

        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["street"], "Elm St")

    def test_missing_key_yields_empty(self):
        with patch("redash.query_runner.waze.requests.get", return_value=mock_response({"alerts": []})):
            data, error = self.runner.run_query('{"resource": "irregularities"}', None)

        self.assertIsNone(error)
        self.assertEqual(data, {"columns": [], "rows": []})

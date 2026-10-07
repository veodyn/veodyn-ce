import json
from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.connector_base import REQUEST_HEADERS
from redash.query_runner.waze import Waze

FEED_URL = "https://www.waze.com/partnerhub-api/partners/1/waze-feeds/test-feed?format=1"

SAMPLE_FEED = {
    "alerts": [
        {
            "type": "HAZARD",
            "reliability": 6,
            "reportDescription": "Road Work Ahead",
            "location": {"x": -117.1, "y": 32.6},
        },
        {"type": "ACCIDENT", "reliability": 8, "street": "Main St", "city": "Springfield"},
        {"type": "ACCIDENT", "reliability": 3, "street": "1st Ave", "city": "Shelbyville"},
        {"type": "WEATHERHAZARD", "reliability": 9, "street": "2nd St", "city": "Capital City"},
    ],
    "jams": [
        {
            "id": 1,
            "street": "Agate St",
            "level": 4,
            "speedKMH": 8.75,
            "line": [{"x": -117.4, "y": 34.0}, {"x": -117.5, "y": 34.1}],
        },
        {"id": 2, "street": "Oak St", "level": 1, "speedKMH": 40.0, "blockingAlertUuid": "abc"},
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


def column_names(data):
    return [column["name"] for column in data["columns"]]


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

        self.assertNotIn("params", get.call_args.kwargs)
        self.assertEqual(get.call_args.args[0], FEED_URL)
        self.assertEqual(get.call_args.kwargs["headers"], REQUEST_HEADERS)

    def test_alert_columns_do_not_depend_on_the_first_record(self):
        with patch("redash.query_runner.waze.requests.get", return_value=mock_response(SAMPLE_FEED)):
            data, error = self.runner.run_query('{"resource": "alerts"}', None)

        self.assertIsNone(error)
        names = column_names(data)
        for name in ("street", "city", "reportDescription", "location"):
            self.assertIn(name, names)
        self.assertIsNone(data["rows"][0]["street"])
        self.assertEqual(data["rows"][1]["street"], "Main St")
        self.assertEqual(data["rows"][0]["location"], '{"x": -117.1, "y": 32.6}')

    def test_jams_with_min_level(self):
        with patch("redash.query_runner.waze.requests.get", return_value=mock_response(SAMPLE_FEED)):
            data, error = self.runner.run_query('{"resource": "jams", "params": {"min_level": 3}}', None)

        self.assertIsNone(error)
        self.assertEqual([row["street"] for row in data["rows"]], ["Agate St"])
        self.assertIn("blockingAlertUuid", column_names(data))

    def test_jams_carry_geojson_geometry(self):
        with patch("redash.query_runner.waze.requests.get", return_value=mock_response(SAMPLE_FEED)) as get:
            data, error = self.runner.run_query('{"resource": "jams"}', None)

        self.assertIsNone(error)
        drawn, undrawn = data["rows"]
        self.assertEqual(
            json.loads(drawn["geometry"]),
            {"type": "LineString", "coordinates": [[-117.4, 34.0], [-117.5, 34.1]]},
        )
        self.assertIsNone(undrawn["geometry"])
        self.assertNotIn("geometry", get.return_value.json.return_value["jams"][0])

    def test_one_point_line_has_no_geometry(self):
        feed = {"irregularities": [{"street": "Elm St", "line": [{"x": -117.4, "y": 34.0}]}]}
        with patch("redash.query_runner.waze.requests.get", return_value=mock_response(feed)):
            data, error = self.runner.run_query('{"resource": "irregularities"}', None)

        self.assertIsNone(error)
        self.assertIsNone(data["rows"][0]["geometry"])

    def test_filters_apply_only_where_the_field_exists(self):
        feed = {
            "alerts": [{"type": "ACCIDENT", "reliability": None}, {"type": "ACCIDENT", "reliability": 9}],
            "irregularities": [{"type": "SMALL", "street": "Elm St"}],
        }
        with patch("redash.query_runner.waze.requests.get", return_value=mock_response(feed)):
            alerts, alerts_error = self.runner.run_query(
                '{"resource": "alerts", "params": {"min_reliability": 5}}', None
            )
            irregular, irregular_error = self.runner.run_query(
                '{"resource": "irregularities", "params": {"min_reliability": 5}}', None
            )

        self.assertIsNone(alerts_error)
        self.assertEqual([row["reliability"] for row in alerts["rows"]], [9])
        self.assertIsNone(irregular_error)
        self.assertEqual(len(irregular["rows"]), 1)

    def test_non_numeric_points_are_not_drawn(self):
        feed = {"jams": [{"id": 1, "line": [{"x": "-117.4", "y": 34.0}, {"x": None, "y": 34.1}, {"x": -117.5}]}]}
        with patch("redash.query_runner.waze.requests.get", return_value=mock_response(feed)):
            data, error = self.runner.run_query('{"resource": "jams"}', None)

        self.assertIsNone(error)
        self.assertIsNone(data["rows"][0]["geometry"])

    def test_irregularities(self):
        with patch("redash.query_runner.waze.requests.get", return_value=mock_response(SAMPLE_FEED)):
            data, error = self.runner.run_query('{"resource": "irregularities"}', None)

        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["street"], "Elm St")
        self.assertIn("causeType", column_names(data))

    def test_missing_key_yields_no_rows(self):
        with patch("redash.query_runner.waze.requests.get", return_value=mock_response({"alerts": []})):
            data, error = self.runner.run_query('{"resource": "irregularities"}', None)

        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])
        self.assertIn("delaySeconds", column_names(data))

    def test_xml_feed_names_the_json_format(self):
        response = mock_response(None)
        response.json.side_effect = ValueError("Expecting value")
        with patch("redash.query_runner.waze.requests.get", return_value=response):
            data, error = self.runner.run_query('{"resource": "alerts"}', None)

        self.assertIsNone(data)
        self.assertIn("format=1", error)

from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.openweathermap import OpenWeatherMap

SAMPLE_WEATHER = {
    "coord": {"lon": 0.0, "lat": 0.0},
    "weather": [{"id": 800, "main": "Clear", "description": "clear sky", "icon": "01d"}],
    "main": {"temp": 71.2, "pressure": 1013, "humidity": 40},
    "dt": 1752940800,
    "name": "Somewhere",
}


def mock_response(payload):
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


class TestOpenWeatherMap(TestCase):
    def setUp(self):
        self.runner = OpenWeatherMap({"app_id": "owm-key"})

    def test_current(self):
        with patch(
            "redash.query_runner.openweathermap.requests.get", return_value=mock_response(SAMPLE_WEATHER)
        ) as get:
            data, error = self.runner.run_query(
                '{"resource": "current", "params": {"lat": "10.05", "lon": "20.24"}}', None
            )

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["temp"], 71.2)
        self.assertEqual(rows[0]["main"], "Clear")
        self.assertEqual(rows[0]["units"], "imperial")
        self.assertEqual(rows[0]["name"], "Somewhere")

        params = get.call_args.kwargs["params"]
        self.assertEqual(params["appId"], "owm-key")
        self.assertEqual(params["units"], "imperial")

    def test_metric_units_param(self):
        with patch(
            "redash.query_runner.openweathermap.requests.get", return_value=mock_response(SAMPLE_WEATHER)
        ) as get:
            data, _ = self.runner.run_query(
                '{"resource": "current", "params": {"lat": "10.05", "lon": "20.24", "units": "metric"}}', None
            )

        self.assertEqual(get.call_args.kwargs["params"]["units"], "metric")
        self.assertEqual(data["rows"][0]["units"], "metric")

    def test_missing_app_id_fails_before_any_request(self):
        # A pre-existing row saved before app_id became required can still
        # have it empty: this must fail as configuration, not as a live
        # request carrying an empty appId to OpenWeatherMap.
        runner = OpenWeatherMap({})
        with patch("redash.query_runner.openweathermap.requests.get") as get:
            data, error = runner.run_query(
                '{"resource": "current", "params": {"lat": "10.05", "lon": "20.24"}}', None
            )

        self.assertIsNone(data)
        self.assertEqual(error, "openweathermap: 'app_id' is not configured")
        get.assert_not_called()

    def test_missing_coordinates_fail_before_any_request(self):
        with patch("redash.query_runner.openweathermap.requests.get") as get:
            data, error = self.runner.run_query('{"resource": "current"}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "openweathermap: 'lat' param is required")
        get.assert_not_called()

    def test_noop_query_carries_valid_coordinates(self):
        with patch(
            "redash.query_runner.openweathermap.requests.get", return_value=mock_response(SAMPLE_WEATHER)
        ) as get:
            data, error = self.runner.run_query(OpenWeatherMap.noop_query, None)

        self.assertIsNone(error)
        get.assert_called_once()

    def test_missing_base_url_fails_before_any_request(self):
        # A pre-existing row saved before base_url became required can still
        # have it empty; this must fail as configuration rather than sending
        # a malformed request built from an empty base URL.
        runner = OpenWeatherMap({"app_id": "owm-key", "base_url": ""})
        with patch("redash.query_runner.openweathermap.requests.get") as get:
            data, error = runner.run_query(
                '{"resource": "current", "params": {"lat": "10.05", "lon": "20.24"}}', None
            )

        self.assertIsNone(data)
        self.assertEqual(error, "openweathermap: 'base_url' is not configured")
        get.assert_not_called()

    def test_null_island_coordinates_reach_the_request(self):
        # Numeric 0 is a valid latitude/longitude (the equator, the prime
        # meridian): it must not be rejected as if it were missing.
        with patch(
            "redash.query_runner.openweathermap.requests.get", return_value=mock_response(SAMPLE_WEATHER)
        ) as get:
            data, error = self.runner.run_query(
                '{"resource": "current", "params": {"lat": 0, "lon": 0.0}}', None
            )

        self.assertIsNone(error)
        get.assert_called_once()
        params = get.call_args.kwargs["params"]
        self.assertEqual(params["lat"], 0)
        self.assertEqual(params["lon"], 0.0)

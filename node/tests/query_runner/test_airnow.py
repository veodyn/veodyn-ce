import json
from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.airnow import AirNow

SAMPLE_OBSERVATIONS = [
    {
        "DateObserved": "2026-07-19",
        "HourObserved": 10,
        "ParameterName": "PM2.5",
        "AQI": 42,
        "Category": {"Number": 1, "Name": "Good"},
    }
]


def mock_response(payload):
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


class TestAirNow(TestCase):
    def setUp(self):
        self.runner = AirNow({"api_key": "an-key"})

    def test_observations(self):
        with patch(
            "redash.query_runner.airnow.requests.get", return_value=mock_response(SAMPLE_OBSERVATIONS)
        ) as get:
            data, error = self.runner.run_query(
                '{"resource": "observations", "params": {"latitude": "10.05", "longitude": "20.24", "distance": "10"}}',
                None,
            )

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(rows[0]["AQI"], 42)
        self.assertEqual(rows[0]["Category"], json.dumps({"Number": 1, "Name": "Good"}))

        params = get.call_args.kwargs["params"]
        self.assertEqual(params["API_KEY"], "an-key")
        self.assertEqual(params["distance"], "10")
        self.assertEqual(params["format"], "application/json")

    def test_missing_api_key_fails_before_any_request(self):
        # A pre-existing row saved before api_key became required can still
        # have it empty: this must fail as configuration, not as a live
        # request carrying an empty API_KEY to AirNow.
        runner = AirNow({})
        with patch("redash.query_runner.airnow.requests.get") as get:
            data, error = runner.run_query(
                '{"resource": "observations", "params": {"latitude": "10.05", "longitude": "20.24"}}', None
            )

        self.assertIsNone(data)
        self.assertEqual(error, "airnow: 'api_key' is not configured")
        get.assert_not_called()

    def test_missing_coordinates_fail_before_any_request(self):
        with patch("redash.query_runner.airnow.requests.get") as get:
            data, error = self.runner.run_query('{"resource": "observations"}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "airnow: 'latitude' param is required")
        get.assert_not_called()

    def test_noop_query_carries_valid_coordinates(self):
        with patch(
            "redash.query_runner.airnow.requests.get", return_value=mock_response(SAMPLE_OBSERVATIONS)
        ) as get:
            data, error = self.runner.run_query(AirNow.noop_query, None)

        self.assertIsNone(error)
        get.assert_called_once()

    def test_missing_base_url_fails_before_any_request(self):
        # A pre-existing row saved before base_url became required can still
        # have it empty; this must fail as configuration rather than sending
        # a malformed request built from an empty base URL.
        runner = AirNow({"api_key": "an-key", "base_url": ""})
        with patch("redash.query_runner.airnow.requests.get") as get:
            data, error = runner.run_query(
                '{"resource": "observations", "params": {"latitude": "10.05", "longitude": "20.24"}}', None
            )

        self.assertIsNone(data)
        self.assertEqual(error, "airnow: 'base_url' is not configured")
        get.assert_not_called()

    def test_null_island_coordinates_reach_the_request(self):
        # Numeric 0 is a valid latitude/longitude (the equator, the prime
        # meridian): it must not be rejected as if it were missing.
        with patch(
            "redash.query_runner.airnow.requests.get", return_value=mock_response(SAMPLE_OBSERVATIONS)
        ) as get:
            data, error = self.runner.run_query(
                '{"resource": "observations", "params": {"latitude": 0, "longitude": 0.0}}', None
            )

        self.assertIsNone(error)
        get.assert_called_once()
        params = get.call_args.kwargs["params"]
        self.assertEqual(params["latitude"], 0)
        self.assertEqual(params["longitude"], 0.0)

    def test_string_zero_coordinates_reach_the_request(self):
        with patch(
            "redash.query_runner.airnow.requests.get", return_value=mock_response(SAMPLE_OBSERVATIONS)
        ) as get:
            data, error = self.runner.run_query(
                '{"resource": "observations", "params": {"latitude": "0", "longitude": "0"}}', None
            )

        self.assertIsNone(error)
        get.assert_called_once()

from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.go511 import Go511

SAMPLE_INCIDENTS = [
    {
        "ID": "INC-1",
        "Description": "Crash blocking lane",
        "RoadwayName": "Route 1",
        "Latitude": 10.05,
        "Longitude": 20.24,
        "Severity": "Major",
    }
]


def mock_response(payload, status=200):
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    response.status_code = status
    return response


class TestGo511(TestCase):
    def setUp(self):
        self.runner = Go511({"api_key": "test-key"})

    def test_unknown_resource(self):
        data, error = self.runner.run_query('{"resource": "nope"}', None)
        self.assertIsNone(data)
        self.assertIn("Unknown resource", error)

    def test_incidents_happy_path(self):
        with patch("redash.query_runner.go511.requests.get", return_value=mock_response(SAMPLE_INCIDENTS)) as get:
            data, error = self.runner.run_query('{"resource": "incidents"}', None)

        self.assertIsNone(error)
        result = data
        self.assertEqual(result["rows"][0]["ID"], "INC-1")
        self.assertEqual(result["rows"][0]["Latitude"], 10.05)

        url = get.call_args.args[0]
        params = get.call_args.kwargs["params"]
        self.assertEqual(url, "https://api.go511.com/api/incidents")
        self.assertEqual(params["key"], "test-key")
        self.assertEqual(params["format"], "json")
        self.assertEqual(params["version"], "0.0")

    def test_sends_a_non_default_user_agent(self):
        # The live edge answers 403 to requests' own `python-requests/*` User-Agent.
        with patch("redash.query_runner.go511.requests.get", return_value=mock_response(SAMPLE_INCIDENTS)) as get:
            self.runner.run_query('{"resource": "incidents"}', None)

        user_agent = get.call_args.kwargs["headers"]["User-Agent"]
        self.assertNotIn("python-requests", user_agent)
        self.assertTrue(user_agent.startswith("Redash/"))

    def test_closures_is_not_offered(self):
        # The upstream /api/closures endpoint is a 404: the resource does not exist.
        data, error = self.runner.run_query('{"resource": "closures"}', None)
        self.assertIsNone(data)
        self.assertIn("Unknown resource", error)

    def test_http_error(self):
        response = Mock()
        response.raise_for_status.side_effect = Exception("500 Server Error")
        with patch("redash.query_runner.go511.requests.get", return_value=response):
            data, error = self.runner.run_query('{"resource": "roadwork"}', None)
        self.assertIsNone(data)
        self.assertIn("500 Server Error", error)

    def test_missing_api_key_fails_before_any_request(self):
        # A pre-existing row saved before api_key became required can still
        # have it empty; this must fail as configuration rather than sending
        # a live request carrying an empty key to GO511.
        runner = Go511({})
        with patch("redash.query_runner.go511.requests.get") as get:
            data, error = runner.run_query('{"resource": "incidents"}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "go511: 'api_key' is not configured")
        get.assert_not_called()

    def test_missing_base_url_fails_before_any_request(self):
        runner = Go511({"api_key": "test-key", "base_url": ""})
        with patch("redash.query_runner.go511.requests.get") as get:
            data, error = runner.run_query('{"resource": "incidents"}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "go511: 'base_url' is not configured")
        get.assert_not_called()

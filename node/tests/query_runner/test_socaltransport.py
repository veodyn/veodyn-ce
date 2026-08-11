from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.socaltransport import SoCalTransport

SAMPLE_NODE_TIME = {
    "node_time": [
        {"title": "Metrolink AV Line", "scheduled_times": "10:15 AM", "carrier_name": "Metrolink"},
        False,
        "",
        {"title": "Amtrak PSF", "scheduled_times": "10:40 AM", "carrier_name": "Amtrak"},
    ]
}


def mock_response(payload):
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


class TestSoCalTransport(TestCase):
    def setUp(self):
        self.runner = SoCalTransport({})

    def test_node_time_drops_falsy_entries(self):
        with patch(
            "redash.query_runner.socaltransport.requests.get", return_value=mock_response(SAMPLE_NODE_TIME)
        ) as get:
            data, error = self.runner.run_query('{"resource": "node_time", "params": {"node_id": "44241"}}', None)

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["title"], "Metrolink AV Line")

        url = get.call_args.args[0]
        params = get.call_args.kwargs["params"]
        self.assertEqual(url, "http://socaltransport.org/tm/node_time_v2.php")
        self.assertEqual(params["node_id"], "44241")
        self.assertEqual(params["format"], "json")

    def test_custom_node_id(self):
        with patch(
            "redash.query_runner.socaltransport.requests.get", return_value=mock_response(SAMPLE_NODE_TIME)
        ) as get:
            self.runner.run_query('{"resource": "node_time", "params": {"node_id": "12345"}}', None)

        self.assertEqual(get.call_args.kwargs["params"]["node_id"], "12345")

    def test_missing_node_id_fails_before_any_request(self):
        # node_id has always been a required per-query param, but nothing
        # enforced that: a query without it silently sent an empty node_id
        # to socaltransport.org.
        with patch("redash.query_runner.socaltransport.requests.get") as get:
            data, error = self.runner.run_query('{"resource": "node_time"}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "socaltransport: 'node_id' param is required")
        get.assert_not_called()

    def test_missing_base_url_fails_before_any_request(self):
        # SoCalTransport had no require_configured guard at all: base_url is
        # its only configuration field, and an empty persisted value must
        # fail as configuration rather than sending a malformed request.
        runner = SoCalTransport({"base_url": ""})
        with patch("redash.query_runner.socaltransport.requests.get") as get:
            data, error = runner.run_query('{"resource": "node_time", "params": {"node_id": "44241"}}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "socaltransport: 'base_url' is not configured")
        get.assert_not_called()

    def test_noop_query_carries_a_valid_node_id(self):
        with patch(
            "redash.query_runner.socaltransport.requests.get", return_value=mock_response(SAMPLE_NODE_TIME)
        ) as get:
            data, error = self.runner.run_query(SoCalTransport.noop_query, None)

        self.assertIsNone(error)
        get.assert_called_once()

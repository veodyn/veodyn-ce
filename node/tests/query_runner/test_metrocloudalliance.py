from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.metrocloudalliance import MetroCloudAlliance

SAMPLE_VEHICLES = {
    "status": "ok",
    "results": [
        {
            "vehicle_id": "RT-101",
            "lat": 40.0,
            "lng": -75.0,
            "heading": 180.0,
            "route": "Blue Line",
            "source": "Rail GTFS-RT",
        }
    ],
}


def mock_response(payload):
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


class TestMetroCloudAlliance(TestCase):
    def setUp(self):
        self.runner = MetroCloudAlliance({"api_key": "demo"})

    def test_vehiclelocations(self):
        with patch(
            "redash.query_runner.metrocloudalliance.requests.get", return_value=mock_response(SAMPLE_VEHICLES)
        ) as get:
            data, error = self.runner.run_query(
                '{"resource": "vehiclelocations", "params": {"transit_mode": "rail", "carrier_code": "RT"}}', None
            )

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(rows[0]["vehicle_id"], "RT-101")

        url = get.call_args.args[0]
        params = get.call_args.kwargs["params"]
        self.assertEqual(url, "https://api.metrocloudalliance.com/v2/realtime/vehiclelocations")
        self.assertEqual(params["api_key"], "demo")
        self.assertEqual(params["transit_mode"], "rail")
        self.assertEqual(params["carrier_code"], "RT")

    def test_non_ok_status_is_error(self):
        payload = {"status": "error", "request_parameters": "bad carrier_code"}
        with patch("redash.query_runner.metrocloudalliance.requests.get", return_value=mock_response(payload)):
            data, error = self.runner.run_query('{"resource": "carriers"}', None)

        self.assertIsNone(data)
        self.assertIn("'error'", error)
        self.assertIn("bad carrier_code", error)

    def test_predictions_path(self):
        payload = {"status": "ok", "results": []}
        with patch("redash.query_runner.metrocloudalliance.requests.get", return_value=mock_response(payload)) as get:
            data, error = self.runner.run_query(
                '{"resource": "predictions", "params": {"search_point": "40.0,-75.0", "search_radius": 500}}',
                None,
            )

        self.assertIsNone(error)
        self.assertEqual(data, {"columns": [], "rows": []})
        self.assertEqual(get.call_args.args[0], "https://api.metrocloudalliance.com/v2/realtime/predictions")

    def test_missing_api_key_fails_before_any_request(self):
        # A pre-existing row saved before api_key became required can still
        # have it empty; this must fail as configuration rather than sending
        # a live request carrying an empty api_key to MCA.
        runner = MetroCloudAlliance({})
        with patch("redash.query_runner.metrocloudalliance.requests.get") as get:
            data, error = runner.run_query('{"resource": "carriers"}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "metrocloudalliance: 'api_key' is not configured")
        get.assert_not_called()

    def test_missing_base_url_fails_before_any_request(self):
        # self.base_url always ends in "/" (see __init__'s rstrip + "/"), so
        # the guard must check the raw configuration value, not the derived
        # attribute, or an empty persisted base_url would never be caught.
        runner = MetroCloudAlliance({"api_key": "demo", "base_url": ""})
        with patch("redash.query_runner.metrocloudalliance.requests.get") as get:
            data, error = runner.run_query('{"resource": "carriers"}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "metrocloudalliance: 'base_url' is not configured")
        get.assert_not_called()

    def test_stoptimes_requires_iline(self):
        # MCA 400s on a missing iline; catch it before the request goes out
        # rather than surface the vendor's "Bad Parameter" response.
        with patch("redash.query_runner.metrocloudalliance.requests.get") as get:
            data, error = self.runner.run_query('{"resource": "stoptimes"}', None)

        self.assertIsNone(data)
        self.assertIn("'iline' param is required", error)
        get.assert_not_called()

    def test_stoptimes_path(self):
        payload = {
            "status": "ok",
            "results": {
                "location_idx": 0,
                "headsign": "NORTH HOLLYWOOD STATION",
                "list": [{"route": "MT802 W", "leaving": "04:10AM", "arriving": "04:42AM"}],
            },
        }
        with patch("redash.query_runner.metrocloudalliance.requests.get", return_value=mock_response(payload)) as get:
            data, error = self.runner.run_query('{"resource": "stoptimes", "params": {"iline": 1287}}', None)

        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["headsign"], "NORTH HOLLYWOOD STATION")
        self.assertEqual(get.call_args.args[0], "https://api.metrocloudalliance.com/v2/tripplanner/stoptimes")
        self.assertEqual(get.call_args.kwargs["params"]["iline"], 1287)

    def test_lines_path(self):
        payload = {
            "status": "ok",
            "results": [{"carrier_code": "MT", "line_id": 2828, "line_name": "K - Metro Rail Line"}],
        }
        with patch("redash.query_runner.metrocloudalliance.requests.get", return_value=mock_response(payload)) as get:
            data, error = self.runner.run_query(
                '{"resource": "lines", "params": {"carrier_code": "MT", "transit_mode": "light rail"}}', None
            )

        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["line_name"], "K - Metro Rail Line")
        self.assertEqual(get.call_args.args[0], "https://api.metrocloudalliance.com/v2/transitnetwork/lines")
        self.assertEqual(get.call_args.kwargs["params"]["transit_mode"], "light rail")

    def test_sources_path(self):
        payload = {
            "status": "ok",
            "results": [
                {
                    "realtime_source_id": "1",
                    "carrier_code": "MT",
                    "predictions": False,
                    "prediction_source_type": "",
                    "vehicle_locations": False,
                    "description": "LACMTA -Swiftly GTFS-RT",
                }
            ],
        }
        with patch("redash.query_runner.metrocloudalliance.requests.get", return_value=mock_response(payload)) as get:
            data, error = self.runner.run_query('{"resource": "sources"}', None)

        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["description"], "LACMTA -Swiftly GTFS-RT")
        self.assertEqual(get.call_args.args[0], "https://api.metrocloudalliance.com/v2/realtime/sources")

    def test_servicealerts_path(self):
        payload = {"status": "ok", "results": []}
        with patch("redash.query_runner.metrocloudalliance.requests.get", return_value=mock_response(payload)) as get:
            data, error = self.runner.run_query(
                '{"resource": "servicealerts", "params": {"status": "active", "carrier_code": "MT"}}', None
            )

        self.assertIsNone(error)
        self.assertEqual(data, {"columns": [], "rows": []})
        self.assertEqual(get.call_args.args[0], "https://api.metrocloudalliance.com/v2/realtime/servicealerts")
        self.assertEqual(get.call_args.kwargs["params"]["status"], "active")

    def test_reports_requires_type(self):
        # MCA 405s a reports call without type; catch it before the request
        # goes out, like stoptimes' iline.
        with patch("redash.query_runner.metrocloudalliance.requests.get") as get:
            data, error = self.runner.run_query('{"resource": "reports"}', None)

        self.assertIsNone(data)
        self.assertIn("'type' param is required", error)
        get.assert_not_called()

    def test_reports_path(self):
        payload = {"status": "ok", "results": [{"report": "otp_by_route"}]}
        with patch("redash.query_runner.metrocloudalliance.requests.get", return_value=mock_response(payload)) as get:
            data, error = self.runner.run_query('{"resource": "reports", "params": {"type": "list_types"}}', None)

        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["report"], "otp_by_route")
        self.assertEqual(get.call_args.args[0], "https://api.metrocloudalliance.com/v2/reports")
        self.assertEqual(get.call_args.kwargs["params"]["type"], "list_types")

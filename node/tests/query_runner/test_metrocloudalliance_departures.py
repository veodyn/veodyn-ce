from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.metrocloudalliance import MetroCloudAlliance
from redash.query_runner.metrocloudalliance_departures import flatten_departures

T0 = 1_787_356_000  # an arbitrary epoch second; only the differences matter

# One stop, two routes, shaped like the live payload: a bus with a prediction
# that stands in for a planned slot plus planned slots with no prediction, and
# a route whose predictions block carries the literal `false` MCA sends for
# times_minutes when only timestamps are known.
STOP = {
    "carrier_code": "CT",
    "carrier_id": 7,
    "stop_name": "Elm St/Central Ave",
    "stop_id": "5501",
    "lat": 10.0551,
    "lng": 20.2394,
    "dist": 305,
    "prediction_available": True,
    "routes": [
        {
            "route": "12",
            "route_id": "12",
            "sign": "Downtown - 5th - Elm",
            "route_name": "Downtown - 5th - Elm",
            "direction": "W",
            "pattern_code": "CT12 W",
            "line_name": "Local and Express",
            "schedule": {"times_minutes": "37, 77", "times_ts": [T0 + 37 * 60, T0 + 77 * 60]},
            "predictions": {"times_minutes": False, "times_ts": [T0 + 39 * 60], "rt_provider": "Swiftly"},
        },
        {
            "route": "14",
            "route_id": "14",
            "sign": None,
            "route_name": "Harbor Terminal - Downtown Express",
            "direction": "S",
            "pattern_code": "CT14 S",
            "schedule": {"times_ts": [T0 + 5 * 60]},
            "predictions": {"times_ts": [T0 + 20 * 60], "rt_provider": "Swiftly"},
        },
    ],
}


class TestFlattenDepartures(TestCase):
    def test_one_row_per_departure_sorted_by_time(self):
        rows = flatten_departures([STOP])

        self.assertEqual(
            [(r["route"], r["is_realtime"], r["departure_at"]) for r in rows],
            [
                ("14", False, "2026-08-21T23:51:40Z"),
                ("14", True, "2026-08-22T00:06:40Z"),
                ("12", True, "2026-08-22T00:25:40Z"),
                ("12", False, "2026-08-22T01:03:40Z"),
            ],
        )

    def test_a_prediction_replaces_the_planned_slot_it_matches(self):
        rows = [r for r in flatten_departures([STOP]) if r["route"] == "12"]

        # 39 min predicted against 37 min planned: one row, realtime, and the
        # planned slot is remembered on it rather than emitted beside it.
        self.assertEqual(rows[0]["is_realtime"], True)
        self.assertEqual(rows[0]["scheduled_at"], "2026-08-22T00:23:40Z")
        self.assertEqual(rows[0]["rt_provider"], "Swiftly")
        # The 77 min slot had no prediction and stays planned.
        self.assertEqual(rows[1]["is_realtime"], False)
        self.assertEqual(rows[1]["scheduled_at"], rows[1]["departure_at"])

    def test_a_prediction_far_from_any_slot_is_its_own_trip(self):
        rows = [r for r in flatten_departures([STOP]) if r["route"] == "14"]

        # 20 min predicted, 5 min planned: fifteen minutes apart is two buses.
        self.assertEqual([r["is_realtime"] for r in rows], [False, True])
        self.assertIsNone(rows[1]["scheduled_at"])

    def test_headsign_falls_back_to_the_route_name(self):
        rows = [r for r in flatten_departures([STOP]) if r["route"] == "14"]
        self.assertEqual(rows[0]["headsign"], "Harbor Terminal - Downtown Express")

    def test_carries_the_stop_onto_every_row(self):
        row = flatten_departures([STOP])[0]
        self.assertEqual(row["stop_id"], "5501")
        self.assertEqual(row["stop_name"], "Elm St/Central Ave")
        self.assertEqual(row["carrier"], "CT")
        self.assertEqual(row["pattern_code"], "CT14 S")

    def test_minutes_are_a_fallback_when_timestamps_are_absent(self):
        stop = {"stop_id": "1", "routes": [{"route": "1", "schedule": {"times_minutes": "3, 8"}}]}
        rows = flatten_departures([stop], now=T0)
        self.assertEqual([r["departure_at"] for r in rows], ["2026-08-21T23:49:40Z", "2026-08-21T23:54:40Z"])

    def test_ignores_what_is_not_shaped_like_a_stop(self):
        self.assertEqual(flatten_departures([None, "x", {"routes": "nope"}, {"routes": [None, {}]}]), [])


def mock_response(payload):
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


class TestDeparturesResource(TestCase):
    def test_hits_predictions_and_returns_departure_rows(self):
        payload = {"status": "ok", "results": [STOP]}
        with patch("redash.query_runner.metrocloudalliance.requests.get", return_value=mock_response(payload)) as get:
            data, error = MetroCloudAlliance({"api_key": "demo"}).run_query(
                '{"resource": "departures", "params": {"stop_id": "5501", "carrier_code": "CT"}}', None
            )

        self.assertIsNone(error)
        self.assertEqual(get.call_args.args[0], "https://api.metrocloudalliance.com/v2/realtime/predictions")
        self.assertEqual(get.call_args.kwargs["params"]["stop_id"], "5501")
        self.assertEqual(len(data["rows"]), 4)
        names = [c["name"] for c in data["columns"]]
        for expected in ("departure_at", "is_realtime", "scheduled_at", "route", "headsign", "stop_name"):
            self.assertIn(expected, names)
        self.assertEqual(data["rows"][0]["departure_at"], "2026-08-21T23:51:40Z")

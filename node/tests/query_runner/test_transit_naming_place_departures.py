from unittest.mock import patch

from redash.query_runner import metrocloudalliance_public as public
from tests.query_runner.test_metrocloudalliance_public import ALL_ROUTES as METRO_ROUTES
from tests.query_runner.test_metrocloudalliance_public import (
    PREDICTIONS,
    ROUTES,
    STOPS,
    PublicResourceCase,
    stops_by_params,
)
from tests.query_runner.test_transit_naming_terminals import HUB, terminal_archives
from tests.query_runner.test_transit_naming_terminals import stops as terminal_stops
from tests.query_runner.transit_naming_fixtures import BU_ROUTES, PREDICTION_STOP, T0


def bu_station(stop_id):
    return {
        "carrier_code": "BU",
        "carrier_id": 12,
        "stop_id": stop_id,
        "stop_name": "Alder Hub Bay 2",
        "routes": [
            {
                "route": "ORA",
                "route_id": "ORA",
                "pattern_code": "BUORA N",
                "direction": "N",
                "sign": "Birch Plaza",
                "schedule": {"times_ts": [T0 + 300]},
            }
        ],
    }


def routes(params):
    return BU_ROUTES if params.get("carrier_code") == "BU" else METRO_ROUTES


def predictions(failing=()):
    def answer(params):
        if params.get("carrier_code") in failing:
            raise OSError("timeout")
        if params.get("carrier_code") == "BU":
            return [bu_station(params["stop_id"])]
        return [dict(PREDICTION_STOP, stop_id=params["stop_id"])]

    return answer


def query(place):
    return '{"resource": "public_place_departures", "params": {"place": "%s"}}' % place


class TestPlaceDepartures(PublicResourceCase):
    def run_place(self, place, failing=()):
        return self.run_resource(
            query(place), {PREDICTIONS: predictions(failing), ROUTES: routes, STOPS: stops_by_params}
        )

    def test_a_place_returns_every_member_stops_departures(self):
        data, _ = self.run_place("BU:50,MT:1166,MT:1167")
        self.assertEqual({row["carrier"] for row in data["rows"]}, {"BU", "MT"})
        self.assertEqual({row["stop_id"] for row in data["rows"]}, {"50", "1166", "1167"})

    def test_each_carrier_lists_its_routes_once(self):
        _, get = self.run_place("BU:50,MT:1166,MT:1167")
        route_calls = [c.kwargs["params"]["carrier_code"] for c in get.call_args_list if c.args[0] == ROUTES]
        self.assertEqual(sorted(route_calls), ["BU", "MT"])

    def test_a_failing_carrier_leaves_the_others(self):
        data, _ = self.run_place("BU:50,MT:1166", failing=("BU",))
        self.assertEqual({row["carrier"] for row in data["rows"]}, {"MT"})

    def test_the_same_stop_twice_is_listed_once(self):
        once, _ = self.run_place("MT:1166")
        twice, get = self.run_place("MT:1166,MT:1166")
        self.assertEqual(len(twice["rows"]), len(once["rows"]))
        self.assertEqual(len([c for c in get.call_args_list if c.args[0] == PREDICTIONS]), 1)

    def test_rows_come_soonest_first(self):
        data, _ = self.run_place("BU:50,MT:1166")
        times = [row["departure_at"] for row in data["rows"]]
        self.assertEqual(times, sorted(times))

    def test_departures_at_a_lines_last_stop_are_still_dropped(self):
        with patch.object(public, "archive_fetch", terminal_archives()):
            data, _ = self.run_resource(query("MT:600"), {PREDICTIONS: [HUB], ROUTES: routes, STOPS: terminal_stops})
        self.assertNotIn("MT030 E", {row["pattern_code"] for row in data["rows"]})
        self.assertIn("MT030 W", {row["pattern_code"] for row in data["rows"]})

    def test_a_malformed_place_is_refused(self):
        with patch("redash.query_runner.metrocloudalliance.requests.get") as get:
            data, error = self.runner.run_query(query("MT:1;DROP"), None)
        self.assertIn("place must be", error)
        get.assert_not_called()

    def test_a_place_is_required(self):
        with patch("redash.query_runner.metrocloudalliance.requests.get"):
            _, error = self.runner.run_query('{"resource": "public_place_departures"}', None)
        self.assertIn("'place' param is required", error)

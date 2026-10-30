from tests.query_runner.test_metrocloudalliance_public import (
    ALL_ROUTES,
    ROUTES,
    STOPS,
    PublicResourceCase,
    stops_by_params,
)


def routes_ignoring_route_code(params):
    return ALL_ROUTES


class TestRouteCodeFilterDoesNotRelyOnTheVendor(PublicResourceCase):
    def test_public_routes_answers_only_the_asked_route(self):
        data, _ = self.run_resource(
            '{"resource": "public_routes", "params": {"carrier_code": "MT", "route_code": "MT801"}}',
            {ROUTES: routes_ignoring_route_code},
        )
        self.assertEqual({r["route_code"] for r in data["rows"]}, {"MT801"})

    def test_public_route_stops_answers_only_the_asked_route(self):
        data, _ = self.run_resource(
            '{"resource": "public_route_stops", "params": {"carrier_code": "MT", "route_code": "MT030"}}',
            {ROUTES: routes_ignoring_route_code, STOPS: stops_by_params},
        )
        self.assertTrue(data["rows"])
        self.assertEqual({r["route_code"] for r in data["rows"]}, {"MT030"})

    def test_without_route_code_every_route_is_kept(self):
        data, _ = self.run_resource(
            '{"resource": "public_routes", "params": {"carrier_code": "MT"}}',
            {ROUTES: routes_ignoring_route_code},
        )
        self.assertIn("MT801", {r["route_code"] for r in data["rows"]})
        self.assertGreater(len(data["rows"]), 1)

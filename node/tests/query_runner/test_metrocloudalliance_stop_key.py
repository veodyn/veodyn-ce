from unittest import TestCase
from unittest.mock import patch

from redash.query_runner.metrocloudalliance import MetroCloudAlliance
from redash.query_runner.metrocloudalliance_public import expand_stop_key


class TestExpandStopKey(TestCase):
    def test_splits_carrier_and_stop(self):
        self.assertEqual(expand_stop_key({"stop": "MT:1166"}), {"carrier_code": "MT", "stop_id": "1166"})

    def test_the_combined_key_wins_over_separate_fields(self):
        self.assertEqual(
            expand_stop_key({"stop": "MT:1166", "carrier_code": "OC", "stop_id": "9", "number_of_results": 5}),
            {"carrier_code": "MT", "stop_id": "1166", "number_of_results": 5},
        )

    def test_leaves_params_without_a_stop_key_alone(self):
        params = {"carrier_code": "MT", "stop_id": "1166"}
        self.assertIs(expand_stop_key(params), params)

    def test_refuses_a_malformed_key(self):
        for value in ["MT1166", "MT:", ":1166", "MT:11 66", "M&T:1166", "MT:1166:2", "TOOLONGCARRIER:1"]:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    expand_stop_key({"stop": value})


class TestRunnerUsesTheStopKey(TestCase):
    def test_public_departures_reaches_upstream_with_the_expanded_stop(self):
        runner = MetroCloudAlliance({"api_key": "k"})
        with patch("redash.query_runner.metrocloudalliance.run_public_resource", return_value=[]) as public:
            runner._fetch("public_departures", {"stop": "MT:1166"})
        self.assertEqual(public.call_args[0][1], {"carrier_code": "MT", "stop_id": "1166"})

    def test_a_malformed_key_fails_before_any_request(self):
        runner = MetroCloudAlliance({"api_key": "k"})
        with patch("redash.query_runner.metrocloudalliance.run_public_resource") as public:
            with self.assertRaises(ValueError):
                runner._fetch("public_departures", {"stop": "nope"})
        public.assert_not_called()

    def test_without_either_the_carrier_is_still_required(self):
        runner = MetroCloudAlliance({"api_key": "k"})
        with self.assertRaises(ValueError):
            runner._fetch("public_departures", {"stop_id": "1166"})

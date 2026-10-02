"""
Fixture-based tests for the `caltrans_atms` connector: no live network.

The webinit.txt fixture below reuses real row text (spacing included) from a
live District 7 fetch made while implementing this connector, covering the
three row shapes that fetch actually contains: the common one (id+name
merged into one token), the rare one where a short id leaves id and name as
separate tokens (`771396`), and one where the name itself contains a 2+
space run and so contributes an extra token of its own (`717294`). See
`caltrans_atms_parse.py`'s module docstring and
`docs/superpowers/specs/2026-09-23-freeway-speed-segments-design-implementation-notes.md`
for how that fixed what this connector actually ports from the prior
`riits_tiles` experiment.
"""

from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.caltrans_atms import CaltransATMS
from redash.query_runner.caltrans_atms_parse import parse_webinit, parse_webupdate

WEBINIT_FIXTURE = "\n".join(
    [
        "VDS      767455 CONN ROUTE 134 EB             2 E        18.80    6492.97    1874.67    -118.17      34.05        18.79 ",  # noqa: E501
        "VDS      771396  S OF TIERRA REJADA          23 N         9.50    6306.95    1917.65    -118.13      34.56        18.10 ",  # noqa: E501
        "VDS      717294 SAN  GABRIEL                 60 W         8.58    6537.23    1836.80    -118.08      34.04         8.72 ",  # noqa: E501
        "CMS      767472 VERDUGO RD                    2 E        16.74    6491.78    1866.11    -118.23      34.12        16.73 ",  # noqa: E501
        "shield 6497.00 1846.52 140   5",
        "VDS      999999 BROKEN ROW",
        "VDS      888888 BAD FIELDS                    5 N         BAD    1.0    1.0    -118.0    34.0    1.0",
    ]
)

WEBUPDATE_FIXTURE = "\n".join(
    [
        "VDS  767455  2  62   5 100",
        "VDS  771396  9  34  11  60",
        "VDS  717294  0   0   0   0",
        'CMS  767472 "" "" "" "" "" ""',
        "VDS  555555  2",
    ]
)


def mock_response(text, status=200):
    response = Mock()
    response.text = text
    response.raise_for_status.return_value = None
    response.status_code = status
    return response


class TestParseWebinit(TestCase):
    def test_the_common_merged_id_and_name_shape(self):
        stations = {s["vds_id"]: s for s in parse_webinit(WEBINIT_FIXTURE)}
        s = stations["767455"]
        self.assertEqual(s["name"], "CONN ROUTE 134 EB")
        self.assertEqual(s["route"], "2")
        self.assertEqual(s["direction"], "E")
        self.assertEqual(s["postmile"], 18.80)
        self.assertEqual(s["lon"], -118.17)
        self.assertEqual(s["lat"], 34.05)

    def test_the_rare_separate_id_and_name_shape(self):
        stations = {s["vds_id"]: s for s in parse_webinit(WEBINIT_FIXTURE)}
        s = stations["771396"]
        self.assertEqual(s["name"], "S OF TIERRA REJADA")
        self.assertEqual(s["route"], "23")
        self.assertEqual(s["direction"], "N")

    def test_a_name_containing_its_own_double_space_run(self):
        stations = {s["vds_id"]: s for s in parse_webinit(WEBINIT_FIXTURE)}
        s = stations["717294"]
        self.assertEqual(s["name"], "SAN GABRIEL")
        self.assertEqual(s["route"], "60")
        self.assertEqual(s["direction"], "W")

    def test_cms_and_shield_rows_are_not_stations(self):
        ids = {s["vds_id"] for s in parse_webinit(WEBINIT_FIXTURE)}
        self.assertNotIn("767472", ids)  # the CMS row's id

    def test_unparseable_rows_are_skipped_not_raised(self):
        # Both "999999 BROKEN ROW" (no route/direction token at all) and
        # "888888 BAD FIELDS" (route/direction present, postmile not
        # numeric) must be absent, and parsing the rest of the fixture must
        # not raise.
        ids = {s["vds_id"] for s in parse_webinit(WEBINIT_FIXTURE)}
        self.assertNotIn("999999", ids)
        self.assertNotIn("888888", ids)
        self.assertEqual(ids, {"767455", "771396", "717294"})


class TestParseWebupdate(TestCase):
    def test_ok_and_no_data_rows(self):
        readings = {r["vds_id"]: r for r in parse_webupdate(WEBUPDATE_FIXTURE)}
        self.assertEqual(readings["767455"]["color_code"], "2")
        self.assertEqual(readings["771396"]["color_code"], "9")
        self.assertEqual(readings["717294"]["color_code"], "0")

    def test_cms_rows_are_not_readings(self):
        ids = {r["vds_id"] for r in parse_webupdate(WEBUPDATE_FIXTURE)}
        self.assertNotIn("767472", ids)

    def test_a_too_short_row_is_skipped_not_raised(self):
        ids = {r["vds_id"] for r in parse_webupdate(WEBUPDATE_FIXTURE)}
        self.assertNotIn("555555", ids)


class TestCaltransATMS(TestCase):
    def setUp(self):
        self.runner = CaltransATMS({})

    def test_unknown_resource(self):
        data, error = self.runner.run_query('{"resource": "nope"}', None)
        self.assertIsNone(data)
        self.assertIn("Unknown resource", error)

    def test_stations_happy_path(self):
        with patch(
            "redash.query_runner.caltrans_atms.requests.get",
            return_value=mock_response(WEBINIT_FIXTURE),
        ) as get:
            data, error = self.runner.run_query('{"resource": "stations"}', None)

        self.assertIsNone(error)
        names = [c["name"] for c in data["columns"]]
        self.assertEqual(names, ["vds_id", "name", "route", "direction", "postmile", "lon", "lat"])
        self.assertEqual({r["vds_id"] for r in data["rows"]}, {"767455", "771396", "717294"})
        url = get.call_args.args[0]
        self.assertEqual(url, "https://cwwp2.dot.ca.gov/data/d7/atms/webinit.txt")

    def test_stations_limit_param_truncates(self):
        with patch(
            "redash.query_runner.caltrans_atms.requests.get",
            return_value=mock_response(WEBINIT_FIXTURE),
        ):
            data, error = self.runner.run_query('{"resource": "stations", "params": {"limit": 1}}', None)

        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)

    def test_readings_fixed_schema_covers_ok_and_no_data_rows(self):
        with patch(
            "redash.query_runner.caltrans_atms.requests.get",
            return_value=mock_response(WEBUPDATE_FIXTURE),
        ):
            data, error = self.runner.run_query('{"resource": "readings"}', None)

        self.assertIsNone(error)
        expected_columns = [
            "vds_id",
            "status",
            "color_code",
            "speed_mph",
            "volume_per_30s",
            "good_lanes_pct",
            "observed_at",
        ]
        self.assertEqual([c["name"] for c in data["columns"]], expected_columns)

        rows = {r["vds_id"]: r for r in data["rows"]}
        ok_row = rows["767455"]
        self.assertEqual(ok_row["status"], "ok")
        self.assertEqual(ok_row["color_code"], "2")
        self.assertEqual(ok_row["speed_mph"], 62.0)
        self.assertEqual(set(ok_row), set(expected_columns))

        no_data_row = rows["717294"]
        self.assertEqual(no_data_row["status"], "no_data")
        self.assertEqual(no_data_row["color_code"], "0")
        self.assertEqual(set(no_data_row), set(expected_columns))

        # Undocumented code 9: no_data, but the raw speed is kept verbatim,
        # never nulled and never guessed at (Decision 4).
        undocumented_row = rows["771396"]
        self.assertEqual(undocumented_row["status"], "no_data")
        self.assertEqual(undocumented_row["color_code"], "9")
        self.assertEqual(undocumented_row["speed_mph"], 34.0)

    def test_a_no_data_row_leading_the_response_does_not_drop_columns(self):
        # 717294 (code 0, no_data) sorts before 767455 (code 2, ok) once
        # webupdate.txt is reordered; to_fixed_table must not infer a
        # narrower schema from whichever row happens to come first.
        reordered = "\n".join(
            [
                "VDS  717294  0   0   0   0",
                "VDS  767455  2  62   5 100",
            ]
        )
        with patch(
            "redash.query_runner.caltrans_atms.requests.get",
            return_value=mock_response(reordered),
        ):
            data, error = self.runner.run_query('{"resource": "readings"}', None)

        self.assertIsNone(error)
        for row in data["rows"]:
            self.assertIn("speed_mph", row)
            self.assertIn("good_lanes_pct", row)

    def test_sends_a_non_default_user_agent(self):
        with patch(
            "redash.query_runner.caltrans_atms.requests.get",
            return_value=mock_response(WEBINIT_FIXTURE),
        ) as get:
            self.runner.run_query('{"resource": "stations"}', None)

        user_agent = get.call_args.kwargs["headers"]["User-Agent"]
        self.assertNotIn("python-requests", user_agent)
        self.assertTrue(user_agent.startswith("Redash/"))

    def test_missing_base_url_fails_before_any_request(self):
        runner = CaltransATMS({"base_url": ""})
        with patch("redash.query_runner.caltrans_atms.requests.get") as get:
            data, error = runner.run_query('{"resource": "stations"}', None)

        self.assertIsNone(data)
        self.assertEqual(error, "caltrans_atms: 'base_url' is not configured")
        get.assert_not_called()

    def test_http_error(self):
        response = Mock()
        response.raise_for_status.side_effect = Exception("500 Server Error")
        with patch("redash.query_runner.caltrans_atms.requests.get", return_value=response):
            data, error = self.runner.run_query('{"resource": "readings"}', None)
        self.assertIsNone(data)
        self.assertIn("500 Server Error", error)

    def test_default_base_url(self):
        schema = CaltransATMS.configuration_schema()
        self.assertEqual(schema["properties"]["base_url"]["default"], "https://cwwp2.dot.ca.gov/data/d7/atms")
        self.assertIn("base_url", schema["required"])

    def test_noop_query_runs_against_stations(self):
        self.assertEqual(CaltransATMS.noop_query, '{"resource": "stations", "params": {"limit": 1}}')
        with patch(
            "redash.query_runner.caltrans_atms.requests.get",
            return_value=mock_response(WEBINIT_FIXTURE),
        ):
            data, error = self.runner.run_query(CaltransATMS.noop_query, None)
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)

"""
Historical capture toggles must reach every registered source type, not only
the connectors that go through build_configuration_schema. These tests cover
the central helper (redash/query_runner/__init__.py) and the two call sites
that serve it: BaseQueryRunner.to_dict() and
get_configuration_schema_for_query_runner_type.
"""

from unittest import TestCase

from redash.query_runner import (
    add_historical_capture_fields,
    get_configuration_schema_for_query_runner_type,
)
from redash.query_runner.gtfs_realtime import GtfsRealtime
from redash.query_runner.pg import PostgreSQL

EXPECTED_FIELDS = {
    "enable_historical_capture": {
        "type": "boolean",
        "title": "Historical capture (scheduled runs → warehouse)",
        "default": False,
    },
    "capture_manual_runs": {
        "type": "boolean",
        "title": "Capture manual runs too",
        "default": False,
    },
    "historical_retention_days": {
        "type": "number",
        "title": "Historical retention (days, 0 = keep forever)",
        "default": 0,
    },
}


class TestPlainSqlRunner(TestCase):
    def test_to_dict_serves_all_three_capture_fields(self):
        properties = PostgreSQL.to_dict()["configuration_schema"]["properties"]
        for name, field in EXPECTED_FIELDS.items():
            self.assertEqual(properties[name], field)

    def test_get_configuration_schema_for_query_runner_type_serves_all_three(self):
        schema = get_configuration_schema_for_query_runner_type("pg")
        for name, field in EXPECTED_FIELDS.items():
            self.assertEqual(schema["properties"][name], field)

    def test_required_and_secret_pass_through_untouched(self):
        schema = get_configuration_schema_for_query_runner_type("pg")
        self.assertEqual(schema["required"], ["dbname"])
        self.assertEqual(
            schema["secret"],
            ["password", "sslrootcertFile", "sslcertFile", "sslkeyFile"],
        )


class TestConnectorRunner(TestCase):
    def test_gtfs_realtime_serves_capture_fields_exactly_once(self):
        schema = GtfsRealtime.to_dict()["configuration_schema"]
        for name in EXPECTED_FIELDS:
            self.assertEqual(list(schema["properties"].keys()).count(name), 1)
        for name, field in EXPECTED_FIELDS.items():
            self.assertEqual(schema["properties"][name], field)

    def test_gtfs_realtime_other_fields_are_unchanged(self):
        raw_properties = GtfsRealtime.configuration_schema()["properties"]
        augmented_properties = GtfsRealtime.to_dict()["configuration_schema"]["properties"]
        for name, field in raw_properties.items():
            if name in EXPECTED_FIELDS:
                continue
            self.assertEqual(augmented_properties[name], field)


class TestAddHistoricalCaptureFields(TestCase):
    def test_does_not_mutate_the_input_schema(self):
        original = {"type": "object", "properties": {"host": {"type": "string"}}}
        snapshot = {"type": "object", "properties": {"host": {"type": "string"}}}
        add_historical_capture_fields(original)
        self.assertEqual(original, snapshot)

    def test_empty_schema_produces_a_valid_object_schema(self):
        augmented = add_historical_capture_fields({})
        self.assertEqual(augmented["type"], "object")
        for name, field in EXPECTED_FIELDS.items():
            self.assertEqual(augmented["properties"][name], field)

    def test_a_schema_already_carrying_a_field_of_that_name_is_left_alone(self):
        custom = {"type": "string", "title": "Custom", "default": True}
        augmented = add_historical_capture_fields(
            {"type": "object", "properties": {"enable_historical_capture": custom}}
        )
        self.assertEqual(augmented["properties"]["enable_historical_capture"], custom)
        self.assertEqual(augmented["properties"]["capture_manual_runs"], EXPECTED_FIELDS["capture_manual_runs"])


class TestReExportSurfaceSurvivesTheModuleSplit(TestCase):
    """
    redash.query_runner used to be one file; it is now several, re-exported
    through __init__.py. veodyn-pack-riits is the only pack that imports
    from redash.query_runner directly, and these four names (the redash-
    specific request/tunnel helpers a connector might need) are the ones
    worth guaranteeing here on top of what the rest of this file already
    covers.
    """

    def test_request_and_tunnel_helpers_import_from_the_package_root(self):
        from redash.query_runner import (
            UnacceptableAddressException,
            open_tunnel,
            requests_or_advocate,
            requests_session,
        )

        self.assertTrue(callable(open_tunnel))
        self.assertTrue(issubclass(UnacceptableAddressException, Exception))
        self.assertIsNotNone(requests_session)
        self.assertIsNotNone(requests_or_advocate)

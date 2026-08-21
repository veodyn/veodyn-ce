import json
from unittest import TestCase
from unittest.mock import patch

from redash.query_runner import TYPE_FLOAT, TYPE_INTEGER, TYPE_STRING
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
    extract_records,
    infer_type,
    parse_json_query,
    serialize_result,
    to_redash_table,
)
from redash.query_runner.geotab import Geotab
from redash.query_runner.static_geojson import StaticGeoJSON


class TestInferType(TestCase):
    def test_types(self):
        self.assertEqual(infer_type(True), TYPE_STRING)
        self.assertEqual(infer_type(1), TYPE_INTEGER)
        self.assertEqual(infer_type(1.5), TYPE_FLOAT)
        self.assertEqual(infer_type("x"), TYPE_STRING)
        self.assertEqual(infer_type(None), TYPE_STRING)


class TestParseJsonQuery(TestCase):
    def test_valid(self):
        config, error = parse_json_query('{"resource": "a"}')
        self.assertIsNone(error)
        self.assertEqual(config, {"resource": "a"})

    def test_invalid(self):
        config, error = parse_json_query("not json")
        self.assertIsNone(config)
        self.assertIn("Invalid query JSON", error)


class TestExtractRecords(TestCase):
    def test_legacy_envelope_with_data_list(self):
        payload = {"type": "x", "data": [{"a": 1}, {"a": 2}]}
        self.assertEqual(extract_records(payload), [{"a": 1}, {"a": 2}])

    def test_legacy_envelope_with_data_scalar(self):
        self.assertEqual(extract_records({"data": {"a": 1}}), [{"a": 1}])
        self.assertEqual(extract_records({"data": None}), [])

    def test_legacy_list(self):
        self.assertEqual(extract_records([{"a": 1}]), [{"a": 1}])

    def test_legacy_scalar_dict(self):
        self.assertEqual(extract_records({"a": 1}), [{"a": 1}])

    def test_record_path(self):
        payload = {"data": {"stations": [{"id": "s1"}]}}
        self.assertEqual(extract_records(payload, ["data", "stations"]), [{"id": "s1"}])

    def test_record_path_missing(self):
        self.assertEqual(extract_records({"data": {}}, ["data", "stations"]), [])
        self.assertEqual(extract_records([], ["data"]), [])

    def test_record_path_scalar(self):
        self.assertEqual(extract_records({"vehicle": {"id": "v1"}}, ["vehicle"]), [{"id": "v1"}])


class TestToRedashTable(TestCase):
    def test_empty(self):
        self.assertEqual(to_redash_table([]), ([], []))

    def test_columns_from_first_row(self):
        columns, rows = to_redash_table([{"a": 1, "b": "x"}, {"a": 2, "b": "y", "c": "ignored"}])
        self.assertEqual([c["name"] for c in columns], ["a", "b"])
        self.assertEqual(columns[0]["type"], TYPE_INTEGER)
        self.assertEqual(rows, [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}])

    def test_nested_values_become_json_strings(self):
        columns, rows = to_redash_table([{"a": {"n": 1}, "b": [1, 2]}])
        self.assertEqual(rows[0]["a"], json.dumps({"n": 1}))
        self.assertEqual(rows[0]["b"], json.dumps([1, 2]))

    def test_non_dict_records(self):
        columns, rows = to_redash_table([1, 2])
        self.assertEqual([c["name"] for c in columns], ["value"])
        self.assertEqual(rows, [{"value": 1}, {"value": 2}])


class FakeRunner(BaseResourceRunner):
    resources = {
        "things": {
            "doc_params": ["endpoint: /things"],
            "doc_returns": ["a: integer"],
        },
    }
    default_resource = "things"

    @classmethod
    def configuration_schema(cls):
        return {"type": "object", "properties": {}}

    def _fetch(self, resource, params):
        raw = {"data": [{"a": 1}]}
        return extract_records(raw), raw


class TestSyntax(TestCase):
    """
    Runners on the JSON query format must say so. The BaseQueryRunner default
    is "sql", and clients act on it: the query editor picks its language mode
    from this field, and a SQL builder in front of Redash reads it to decide
    whether it may aim a query here at all.
    """

    def test_base_runner_reports_json(self):
        self.assertEqual(FakeRunner({}).syntax, "json")


class TestBaseResourceRunner(TestCase):
    def test_unknown_resource(self):
        runner = FakeRunner({})
        data, error = runner.run_query('{"resource": "nope"}', None)
        self.assertIsNone(data)
        self.assertIn("Unknown resource", error)
        self.assertIn("things", error)

    def test_default_resource(self):
        runner = FakeRunner({})
        data, error = runner.run_query("{}", None)
        self.assertIsNone(error)
        result = data
        self.assertEqual(result["rows"], [{"a": 1}])

    def test_invalid_json(self):
        runner = FakeRunner({})
        data, error = runner.run_query("nope", None)
        self.assertIsNone(data)
        self.assertIn("Invalid query JSON", error)

    def test_fetch_error_is_returned(self):
        runner = FakeRunner({})
        with patch.object(FakeRunner, "_fetch", side_effect=RuntimeError("boom")):
            data, error = runner.run_query('{"resource": "things"}', None)
        self.assertIsNone(data)
        self.assertIn("boom", error)

    def test_get_schema_structure(self):
        runner = FakeRunner({})
        schema = runner.get_schema()
        names = [entry["name"] for entry in schema]
        self.assertIn("1. things > params", names)
        self.assertIn("1. things > returns", names)
        self.assertIn("__ Query Examples __", names)


class TestSerializeResult(TestCase):
    def test_serialize_result_returns_dict(self):
        # Modern Redash contract: run_query returns a dict, not a JSON string,
        # since a string would double-encode in the JSONText column and blank
        # the UI.
        columns, rows = to_redash_table([{"a": 1}])
        self.assertEqual(serialize_result(columns, rows), {"columns": columns, "rows": rows})


class TestHistoricalCaptureSchemaFields(TestCase):
    """
    Every RIITS runner's admin-UI toggle must match the flag the capture hook
    reads (`data_source.options.get("enable_historical_capture")`).

    The two capture fields are no longer added by build_configuration_schema
    itself: the central redash.query_runner.add_historical_capture_fields
    helper adds them to every runner's served schema, so these assertions go
    through to_dict() (the augmented path) rather than configuration_schema()
    directly.

    RIITSApi itself moved to the veodyn-pack-riits distribution and is no
    longer importable from this fork; its own capture-toggle coverage now
    lives with the runner in that pack.
    """

    def _assert_has_capture_fields(self, properties):
        self.assertEqual(
            properties["enable_historical_capture"],
            {
                "type": "boolean",
                "title": "Historical capture (scheduled runs → warehouse)",
                "default": False,
            },
        )
        self.assertEqual(
            properties["historical_retention_days"],
            {
                "type": "number",
                "title": "Historical retention (days, 0 = keep forever)",
                "default": 0,
            },
        )

    def test_build_configuration_schema_no_longer_adds_capture_fields_itself(self):
        self.assertNotIn("enable_historical_capture", build_configuration_schema({})["properties"])
        self.assertNotIn("historical_retention_days", build_configuration_schema({})["properties"])

    def test_geotab_runner_exposes_capture_toggle(self):
        self._assert_has_capture_fields(Geotab.to_dict()["configuration_schema"]["properties"])

    def test_static_geojson_runner_exposes_capture_toggle(self):
        # This runner calls build_configuration_schema(..., include_redis=False).
        self._assert_has_capture_fields(StaticGeoJSON.to_dict()["configuration_schema"]["properties"])

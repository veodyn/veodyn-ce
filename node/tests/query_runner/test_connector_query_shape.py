"""
The query-shape contract this connector family documents but did not keep.

Measured on 2026-08-07 before the fix: eleven of the twelve runners raise
AttributeError out of run_query for a query text that is valid JSON but not
an object. Only ntcip_dms returns the documented (None, error) tuple.
"""

from unittest import TestCase

from redash.query_runner.connector_base import BaseResourceRunner
from redash.query_runner.connector_validation import parse_object_query


class ShapeProbe(BaseResourceRunner):
    resources = {"x": {}}

    def _fetch(self, resource, params):
        return [{"a": 1}], None


class TestParseObjectQuery(TestCase):
    def test_a_non_object_root_is_rejected_by_type_name(self):
        for text, kind in (("[]", "list"), ("null", "NoneType"), ('"h"', "str"), ("42", "int")):
            with self.subTest(text=text):
                config, params, error = parse_object_query(text)
                self.assertIsNone(config)
                self.assertEqual(error, f"Invalid query JSON: must be a JSON object, not {kind}")

    def test_a_non_object_params_is_rejected_including_falsy_ones(self):
        # The trap: `config.get("params") or {}` turns [] into {} BEFORE any
        # type check, so a naive implementation accepts [], "", 0 and false.
        # ntcip_dms.py:189 has exactly that bug today.
        for literal, kind in (("[]", "list"), ('""', "str"), ("0", "int"), ("false", "bool")):
            with self.subTest(literal=literal):
                _c, _p, error = parse_object_query('{"resource": "x", "params": %s}' % literal)
                self.assertEqual(error, f"Invalid query JSON: 'params' must be a JSON object, not {kind}")

    def test_a_non_string_resource_is_rejected_by_type_name(self):
        # The root guard did not reach this field. Measured on 2026-08-08
        # before the fix, against gbfs: false, 0, [] and {} each read as
        # "resource omitted" through `config.get("resource") or
        # self.default_resource` and sent a real request against the DEFAULT
        # resource, and [1] raised TypeError: unhashable type: 'list' out of
        # run_query, which is the same contract violation the root guard
        # exists to close, reached through a different key.
        for literal, kind in (
            ("false", "bool"),
            ("0", "int"),
            ("[]", "list"),
            ("{}", "dict"),
            ("[1]", "list"),
            ("1.5", "float"),
        ):
            with self.subTest(literal=literal):
                config, params, error = parse_object_query('{"resource": %s}' % literal)
                self.assertIsNone(config)
                self.assertIsNone(params)
                self.assertEqual(error, f"Invalid query JSON: 'resource' must be a string, not {kind}")

    def test_omitted_and_null_resource_both_keep_the_default_resource_behaviour(self):
        # Only a PRESENT resource has to be a string. Absent is how every
        # runner with a default_resource is meant to be queried, and null is
        # the same statement written out.
        for text in ("{}", '{"resource": null}'):
            with self.subTest(text=text):
                config, _params, error = parse_object_query(text)
                self.assertIsNone(error)
                self.assertIsNone(config.get("resource"))

    def test_omitted_and_null_params_both_become_an_empty_dict(self):
        for text in ('{"resource": "x"}', '{"resource": "x", "params": null}'):
            with self.subTest(text=text):
                config, params, error = parse_object_query(text)
                self.assertIsNone(error)
                self.assertEqual(params, {})

    def test_malformed_json_keeps_its_existing_message(self):
        _c, _p, error = parse_object_query("{not json")
        self.assertIn("Invalid query JSON", error)


# Each runner needs a configuration valid enough to get PAST its own config
# validation, or this test passes vacuously. Measured, not guessed: with an
# empty configuration seven of these never reach the query at all.
FAMILY_CONFIGS = {
    "airnow": {"base_url": "https://x.invalid/", "api_key": "k"},
    "gbfs": {},
    "geotab": {"server": "s", "database": "d", "username": "u", "password": "p"},
    "go511": {"api_key": "k"},
    "gtfs_realtime": {},
    "metrocloudalliance": {"base_url": "https://x.invalid/", "api_key": "k"},
    "ntcip_dms": {"community": "c", "default_devices": '[{"name":"a","host":"10.0.0.1"}]'},
    "openweathermap": {"base_url": "https://x.invalid/", "app_id": "a"},
    "socaltransport": {},
    "static_geojson": {},
    "tmdd": {"endpoint_url": "https://c.invalid/c2cxml/", "organization_id": "ORG"},
    "trafficland": {"base_url": "https://x.invalid/", "api_key": "k", "system": "s"},
    "waze": {},
}


class TestEveryResourceRunnerKeepsTheContract(TestCase):
    def _family(self):
        from redash import settings
        from redash.query_runner import query_runners

        production = set(settings.default_query_runners)
        return {
            t: cls
            for t, cls in query_runners.items()
            if issubclass(cls, BaseResourceRunner) and cls.__module__ in production and not cls.deprecated
        }

    def test_the_config_map_covers_the_whole_live_family(self):
        # Without this, adding a runner silently drops it from the test below.
        self.assertEqual(set(self._family()), set(FAMILY_CONFIGS))

    def test_a_non_object_query_returns_an_error_from_every_runner(self):
        for type_name, cls in sorted(self._family().items()):
            for text in ("[]", "null", "42"):
                with self.subTest(runner=type_name, text=text):
                    try:
                        data, error = cls(FAMILY_CONFIGS[type_name]).run_query(text, None)
                    except Exception as e:  # noqa: BLE001
                        self.fail(f"{type_name} raised {type(e).__name__}: {e}")
                    self.assertIsNone(data)
                    self.assertIn("must be a JSON object", error)

    def test_a_non_string_resource_returns_an_error_from_every_runner(self):
        # The root-shape cases above prove nothing about this one: `resource`
        # is read AFTER the root guard passes, by `config.get("resource") or
        # self.default_resource` in connector_base and by an `in` test against
        # the resource table in the two runners that reimplement the tail.
        # Both defects live below the root guard, so both need the whole
        # family walked again.
        for type_name, cls in sorted(self._family().items()):
            for text in ('{"resource": false}', '{"resource": 0}', '{"resource": []}', '{"resource": {}}'):
                with self.subTest(runner=type_name, text=text):
                    try:
                        data, error = cls(FAMILY_CONFIGS[type_name]).run_query(text, None)
                    except Exception as e:  # noqa: BLE001
                        self.fail(f"{type_name} raised {type(e).__name__}: {e}")
                    self.assertIsNone(data)
                    self.assertIn("'resource' must be a string", error)

    def test_an_unhashable_resource_does_not_raise_out_of_any_runner(self):
        # Kept apart from the case above because it fails differently: a
        # falsy resource ran a real request against the default resource,
        # while [1] raised TypeError past the exception handler entirely.
        for type_name, cls in sorted(self._family().items()):
            with self.subTest(runner=type_name):
                try:
                    data, error = cls(FAMILY_CONFIGS[type_name]).run_query('{"resource": [1]}', None)
                except Exception as e:  # noqa: BLE001
                    self.fail(f"{type_name} raised {type(e).__name__}: {e}")
                self.assertIsNone(data)
                self.assertIn("'resource' must be a string", error)

    def test_ntcip_rejects_a_falsy_non_object_params_instead_of_polling(self):
        # The root guard ntcip_dms carried was right; its params guard was
        # not. Measured before the fix: each of these reached poll_devices
        # and came back "No device produced a healthy 'dms_identity'
        # response", because `config.get("params") or {}` had already turned
        # the bad value into {} before the isinstance check ran.
        from redash.query_runner.ntcip_dms import NtcipDms

        for literal, kind in (("[]", "list"), ('""', "str"), ("0", "int"), ("false", "bool")):
            with self.subTest(literal=literal):
                runner = NtcipDms(FAMILY_CONFIGS["ntcip_dms"])
                data, error = runner.run_query('{"resource": "dms_identity", "params": %s}' % literal, None)
                self.assertIsNone(data)
                self.assertEqual(error, f"Invalid query JSON: 'params' must be a JSON object, not {kind}")

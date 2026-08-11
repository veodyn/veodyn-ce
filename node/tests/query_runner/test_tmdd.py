"""
The TMDD runner's pre-transport validation: configuration and query params.

Everything here runs without a network: none of these cases is supposed to
reach the transport. The generated configuration_schema itself, which a data
source is SAVED against rather than queried through, is in
test_tmdd_config_schema.
"""

import json
import sys
from unittest import TestCase, mock

from redash.query_runner.tmdd import ALLOWED_PARAMS, TMDD

VALID = {
    "endpoint_url": "https://c2c.example.org/tmdd",
    "organization_id": "ORG-1",
}


class TestTMDDConfigurationErrors(TestCase):
    def test_a_fully_configured_runner_has_no_config_error(self):
        self.assertIsNone(TMDD(dict(VALID)).config_error)

    def test_an_unsupported_tmdd_version_fails_at_query_time_not_silently(self):
        runner = TMDD(dict(VALID, tmdd_version="3.04"))
        data, error = runner.run_query('{"resource": "dms_inventory"}', None)
        self.assertIsNone(data)
        self.assertIn("3.04", error)
        self.assertIn("3.03d", error)

    def test_the_supported_version_stated_explicitly_is_accepted(self):
        self.assertIsNone(TMDD(dict(VALID, tmdd_version="3.03d")).config_error)

    def test_an_out_of_range_message_type_id_is_a_configuration_error(self):
        # unsigned_byte raises ValueError, and it runs inside the request
        # builder, which runs inside _fetch. Left there, the base would
        # report a mistyped configuration field as
        # "TMDD Center-to-Center request failed: ...", naming a request that
        # was never sent. It belongs with the other configuration errors.
        for value in (256, -1, 1.5, "abc"):
            with self.subTest(value=value):
                runner = TMDD(dict(VALID, message_type_id=value))
                data, error = runner.run_query('{"resource": "events"}', None)
                self.assertIsNone(data)
                self.assertIn("message_type_id", error)
                self.assertNotIn("request failed", error)

    def test_an_out_of_range_message_type_version_is_caught_too(self):
        # Both header fields go through the same guard, and checking only the
        # first would leave the second reachable.
        data, error = TMDD(dict(VALID, message_type_version=999)).run_query('{"resource": "events"}', None)
        self.assertIsNone(data)
        self.assertIn("message_type_version", error)

    def test_the_in_range_boundaries_are_accepted(self):
        for value in (0, 255):
            with self.subTest(value=value):
                self.assertIsNone(TMDD(dict(VALID, message_type_id=value)).config_error)

    def test_a_username_without_a_password_is_refused(self):
        # Authentication is optional as a block, but both children are
        # mandatory once it is present, so half a credential can only produce
        # a schema-invalid request.
        runner = TMDD(dict(VALID, username="u", password=""))
        data, error = runner.run_query('{"resource": "dms_inventory"}', None)
        self.assertIsNone(data)
        self.assertIn("username", error)
        self.assertIn("password", error)

    def test_a_password_without_a_username_is_refused_the_same_way(self):
        runner = TMDD(dict(VALID, username="", password="s3cret-value"))
        data, error = runner.run_query('{"resource": "dms_inventory"}', None)
        self.assertIsNone(data)
        self.assertIn("username", error)
        self.assertIn("password", error)

    def test_both_credentials_absent_is_the_anonymous_case_and_is_allowed(self):
        # authentication is minOccurs="0", so a center that wants no
        # credential is a supported configuration, not a broken one.
        self.assertIsNone(TMDD(dict(VALID, username="", password="")).config_error)
        self.assertIsNone(TMDD(dict(VALID, username="u", password="s3cret-value")).config_error)

    def test_unconfigured_endpoint_fails_before_any_request(self):
        runner = TMDD({"organization_id": "ORG"})
        data, error = runner.run_query('{"resource": "dms_inventory"}', None)
        self.assertIsNone(data)
        self.assertEqual(error, "TMDD Center-to-Center: 'endpoint_url' is not configured")

    def test_unconfigured_organization_id_fails_before_any_request(self):
        runner = TMDD({"endpoint_url": "https://c2c.example.org/tmdd"})
        data, error = runner.run_query('{"resource": "dms_inventory"}', None)
        self.assertIsNone(data)
        self.assertEqual(error, "TMDD Center-to-Center: 'organization_id' is not configured")

    def test_a_missing_field_is_reported_before_a_bad_version(self):
        # Both are wrong here. The missing field is the one to name first:
        # a version complaint about a data source with no endpoint sends the
        # reader to the wrong row of the form.
        runner = TMDD({"organization_id": "ORG", "tmdd_version": "3.04"})
        self.assertEqual(runner.config_error, "TMDD Center-to-Center: 'endpoint_url' is not configured")


class TestTMDDQueryValidation(TestCase):
    def test_unknown_resource_lists_the_three_available(self):
        data, error = TMDD(VALID).run_query('{"resource": "signals"}', None)
        self.assertIsNone(data)
        self.assertIn("dms_inventory, dms_status, events", error)

    def test_the_shared_query_shape_contract_is_inherited_not_reimplemented(self):
        for query, expected in (
            ("[]", "must be a JSON object, not list"),
            ("null", "must be a JSON object, not NoneType"),
            ('{"resource": "events", "params": []}', "'params' must be a JSON object, not list"),
        ):
            with self.subTest(query=query):
                data, error = TMDD(VALID).run_query(query, None)
                self.assertIsNone(data)
                self.assertIn(expected, error)

    def test_an_unknown_param_is_rejected_rather_than_ignored(self):
        # The parent spec requires this: a misspelled filter must not become
        # an unbounded request.
        data, error = TMDD(VALID).run_query('{"resource": "events", "params": {"limt": 5}}', None)
        self.assertIsNone(data)
        self.assertIn("limt", error)

    def test_since_is_rejected_for_dms_inventory_which_has_no_timestamp(self):
        data, error = TMDD(VALID).run_query(
            '{"resource": "dms_inventory", "params": {"since": "2026-01-01T00:00:00Z"}}', None
        )
        self.assertIsNone(data)
        self.assertIn("since", error)

    def test_since_is_accepted_for_the_two_resources_that_carry_a_timestamp(self):
        # The mirror of the test above. Without it, ALLOWED_PARAMS could drop
        # "since" everywhere and only the dms_inventory case would notice.
        #
        # _fetch is stubbed because the transport has landed since this test
        # was written: what is under test is the validation in front of it,
        # and an unstubbed run posts to c2c.example.org for real.
        for resource in ("events", "dms_status"):
            with self.subTest(resource=resource):
                query = json.dumps({"resource": resource, "params": {"since": "2026-01-01T00:00:00Z"}})
                with mock.patch.object(TMDD, "_fetch", return_value=([], "")):
                    data, error = TMDD(VALID).run_query(query, None)
                self.assertIsNone(error)
                self.assertEqual(data["rows"], [])

    def test_the_allowed_param_table_is_the_one_the_ruling_describes(self):
        self.assertEqual(
            {name: sorted(params) for name, params in ALLOWED_PARAMS.items()},
            {
                "events": ["limit", "since"],
                "dms_inventory": ["limit"],
                "dms_status": ["limit", "since"],
            },
        )

    def test_the_resource_keys_and_the_param_table_cannot_drift_apart(self):
        self.assertEqual(set(TMDD.resources), set(ALLOWED_PARAMS))

    def test_a_validation_error_is_not_dressed_up_as_a_failed_request(self):
        # The family's f"{name} request failed: {e}" contract governs real
        # requests. Wrapping a config or param error in it names the runner
        # twice and describes a request that was never made.
        for configuration, query in (
            ({"organization_id": "ORG"}, '{"resource": "dms_inventory"}'),
            (dict(VALID, tmdd_version="3.04"), '{"resource": "dms_inventory"}'),
            (dict(VALID), '{"resource": "events", "params": {"limt": 5}}'),
        ):
            with self.subTest(query=query):
                _data, error = TMDD(configuration).run_query(query, None)
                self.assertNotIn("request failed", error)

    def test_noop_query_is_the_one_the_spec_names(self):
        self.assertEqual(json.loads(TMDD.noop_query), {"resource": "dms_inventory", "params": {"limit": 1}})

    def test_the_noop_query_passes_this_runners_own_validation(self):
        # A noop that its own validator rejects would break every connection
        # test. _fetch is stubbed for the reason given above.
        with mock.patch.object(TMDD, "_fetch", return_value=([], "")):
            data, error = TMDD(VALID).run_query(TMDD.noop_query, None)
        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])


class TestTMDDEnabled(TestCase):
    def test_enabled_is_true_here(self):
        self.assertTrue(TMDD.enabled())

    def test_enabled_is_false_when_defusedxml_is_missing(self):
        # enabled() is a real gate, so it is tested in BOTH states rather
        # than only the one this container happens to be in.
        #
        # A None entry in sys.modules is the import system's own "this module
        # is not available" marker: _find_and_load raises ImportError for it
        # before it ever touches the filesystem. The assertRaises below is
        # part of the test, not scaffolding: it proves the patch is live, so
        # an enabled() that stopped importing defusedxml at all could not
        # keep this test green by accident.
        with mock.patch.dict(sys.modules, {"defusedxml.ElementTree": None}):
            with self.assertRaises(ImportError):
                import defusedxml.ElementTree  # noqa: F401
            self.assertFalse(TMDD.enabled())

    def test_enabled_is_true_again_once_the_patch_is_lifted(self):
        # Guards against the gate latching: a module-level flag computed at
        # import time would answer the same both times, and the pair of
        # tests above would then be passing for the wrong reason.
        with mock.patch.dict(sys.modules, {"defusedxml.ElementTree": None}):
            self.assertFalse(TMDD.enabled())
        self.assertTrue(TMDD.enabled())

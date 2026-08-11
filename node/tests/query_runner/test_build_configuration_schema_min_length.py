"""
build_configuration_schema must reject a required-but-empty string at save
time, not let it through to a live request.

A required field only checks presence, not emptiness: without minLength, an
API client can save a data source with `{"feed_url": ""}` and it validates.
With the vendor defaults removed (the change this guards), that empty string
then reaches the vendor as a live request instead of failing at save time as
bad configuration.
"""

from unittest import TestCase

import jsonschema

from redash.query_runner.connector_base import build_configuration_schema


class TestBuildConfigurationSchemaMinLength(TestCase):
    def test_required_string_gets_min_length(self):
        schema = build_configuration_schema(
            {"feed_url": {"type": "string", "title": "Feed URL"}},
            required=["feed_url"],
        )
        self.assertEqual(schema["properties"]["feed_url"]["minLength"], 1)

    def test_optional_string_is_untouched(self):
        schema = build_configuration_schema(
            {
                "feed_url": {"type": "string", "title": "Feed URL"},
                "note": {"type": "string", "title": "Note", "default": ""},
            },
            required=["feed_url"],
        )
        self.assertNotIn("minLength", schema["properties"]["note"])

    def test_required_non_string_is_untouched(self):
        schema = build_configuration_schema(
            {
                "feed_url": {"type": "string", "title": "Feed URL"},
                "port": {"type": "number", "title": "Port"},
                "enabled": {"type": "boolean", "title": "Enabled"},
            },
            required=["feed_url", "port", "enabled"],
        )
        self.assertNotIn("minLength", schema["properties"]["port"])
        self.assertNotIn("minLength", schema["properties"]["enabled"])

    def test_common_optional_fields_are_untouched(self):
        # request_timeout, redis_url, historical_retention_days are always
        # appended by build_configuration_schema and never required.
        schema = build_configuration_schema({}, required=[])
        self.assertNotIn("minLength", schema["properties"]["request_timeout"])
        self.assertNotIn("minLength", schema["properties"]["redis_url"])

    def test_existing_min_length_is_not_overridden(self):
        schema = build_configuration_schema(
            {"feed_url": {"type": "string", "title": "Feed URL", "minLength": 5}},
            required=["feed_url"],
        )
        self.assertEqual(schema["properties"]["feed_url"]["minLength"], 5)

    def test_empty_value_fails_jsonschema_validation(self):
        schema = build_configuration_schema(
            {"feed_url": {"type": "string", "title": "Feed URL"}},
            required=["feed_url"],
        )
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate({"feed_url": ""}, schema)
        # a non-empty value still passes
        jsonschema.validate({"feed_url": "https://example.test/feed"}, schema)

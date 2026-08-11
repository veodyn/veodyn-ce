"""
The TMDD runner's generated configuration_schema, as the form receives it.

Split out of test_tmdd for the repo's 300-line limit, along the seam between
the schema a data source is SAVED against and the errors a saved data source
produces when it is queried. Nothing here builds a runner.

The character limits get behavioural assertions as well as structural ones,
because that is the distinction this module was missing. The old test read
the password field's description and looked for the string "256", which is
green for a schema that documents a limit and enforces nothing: a
300-character password was accepted, saved, posted, and refused by the
center. `ConfigurationContainer` is the thing the API actually validates
against before a data source is written, so a limit that does not stop it
there does not exist.
"""

from unittest import TestCase

from redash.query_runner.tmdd import TMDD
from redash.utils.configuration import ConfigurationContainer

VALID = {
    "endpoint_url": "https://c2c.example.org/tmdd",
    "organization_id": "ORG-1",
}

# field -> the maximum the field's own description advertises. Written out
# here rather than read back off the schema, which is the whole point: the
# numbers a reader of the v3.03d bundle can check are 32 for a user id, 256
# for a password and 32 for an organization id, and the 256 is proved in
# test_tmdd_schema_conformance by validating a 300-character password against
# the published XSD and reading XsdMaxLengthFacet(value=256) off the failure.
ADVERTISED_LIMITS = {"username": 32, "password": 256, "organization_id": 32}


class TestTMDDConfiguration(TestCase):
    def test_type_and_name(self):
        self.assertEqual(TMDD.type(), "tmdd")
        self.assertEqual(TMDD.name(), "TMDD Center-to-Center")

    def test_schema_declares_the_documented_fields_and_only_password_is_secret(self):
        schema = TMDD.configuration_schema()
        for name in (
            "endpoint_url",
            "username",
            "password",
            "organization_id",
            "tmdd_version",
            "soap_action",
            "message_type_id",
            "message_type_version",
            "verify_tls",
            "ca_bundle",
            "max_response_mb",
            "max_records",
        ):
            self.assertIn(name, schema["properties"])
        self.assertEqual(set(schema["secret"]), {"password"})
        self.assertEqual(set(schema["required"]), {"endpoint_url", "organization_id"})

    def test_the_password_field_advertises_the_limit_the_schema_actually_enforces(self):
        # Security-password is defined twice in the bundle: 256 in TMDD.xsd,
        # 32 in C2C.xsd. Authentication is declared in TMDD.xsd and refers to
        # it unprefixed, so 256 governs. Proven by validating a 300-character
        # password, which fails with XsdMaxLengthFacet(value=256).
        description = TMDD.configuration_schema()["properties"]["password"]["description"]
        self.assertIn("256", description)
        # The 32 from C2C.xsd is the wrong limit for this field, so the form
        # must not quote it: a reader who sees both numbers learns nothing.
        self.assertNotIn("32", description)

    def test_every_advertised_character_limit_is_declared_as_a_max_length(self):
        # The description was the ONLY place these numbers appeared. A
        # description is help text; jsonschema does not read it.
        properties = TMDD.configuration_schema()["properties"]
        for name, maximum in ADVERTISED_LIMITS.items():
            with self.subTest(field=name):
                self.assertEqual(properties[name]["maxLength"], maximum)

    def test_a_required_field_still_carries_the_shared_min_length(self):
        # organization_id is required, so connector_base gives it
        # minLength 1. Declaring maxLength by hand must not displace it.
        self.assertEqual(TMDD.configuration_schema()["properties"]["organization_id"]["minLength"], 1)

    def test_the_optional_credentials_carry_no_min_length(self):
        # Deliberate, and the reason build_configuration_schema only adds
        # minLength to REQUIRED strings. Both credentials empty is the
        # supported anonymous case, and a minLength here would make the form
        # refuse to save it.
        properties = TMDD.configuration_schema()["properties"]
        for name in ("username", "password"):
            with self.subTest(field=name):
                self.assertNotIn("minLength", properties[name])


class TestTheLimitsAreEnforcedAndNotOnlyDocumented(TestCase):
    """Against ConfigurationContainer, which is what the API saves through."""

    def container(self, **overrides):
        config = dict(VALID, username="u", password="p")
        config.update(overrides)
        return ConfigurationContainer(config, TMDD.configuration_schema())

    def test_a_value_one_character_over_its_limit_is_refused(self):
        # Before the fix all three saved cleanly, were posted, and were
        # refused by the center. A 300-character password fails the published
        # XSD with XsdMaxLengthFacet(value=256).
        for name, maximum in ADVERTISED_LIMITS.items():
            with self.subTest(field=name):
                self.assertFalse(self.container(**{name: "x" * (maximum + 1)}).is_valid())

    def test_a_value_exactly_at_its_limit_is_accepted(self):
        # The control. Without it a schema that refused every value of these
        # three fields would pass the test above.
        for name, maximum in ADVERTISED_LIMITS.items():
            with self.subTest(field=name):
                self.assertTrue(self.container(**{name: "x" * maximum}).is_valid())

    def test_the_anonymous_case_still_saves(self):
        # Both credentials empty is supported configuration. A minLength on
        # the optional fields would have broken it while every limit test
        # above stayed green.
        self.assertTrue(self.container(username="", password="").is_valid())

    def test_an_empty_required_field_is_still_refused(self):
        # The shared minLength on organization_id, exercised rather than
        # merely read off the schema.
        self.assertFalse(self.container(organization_id="").is_valid())


class TestTheDocumentedFieldText(TestCase):
    def test_the_undefined_header_fields_say_this_bundle_does_not_define_them(self):
        properties = TMDD.configuration_schema()["properties"]
        for name in ("message_type_id", "message_type_version"):
            with self.subTest(field=name):
                self.assertIn("does not define", properties[name]["description"])

    def test_tmdd_version_is_an_enum_with_exactly_one_value(self):
        self.assertEqual(TMDD.configuration_schema()["properties"]["tmdd_version"]["enum"], ["3.03d"])

    def test_the_documented_defaults_are_the_ones_the_form_offers(self):
        properties = TMDD.configuration_schema()["properties"]
        self.assertEqual(properties["tmdd_version"]["default"], "3.03d")
        self.assertEqual(properties["soap_action"]["default"], "")
        self.assertEqual(properties["message_type_id"]["default"], 1)
        self.assertEqual(properties["message_type_version"]["default"], 1)
        self.assertEqual(properties["verify_tls"]["default"], True)
        self.assertEqual(properties["max_response_mb"]["default"], 10)
        self.assertEqual(properties["max_records"]["default"], 10000)

    def test_the_optional_credential_and_ca_bundle_fields_carry_no_default(self):
        # A default here would be shipped configuration, and for password it
        # would be an embedded credential.
        properties = TMDD.configuration_schema()["properties"]
        for name in ("username", "password", "ca_bundle"):
            with self.subTest(field=name):
                self.assertNotIn("default", properties[name])

    def test_soap_action_documents_both_readings_of_the_wsdl_attribute(self):
        # All 80 operations declare the same raw value, two apostrophes. It
        # reads either as "empty" or as a literal action URI of '' and the
        # bundle cannot settle it, so the field exists to let a center pick.
        description = TMDD.configuration_schema()["properties"]["soap_action"]["description"]
        self.assertIn("''", description)


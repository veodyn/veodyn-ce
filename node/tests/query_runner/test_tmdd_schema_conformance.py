"""
Fixture and request conformance against the real TMDD v3.03d XSD.

The parent spec requires synthetic fixtures to be validated against the pinned
schema rather than only against our own parser, and also requires the standards
artifacts to stay out of this repository. Both hold here: the bundle is pointed
at by TMDD_BUNDLE_DIR and the whole module skips without it, so CI is
unaffected and a local run proves conformance.

A harness that silently passes when it cannot see the schema is worse than no
harness, so the skip path is exercised on purpose: run this module once with
the bundle and once with TMDD_BUNDLE_DIR=/nonexistent, and the second run must
skip rather than pass.

Measured with xmlschema 3.4.5: TMDD.xsd loads in about 0.7s and its 87 global
elements are keyed by LOCAL name, so a lookup is "dMSInventoryMsg", not the
namespace-qualified form.
"""

import os
import unittest
from xml.etree import ElementTree

from tests.query_runner.tmdd_fixtures import (
    KNOWN_GOOD_DMS_INVENTORY_REQUEST,
    KNOWN_GOOD_EVENTS_REQUEST,
)

BUNDLE = os.environ.get("TMDD_BUNDLE_DIR", "/tmp/tmdd")

_schema = None

# The same document as the known-good one, rewritten with a default xmlns on
# the root so the children inherit the TMDD namespace too. It parses to the
# same root tag and is schema-invalid, which is the failure the whole plan is
# built around.
DEFAULT_XMLNS_DMS_INVENTORY_REQUEST = KNOWN_GOOD_DMS_INVENTORY_REQUEST.replace(
    '<tmdd:deviceInformationRequestMsg xmlns:tmdd="http://www.tmdd.org/303/messages">',
    '<deviceInformationRequestMsg xmlns="http://www.tmdd.org/303/messages">',
).replace("</tmdd:deviceInformationRequestMsg>", "</deviceInformationRequestMsg>")

# `authentication` is a SIBLING of `request-header` and precedes it, not a
# child of it. Put it anywhere else and the document fails on sequence order
# before the password is ever looked at, which would make this test pass for
# the wrong reason.
_AUTHENTICATION_WITH_LONG_PASSWORD = (
    "<authentication><user-id>u</user-id><password>" + "p" * 300 + "</password></authentication>"
)
EVENTS_REQUEST_WITH_300_CHAR_PASSWORD = KNOWN_GOOD_EVENTS_REQUEST.replace(
    "<request-header>", _AUTHENTICATION_WITH_LONG_PASSWORD + "<request-header>", 1
)


def bundle_available():
    return os.path.isfile(os.path.join(BUNDLE, "TMDD.xsd"))


def schema():
    """The parsed TMDD schema, loaded once per process."""
    global _schema
    if _schema is None:
        import xmlschema

        _schema = xmlschema.XMLSchema(os.path.join(BUNDLE, "TMDD.xsd"))
    return _schema


def assert_conforms(xml, element_local_name):
    """Raise xmlschema's validation error if `xml` is not schema-valid.

    `element_local_name` is checked against the root, so a document that is
    valid as some other message does not quietly count as conformance for the
    message the caller meant.
    """
    if not bundle_available():
        raise unittest.SkipTest(f"TMDD bundle not present at {BUNDLE}")
    root = ElementTree.fromstring(xml)
    actual = root.tag.rpartition("}")[2]
    if actual != element_local_name:
        raise AssertionError(f"root element is {actual!r}, expected {element_local_name!r}")
    schema().validate(root)


@unittest.skipUnless(bundle_available(), f"TMDD bundle not present at {BUNDLE}")
class TestTheHarnessItself(unittest.TestCase):
    def test_a_known_good_request_validates(self):
        assert_conforms(KNOWN_GOOD_DMS_INVENTORY_REQUEST, "deviceInformationRequestMsg")

    def test_the_default_xmlns_form_is_rejected(self):
        # The harness has to be able to FAIL, and this is the exact failure
        # the whole plan is built around. Both documents parse; only the
        # prefixed one validates.
        import xmlschema

        with self.assertRaises(xmlschema.XMLSchemaValidationError) as caught:
            assert_conforms(DEFAULT_XMLNS_DMS_INVENTORY_REQUEST, "deviceInformationRequestMsg")
        # Assert on the diagnosis, not just on the failure: the child is
        # rejected for being namespace-qualified. Any validation error at all
        # would also be raised by a document that is merely malformed.
        self.assertIn("{http://www.tmdd.org/303/messages}organization-information", caught.exception.reason)

    def test_a_password_over_256_characters_is_rejected(self):
        # Proves the harness catches a facet violation, and pins the limit
        # that the configuration form advertises.
        import xmlschema

        with self.assertRaises(xmlschema.XMLSchemaValidationError) as caught:
            assert_conforms(EVENTS_REQUEST_WITH_300_CHAR_PASSWORD, "eventRequestMsg")
        # Without this the test also passes when `authentication` sits in the
        # wrong place, because sequence order is checked before the facet is.
        validator = caught.exception.validator
        self.assertEqual(type(validator).__name__, "XsdMaxLengthFacet")
        self.assertEqual(validator.value, 256)

    def test_the_expected_element_name_is_load_bearing(self):
        # Without this, the second argument is decoration and a fixture could
        # be validated as the wrong message without anyone noticing.
        with self.assertRaises(AssertionError):
            assert_conforms(KNOWN_GOOD_EVENTS_REQUEST, "deviceInformationRequestMsg")

"""
The TMDD v3.03d request builder.

The load-bearing test in here is the conformance one: it hands every request
the builder produces to the real published XSD. Without it the rest only
prove the builder agrees with the expectations written beside it, and the one
mistake this whole plan exists to catch, a default `xmlns` on the message root
pulling every child into the TMDD namespace, produces a document that parses
identically at the root and passes any test that inspects only the root.

The conformance test skips when the bundle is absent (TMDD_BUNDLE_DIR), so CI
without the standards artifacts still runs everything else here.
"""

import datetime
import unittest
from xml.etree import ElementTree as ET

from redash.query_runner.tmdd_request import (
    ENVELOPE_NS,
    build_request,
    soap_action_header,
)
from tests.query_runner.test_tmdd_schema_conformance import assert_conforms
from tests.query_runner.tmdd_fixtures import (
    KNOWN_GOOD_DMS_INVENTORY_REQUEST,
    KNOWN_GOOD_EVENTS_REQUEST,
)

UTC = datetime.timezone.utc

CONFIG = {
    "endpoint_url": "https://center.example.gov/tmdd/services",
    "organization_id": "ORG-1",
    "username": "",
    "password": "",
    "message_type_id": 1,
    "message_type_version": 1,
}

RESOURCES = ("events", "dms_inventory", "dms_status")


def _body_of_element(raw):
    """The single child of soap:Body, as an Element."""
    envelope = ET.fromstring(raw)
    assert envelope.tag == f"{{{ENVELOPE_NS}}}Envelope", envelope.tag
    body = envelope.find(f"{{{ENVELOPE_NS}}}Body")
    assert body is not None, "no soap:Body"
    children = list(body)
    assert len(children) == 1, f"soap:Body holds {len(children)} children, expected 1"
    return children[0]


def _body_of(raw):
    """The message element on its own, re-serialised for the validator."""
    return ET.tostring(_body_of_element(raw))


class TestTMDDRequestBuilder(unittest.TestCase):
    def test_every_built_request_validates_against_the_real_xsd(self):
        # This is the test that makes the rest meaningful. Without it, the
        # suite only proves our builder agrees with our own expectations.
        for resource, element in (
            ("events", "eventRequestMsg"),
            ("dms_inventory", "deviceInformationRequestMsg"),
            ("dms_status", "deviceInformationRequestMsg"),
        ):
            with self.subTest(resource=resource):
                assert_conforms(_body_of(build_request(resource, CONFIG, {})), element)

    def test_a_request_with_authentication_validates_too(self):
        # The optional block is the half of the surface the no-credential
        # config never reaches, and it sits at a different place in each of
        # the two request types' sequences.
        authenticated = dict(CONFIG, username="operator", password="s3cret")
        for resource, element in (
            ("events", "eventRequestMsg"),
            ("dms_inventory", "deviceInformationRequestMsg"),
        ):
            with self.subTest(resource=resource):
                message = _body_of_element(build_request(resource, authenticated, {}))
                self.assertEqual(message.findtext("authentication/user-id"), "operator")
                self.assertEqual(message.findtext("authentication/password"), "s3cret")
                assert_conforms(ET.tostring(message), element)

    def test_only_the_root_body_element_is_namespace_qualified(self):
        message = _body_of_element(build_request("dms_inventory", CONFIG, {}))
        self.assertEqual(message.tag, "{http://www.tmdd.org/303/messages}deviceInformationRequestMsg")
        for child in message.iter():
            if child is not message:
                self.assertNotIn("}", child.tag, f"{child.tag} must be unqualified")

    def test_no_descendant_of_any_request_is_qualified(self):
        # The one above pins the shape for a single resource. This one is the
        # guard: a new element added to any builder cannot pick up a
        # namespace without going red.
        for resource in RESOURCES:
            with self.subTest(resource=resource):
                message = _body_of_element(build_request(resource, dict(CONFIG, username="u", password="p"), {}))
                qualified = [child.tag for child in message.iter() if child is not message and "}" in child.tag]
                self.assertEqual(qualified, [])

    def test_the_two_dms_resources_differ_only_by_the_discriminator(self):
        inv = _body_of_element(build_request("dms_inventory", CONFIG, {}))
        sts = _body_of_element(build_request("dms_status", CONFIG, {}))
        self.assertEqual(inv.findtext("device-type"), "dynamic message sign")
        self.assertEqual(inv.findtext("device-information-type"), "device inventory")
        self.assertEqual(sts.findtext("device-type"), "dynamic message sign")
        self.assertEqual(sts.findtext("device-information-type"), "device status")
        self.assertEqual(
            [child.tag for child in inv],
            [child.tag for child in sts],
        )

    def test_the_event_request_puts_org_id_inside_request_header(self):
        # findtext with a BARE path, resolved from the qualified root element
        # itself. A ".//eventRequestMsg/..." XPath cannot match a qualified
        # root and returns None whatever the request contains, so it would
        # pass against a wrong document.
        msg = _body_of_element(build_request("events", CONFIG, {}))
        self.assertEqual(msg.tag, "{http://www.tmdd.org/303/messages}eventRequestMsg")
        self.assertIsNone(msg.find("organization-information"))
        self.assertEqual(msg.findtext("request-header/organization-information/organization-id"), "ORG-1")
        self.assertEqual(msg.findtext("request-type/request-focus"), "all current events")

    def test_the_dms_request_puts_org_id_at_the_root(self):
        # The mirror of the one above. The two request types carry the
        # requester's identity at different depths, and putting it at the
        # wrong one is a document the center rejects.
        msg = _body_of_element(build_request("dms_inventory", CONFIG, {}))
        self.assertIsNone(msg.find("request-header"))
        self.assertEqual(msg.findtext("organization-information/organization-id"), "ORG-1")

    def test_xml_metacharacters_are_escaped_by_construction(self):
        hostile = dict(CONFIG, organization_id='a&b<c>"d\'e')
        raw = build_request("events", hostile, {})
        self.assertNotIn(b"<c>", raw)
        msg = _body_of_element(raw)
        self.assertEqual(msg.findtext("request-header/organization-information/organization-id"), 'a&b<c>"d\'e')

    def test_non_ascii_survives_a_round_trip(self):
        msg = _body_of_element(build_request("events", dict(CONFIG, organization_id="Köln"), {}))
        self.assertEqual(msg.findtext("request-header/organization-information/organization-id"), "Köln")

    def test_authentication_is_omitted_entirely_when_no_username_is_configured(self):
        # Authentication is minOccurs="0". An empty <authentication/> is NOT
        # the same as absent: it asserts a user-id of "", which the schema
        # rejects.
        for resource in RESOURCES:
            with self.subTest(resource=resource):
                msg = _body_of_element(build_request(resource, dict(CONFIG, username="", password=""), {}))
                self.assertIsNone(msg.find("authentication"))

    def test_the_soap_action_header_value_is_configurable(self):
        # The WSDL attribute is the two-character string '' , not an empty
        # string, and the bundle cannot settle which the center expects.
        self.assertEqual(soap_action_header({}), '""')
        self.assertEqual(soap_action_header(CONFIG), '""')
        self.assertEqual(soap_action_header({"soap_action": "''"}), "\"''\"")

    def test_no_request_carries_a_control_or_command_element(self):
        for resource in RESOURCES:
            with self.subTest(resource=resource):
                text = build_request(resource, CONFIG, {}).decode()
                for banned in ("control", "command", "Control"):
                    self.assertNotIn(banned, text)

    def test_the_message_time_stamp_is_the_composite_shape_not_an_iso_string(self):
        # Date is xs:string length 8 and Time is minLength 6 / maxLength 10,
        # so neither can hold an ISO-8601 datetime.
        stamp = _body_of_element(build_request("events", CONFIG, {})).find("request-header/message-time-stamp")
        self.assertIsNotNone(stamp)
        self.assertEqual([child.tag for child in stamp], ["date", "time", "offset"])
        self.assertEqual(len(stamp.findtext("date")), 8)
        self.assertTrue(stamp.findtext("date").isdigit())
        self.assertEqual(len(stamp.findtext("time")), 6)
        self.assertTrue(stamp.findtext("time").isdigit())
        self.assertEqual(len(stamp.findtext("offset")), 5)

    def test_the_timestamp_comes_from_the_supplied_clock(self):
        # Pinning the format needs a fixed instant, and a builder that
        # ignored `now` would make every format assertion above vacuous.

        instant = datetime.datetime(2026, 8, 7, 15, 30, 0, tzinfo=UTC)
        stamp = _body_of_element(build_request("events", CONFIG, {}, now=instant)).find(
            "request-header/message-time-stamp"
        )
        self.assertEqual(stamp.findtext("date"), "20260807")
        self.assertEqual(stamp.findtext("time"), "153000")
        self.assertEqual(stamp.findtext("offset"), "+0000")

    def test_a_non_utc_offset_is_rendered_as_five_characters(self):

        instant = datetime.datetime(
            2026, 1, 2, 3, 4, 5, tzinfo=datetime.timezone(-datetime.timedelta(hours=7, minutes=30))
        )
        stamp = _body_of_element(build_request("events", CONFIG, {}, now=instant)).find(
            "request-header/message-time-stamp"
        )
        self.assertEqual(stamp.findtext("date"), "20260102")
        self.assertEqual(stamp.findtext("time"), "030405")
        self.assertEqual(stamp.findtext("offset"), "-0730")

    def test_a_naive_clock_emits_no_offset_rather_than_a_guessed_one(self):

        stamp = _body_of_element(
            build_request("events", CONFIG, {}, now=datetime.datetime(2026, 8, 7, 15, 30, 0))
        ).find("request-header/message-time-stamp")
        self.assertEqual([child.tag for child in stamp], ["date", "time"])

    def test_the_header_message_type_fields_come_from_configuration(self):
        msg = _body_of_element(build_request("events", dict(CONFIG, message_type_id=7, message_type_version=2), {}))
        self.assertEqual(msg.findtext("request-header/message-type-id"), "7")
        self.assertEqual(msg.findtext("request-header/message-type-version"), "2")

    def test_the_message_type_fields_fall_back_to_the_configured_defaults(self):
        stripped = {key: value for key, value in CONFIG.items() if not key.startswith("message_type")}
        msg = _body_of_element(build_request("events", stripped, {}))
        self.assertEqual(msg.findtext("request-header/message-type-id"), "1")
        self.assertEqual(msg.findtext("request-header/message-type-version"), "1")

    def test_a_message_type_outside_the_unsigned_byte_range_is_refused(self):
        # Both fields are xs:unsignedByte. 256 builds a document the center's
        # own schema rejects, and a request that cannot validate is worth
        # refusing here rather than discovering on the wire.
        with self.assertRaises(ValueError) as caught:
            build_request("events", dict(CONFIG, message_type_id=256), {})
        self.assertIn("message_type_id", str(caught.exception))

    def test_an_unknown_resource_is_refused(self):
        with self.assertRaises(ValueError) as caught:
            build_request("dms_control", CONFIG, {})
        self.assertIn("dms_control", str(caught.exception))

    def test_params_do_not_reach_the_wire(self):
        # `since` and `limit` are applied client-side after decode: no v3.03d
        # request type carries either. If a later change starts encoding one,
        # this goes red rather than silently sending a filter the center
        # interprets differently.

        instant = datetime.datetime(2026, 8, 7, 15, 30, 0, tzinfo=UTC)
        for resource in RESOURCES:
            with self.subTest(resource=resource):
                bare = build_request(resource, CONFIG, {}, now=instant)
                filtered = build_request(resource, CONFIG, {"since": "2026-08-01T00:00:00Z", "limit": 5}, now=instant)
                self.assertEqual(bare, filtered)

    def test_the_envelope_is_soap_11_and_utf8_encoded(self):
        raw = build_request("dms_inventory", CONFIG, {})
        self.assertIsInstance(raw, bytes)
        self.assertIn(b"http://schemas.xmlsoap.org/soap/envelope/", raw)
        self.assertNotIn(b"http://www.w3.org/2003/05/soap-envelope", raw)
        raw.decode("utf-8")

    def test_the_built_requests_match_the_known_good_fixtures(self):
        # The fixtures were validated against the XSD before this builder
        # existed. Byte equality with them proves the builder reproduces the
        # shape that was proven, prefix and element order included, and it
        # holds on a machine with no bundle where assert_conforms only skips.
        self.assertEqual(
            _body_of(build_request("dms_inventory", CONFIG, {})).decode(),
            KNOWN_GOOD_DMS_INVENTORY_REQUEST,
        )

        instant = datetime.datetime(2026, 8, 7, 15, 30, 0)
        events = build_request("events", dict(CONFIG, organization_id="O"), {}, now=instant)
        self.assertEqual(_body_of(events).decode(), KNOWN_GOOD_EVENTS_REQUEST)

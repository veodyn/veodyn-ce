"""
The TMDD v3.03d response decoder.

Two things this module is deliberately built to catch, because both fail
SILENTLY rather than loudly:

1. A response whose children are namespace-qualified. TMDD declares
   elementFormDefault="unqualified", so a center that writes a default
   `xmlns` on the root produces a document that parses, has the right root
   tag, and matches nothing underneath. A decoder searching bare names finds
   zero records and reports "the center had no signs". Two fixtures pin that
   as an error instead.
2. A column set inferred from the first record. SPARSE_FIRST_RECORD puts the
   sparse device first on purpose.

The expected column set is written out LITERALLY, in test_tmdd_columns, and
imported here. Comparing the decoder's output to the decoder's own
RESOURCE_COLUMNS passes when a column is missing from both, which is the
shared-omission defect this codebase has shipped before.
"""

import json
import unittest

from redash.query_runner.tmdd_decode import TMDDResponseError, decode
from tests.query_runner.test_tmdd_columns import EXPECTED_COLUMNS
from tests.query_runner.test_tmdd_schema_conformance import assert_conforms
from tests.query_runner.tmdd_fixtures import (
    CONFORMANT_FIXTURES,
    CONTENT_IN_BOTH_DETAILS,
    DEVICE_WITH_ONLY_LINK_NAME,
    DEVICE_WITH_ROUTE_DESIGNATOR,
    EVENT_WITH_EVERY_OPTIONAL_BLOCK_ABSENT,
    ONE_DEVICE_AT_KNOWN_COORDS,
    SPARSE_FIRST_RECORD,
    WITH_LAST_COMM_TIME,
)
from tests.query_runner.tmdd_malformed_fixtures import (
    DEFAULT_XMLNS_RESPONSE,
    FOREIGN_NAMESPACE_RESPONSE,
    NON_CONFORMANT_EMPTY_RESPONSE,
)


class TestTheFixturesThemselves(unittest.TestCase):
    def test_every_conformant_fixture_actually_conforms(self):
        # Without this, the decode tests below only prove the decoder agrees
        # with XML this repository wrote for it.
        for name, (xml, element) in CONFORMANT_FIXTURES.items():
            with self.subTest(fixture=name):
                assert_conforms(xml, element)


class TestTheColumnContract(unittest.TestCase):
    def test_a_sparse_first_record_does_not_narrow_the_table(self):
        records = decode("dms_inventory", SPARSE_FIRST_RECORD)
        self.assertEqual(len(records), 2)
        for record in records:
            self.assertEqual(set(record), set(EXPECTED_COLUMNS["dms_inventory"]))
        # The sparse record is first, and its optional fields are absent
        # rather than borrowed from the fuller record after it.
        self.assertEqual(records[0]["device_id"], "DMS-002")
        self.assertIsNone(records[0]["roadway"])
        self.assertIsNone(records[0]["direction"])
        self.assertEqual(records[1]["direction"], "n")

    def test_every_resource_decodes_exactly_its_declared_keys(self):
        for resource, xml in (
            ("dms_inventory", ONE_DEVICE_AT_KNOWN_COORDS),
            ("dms_status", WITH_LAST_COMM_TIME),
            ("events", CONTENT_IN_BOTH_DETAILS),
        ):
            with self.subTest(resource=resource):
                self.assertEqual(set(decode(resource, xml)[0]), set(EXPECTED_COLUMNS[resource]))


class TestEventShape(unittest.TestCase):
    def test_repeats_keep_their_content_across_every_element_detail(self):
        # Two things at once, and the fixture had to change for the second.
        # Asserting only len() passes against [{}, {}, {}], which discards
        # every branch value while the suite stays green. And the fourth
        # entry comes from the SECOND element-detail: while every description
        # sat in the first, `descriptions` could stop traversing the outer
        # repeat and this list would be unchanged.
        record = decode("events", CONTENT_IN_BOTH_DETAILS)[0]
        self.assertEqual(
            json.loads(record["descriptions"]),
            [
                {"kind": "additional-text", "value": {"description": "First description text"}},
                {"kind": "quantity", "value": {"extent": {"length-affected": "2"}}},
                {"kind": "additional-text", "value": {"description": "Third"}},
                {"kind": "additional-text", "value": {"description": "Second detail text"}},
            ],
        )

    def test_the_flat_description_comes_from_the_event_comment(self):
        # Two paths compete for this column: event-comments/event-comment,
        # which is the one the decoder reads, and the first
        # additional-text/description. They carried the same string, so the
        # column could regress to the other path with the suite green.
        record = decode("events", CONTENT_IN_BOTH_DETAILS)[0]
        self.assertEqual(record["description"], "Center comment on EVT-000123")

    def test_every_location_branch_is_kept_whole_across_both_details(self):
        locations = json.loads(decode("events", CONTENT_IN_BOTH_DETAILS)[0]["locations"])
        # The third is the second detail's, on a third branch of the choice.
        self.assertEqual(
            [location["kind"] for location in locations],
            ["location-on-link", "area-location", "geo-location"],
        )
        self.assertEqual(
            locations[0]["value"],
            {
                "link-designator": "I-5",
                "link-name": "Interstate 5",
                "primary-location": {
                    "geo-location": {"latitude": "47606200", "longitude": "-122332100"},
                    "link-name": "I-5 at Union St",
                },
                "link-direction": "n",
            },
        )
        self.assertEqual(locations[1]["value"], {"area-id": "KINGCOUNTY", "area-name": "King County"})
        self.assertEqual(locations[2]["value"], {"latitude": "47000000", "longitude": "-122000000"})

    def test_the_event_type_is_the_branch_name_and_the_code_is_its_content(self):
        record = decode("events", CONTENT_IN_BOTH_DETAILS)[0]
        self.assertEqual(record["event_type"], "accidents-and-incidents")
        self.assertEqual(record["event_type_code"], "injury accident")

    def test_the_flat_columns_come_from_the_first_carrier_of_each_field(self):
        record = decode("events", CONTENT_IN_BOTH_DETAILS)[0]
        self.assertEqual(record["event_id"], "EVT-000123")
        self.assertEqual(record["severity"], "major")
        self.assertEqual(record["status"], "confirmed")
        self.assertEqual(record["roadway"], "I-5")
        self.assertEqual(record["direction"], "n")
        self.assertEqual(record["latitude_raw"], 47606200)
        self.assertEqual(record["start_time"], "2026-08-07T14:30:00+00:00")

    def test_the_flat_place_columns_stay_with_the_first_detail(self):
        # The second detail now carries a location of its own, at a different
        # place. `direction` and the coordinates read the FIRST detail only,
        # and the full cardinality is in `locations`. Without a second detail
        # carrying anything, that documented rule was untested.
        record = decode("events", CONTENT_IN_BOTH_DETAILS)[0]
        self.assertEqual(record["latitude_raw"], 47606200)
        self.assertNotEqual(record["latitude_raw"], 47000000)

    def test_the_diverging_per_detail_times_are_all_kept(self):
        # event-element-detail repeats 0..64 and each carries its own
        # required update-time, so the flat update_time cannot represent them.
        #
        # The flat one is the RECORD-level event-reference/update-time and is
        # deliberately none of the per-detail values: while it matched the
        # first detail's, this column could regress to the per-detail path.
        record = decode("events", CONTENT_IN_BOTH_DETAILS)[0]
        self.assertEqual(record["update_time"], "2026-08-07T15:45:00+00:00")
        self.assertEqual(
            json.loads(record["update_times"]),
            ["2026-08-07T15:00:00+00:00", "2026-08-07T15:15:00+00:00"],
        )

    def test_an_event_with_every_optional_block_absent_still_carries_every_column(self):
        record = decode("events", EVENT_WITH_EVERY_OPTIONAL_BLOCK_ABSENT)[0]
        self.assertEqual(set(record), set(EXPECTED_COLUMNS["events"]))
        self.assertEqual(record["event_id"], "EVT-000123")
        for absent in ("event_type", "event_type_code", "severity", "status", "description", "roadway"):
            with self.subTest(column=absent):
                self.assertIsNone(record[absent])
        self.assertEqual(json.loads(record["descriptions"]), [])
        self.assertEqual(json.loads(record["update_times"]), [])


class TestTheDeviceRoadwayPaths(unittest.TestCase):
    def test_the_dms_roadway_uses_the_device_paths_not_the_event_paths(self):
        # A DMS record has no location-on-link structure. Applying the event
        # precedence here returns None for every device.
        self.assertEqual(decode("dms_inventory", DEVICE_WITH_ROUTE_DESIGNATOR)[0]["roadway"], "I-5")

    def test_the_dms_roadway_falls_back_to_the_link_name(self):
        # Proves the precedence above is a precedence and not a single path:
        # this device has link-name and no route-designator.
        self.assertEqual(decode("dms_inventory", DEVICE_WITH_ONLY_LINK_NAME)[0]["roadway"], "State Route 167")

    def test_the_device_type_is_the_request_discriminator_not_the_sign_hardware(self):
        # dms-sign-type is "vmsFull" in this fixture. It is sign hardware
        # technology and must not be conflated with Device-type.
        self.assertEqual(decode("dms_inventory", ONE_DEVICE_AT_KNOWN_COORDS)[0]["device_type"], "dynamic message sign")


class TestNamespaceHandling(unittest.TestCase):
    def test_a_response_in_a_foreign_namespace_is_rejected(self):
        with self.assertRaises(TMDDResponseError):
            decode("events", FOREIGN_NAMESPACE_RESPONSE)

    def test_a_qualified_child_element_is_not_silently_read_as_empty(self):
        # A center that wrongly declares a default xmlns produces children in
        # the TMDD namespace. Returning zero rows would read as "no events".
        with self.assertRaises(TMDDResponseError) as caught:
            decode("events", DEFAULT_XMLNS_RESPONSE)
        # Assert on the diagnosis, not just on the failure. Any raise at all
        # would also come from a document that is merely malformed.
        self.assertIn("namespace-qualified", str(caught.exception))

    def test_a_soap_envelope_is_unwrapped(self):
        enveloped = (
            '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
            + ONE_DEVICE_AT_KNOWN_COORDS
            + "</soap:Body></soap:Envelope>"
        )
        self.assertEqual(decode("dms_inventory", enveloped)[0]["device_id"], "DMS-001")

    def test_the_wrong_message_for_the_resource_is_rejected(self):
        with self.assertRaises(TMDDResponseError) as caught:
            decode("dms_status", ONE_DEVICE_AT_KNOWN_COORDS)
        self.assertIn("dMSStatusMsg", str(caught.exception))


class TestDegenerateInput(unittest.TestCase):
    def test_a_non_conformant_empty_response_decodes_to_no_rows_without_raising(self):
        self.assertEqual(decode("dms_inventory", NON_CONFORMANT_EMPTY_RESPONSE), [])

    def test_a_body_that_is_not_xml_is_reported_as_a_response_error(self):
        # A proxy returning a plain-text error page is the common case, and
        # the raw ParseError names a byte offset rather than the connector.
        with self.assertRaises(TMDDResponseError):
            decode("dms_inventory", b"502 Bad Gateway")

    def test_an_unknown_resource_names_the_resources_that_do_exist(self):
        with self.assertRaises(ValueError) as caught:
            decode("cctv_inventory", ONE_DEVICE_AT_KNOWN_COORDS)
        self.assertIn("dms_inventory", str(caught.exception))

"""
How the decoder reads a single SCALAR value out of a TMDD document.

Split out of test_tmdd_decode for the repo's 300-line limit, along the seam
between reading one value and walking a document: nothing here cares which
element carries the value or how many times it repeats, and nothing in
test_tmdd_decode asserts what a value turns into. Both halves still go
through the public `decode`, because a helper tested directly proves only
that the helper works and not that the decoder calls it.

Three properties, and each has a control beside it so the assertion cannot
pass for the trivial reason:

1. An enumerated value is carried VERBATIM and gets no `_raw` sibling.
2. A value that is genuinely transformed keeps its raw form beside it, and
   `current_message`, which the documentation promises is returned exactly
   as sent, is not transformed at all.
3. A coordinate is bounds-checked before it is divided.
"""

import unittest

from redash.query_runner.tmdd_decode import TMDDResponseError, decode
from tests.query_runner.tmdd_fixtures import (
    BLANK_CURRENT_MESSAGE,
    ONE_DEVICE_AT_KNOWN_COORDS,
    OPER_STATUS_AS_INTEGER,
    OPER_STATUS_AS_STRING,
    PADDED_MESSAGE_AND_PADDED_DEVICE_ID,
    WITH_LAST_COMM_TIME,
)
from tests.query_runner.tmdd_malformed_fixtures import (
    DEVICE_AT_IMPOSSIBLE_LATITUDE,
    DEVICE_AT_IMPOSSIBLE_LONGITUDE,
    DEVICE_ONE_PAST_THE_LATITUDE_BOUND,
    DEVICE_ONE_PAST_THE_LONGITUDE_BOUND,
    NO_CURRENT_MESSAGE_ELEMENT,
)


class TestEnumeratedValues(unittest.TestCase):
    def test_an_integer_enum_value_arrives_verbatim_and_is_not_translated(self):
        # 88 of 207 named simple types are integer-or-string unions with no
        # mapping asserted. Time-reference-code proves positional inference is
        # unsafe: 4 integers against 5 strings.
        self.assertEqual(decode("dms_status", OPER_STATUS_AS_INTEGER)[0]["oper_status"], "3")

    def test_a_string_enum_value_arrives_verbatim(self):
        self.assertEqual(decode("dms_status", OPER_STATUS_AS_STRING)[0]["oper_status"], "out of service")

    def test_no_raw_sibling_is_invented_for_an_enumerated_column(self):
        # The coordinate columns keep a _raw sibling because a real
        # transformation happens there. Nothing is transformed here, so a
        # sibling would only be a second copy of the same characters.
        self.assertNotIn("oper_status_raw", decode("dms_status", OPER_STATUS_AS_INTEGER)[0])


class TestTransformedValues(unittest.TestCase):
    def test_coordinates_are_converted_and_the_raw_value_kept(self):
        record = decode("dms_inventory", ONE_DEVICE_AT_KNOWN_COORDS)[0]
        self.assertEqual(record["latitude_raw"], 47606200)
        self.assertAlmostEqual(record["latitude"], 47.6062, places=6)
        self.assertEqual(record["longitude_raw"], -122332100)
        self.assertAlmostEqual(record["longitude"], -122.3321, places=6)

    def test_the_current_message_is_returned_exactly_as_the_center_sent_it(self):
        # docs/docs/connectors.md states this column is returned exactly as
        # sent and that nothing strips or interprets it. The shared scalar
        # reader ends in `(found.text or "").strip() or None`, so before the
        # fix it destroyed the padding, and MULTI is a markup language in
        # which whitespace is significant.
        record = decode("dms_status", PADDED_MESSAGE_AND_PADDED_DEVICE_ID)[0]
        self.assertEqual(record["current_message"], "  [jl3]  KEEP RIGHT  ")

    def test_the_other_scalar_columns_still_lose_their_padding(self):
        # The control for the test above, in the SAME document: the fix is a
        # verbatim reader for the one field the docs promise, not text()
        # losing its strip for every column in the connector.
        record = decode("dms_status", PADDED_MESSAGE_AND_PADDED_DEVICE_ID)[0]
        self.assertEqual(record["device_id"], "DMS-001")

    def test_a_blank_sign_is_an_empty_string_and_not_a_missing_value(self):
        # An empty <current-message/> is a legitimately blank sign, which is
        # a value. `or None` collapsed it into the same answer as a center
        # that never reported the element.
        self.assertEqual(decode("dms_status", BLANK_CURRENT_MESSAGE)[0]["current_message"], "")

    def test_an_absent_current_message_element_is_still_none(self):
        # The other half of the distinction, and the half that would be lost
        # by a fix that simply returned "" for everything.
        self.assertIsNone(decode("dms_status", NO_CURRENT_MESSAGE_ELEMENT)[0]["current_message"])

    def test_a_composite_date_time_zone_becomes_an_iso_string(self):
        self.assertEqual(decode("dms_status", WITH_LAST_COMM_TIME)[0]["last_update"], "2026-08-07T15:30:00+00:00")

    def test_the_beacon_digit_becomes_a_boolean(self):
        # DmsMessageBeacon is an unsignedByte restricted to {0, 1}, not
        # xs:boolean, so this mapping is the connector's own.
        self.assertIs(decode("dms_status", WITH_LAST_COMM_TIME)[0]["beacon_on"], True)


class TestCoordinateBounds(unittest.TestCase):
    """Section 7 of the matrix records these as MANDATORY bounds.

    The decoder refuses an enumerated value the center's own schema rejects,
    and a coordinate is a stronger case than an enumeration: it is actively
    transformed rather than carried through, so an out-of-range integer
    becomes a successful row claiming a place that does not exist.
    """

    def test_a_latitude_outside_the_declared_range_is_refused(self):
        with self.assertRaises(TMDDResponseError) as caught:
            decode("dms_inventory", DEVICE_AT_IMPOSSIBLE_LATITUDE)
        # The diagnosis, not merely a raise: a bare assertRaises would also
        # be satisfied by a document that failed to parse.
        self.assertIn("latitude", str(caught.exception))
        self.assertIn("999000000", str(caught.exception))

    def test_a_longitude_outside_the_declared_range_is_refused(self):
        with self.assertRaises(TMDDResponseError) as caught:
            decode("dms_inventory", DEVICE_AT_IMPOSSIBLE_LONGITUDE)
        self.assertIn("longitude", str(caught.exception))

    def test_the_two_axes_do_not_share_one_bound(self):
        # 180000000 is a valid longitude and an invalid latitude. A single
        # shared limit would accept both or refuse both, and either way one
        # of the two columns would be wrong.
        for xml in (DEVICE_ONE_PAST_THE_LATITUDE_BOUND, DEVICE_ONE_PAST_THE_LONGITUDE_BOUND):
            with self.subTest(xml=xml[:0]):
                with self.assertRaises(TMDDResponseError):
                    decode("dms_inventory", xml)

    def test_an_ordinary_in_range_coordinate_is_still_accepted(self):
        # The control. Without it a decoder that refused every coordinate
        # would pass every test above.
        record = decode("dms_inventory", ONE_DEVICE_AT_KNOWN_COORDS)[0]
        self.assertEqual(record["latitude_raw"], 47606200)

    def test_the_bound_itself_is_inside_the_range(self):
        # The bounds are inclusive: plus or minus 90 degrees is the pole and
        # plus or minus 180 is the antimeridian, both real places.
        at_the_pole = ONE_DEVICE_AT_KNOWN_COORDS.replace(
            "<latitude>47606200</latitude>", "<latitude>90000000</latitude>"
        ).replace("<longitude>-122332100</longitude>", "<longitude>-180000000</longitude>")
        record = decode("dms_inventory", at_the_pole)[0]
        self.assertEqual(record["latitude"], 90.0)
        self.assertEqual(record["longitude"], -180.0)


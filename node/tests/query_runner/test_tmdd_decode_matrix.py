"""
The enumerations the decoder validates against, transcribed from the matrix.

Every value list below is written out as a literal, in declaration order, and
the dictionary under test is never iterated to produce the expectation. A test
that walks `ENUMERATIONS` and compares it to itself passes for a table with a
value missing, a value misspelled, or a table that is empty.

A table equal to a literal list still proves nothing if nothing reads it, so
each enumeration also gets one assertion that fails when the table is unused.
For the five the decoder reads, that is a decode of a response carrying a
plausible near miss, which must be refused rather than passed through. For the
three the REQUEST builder owns, it is a membership check against the constants
that module actually sends: those three never appear in a response at all, so
there is no decode path to exercise, and a table with no reader is exactly the
defect this module exists to prevent.

Counts are asserted separately from contents. `Time-reference-code` (4
integers against 5 strings) is the matrix's proof that the integer range and
the string list are independent facts, so a table whose string count silently
drifts to match its integer range is a real failure mode.
"""

import unittest

from redash.query_runner.tmdd_decode import TMDDResponseError, decode
from redash.query_runner.tmdd_request import (
    DEVICE_INFORMATION_TYPES,
    DEVICE_TYPE_DMS,
    EVENT_REQUEST_FOCUS,
)
from redash.query_runner.tmdd_rows import ENUMERATIONS
from tests.query_runner.tmdd_fixtures import (
    ONE_DEVICE_AT_KNOWN_COORDS,
    OPER_STATUS_AS_INTEGER,
)
from tests.query_runner.tmdd_malformed_fixtures import (
    DEVICE_STATUS_WITH_UNKNOWN_OPER_STATUS,
    DEVICE_WITH_UNKNOWN_DIRECTION_VALUE,
    EVENT_WITH_UNKNOWN_CATEGORY_VALUE,
    EVENT_WITH_UNKNOWN_DIRECTION_VALUE,
    EVENT_WITH_UNKNOWN_SEVERITY_VALUE,
    EVENT_WITH_UNKNOWN_STATUS_VALUE,
)

DEVICE_TYPE = (
    "detector",
    "cctv camera",
    "dynamic message sign",
    "environmental sensor station",
    "gate",
    "highway advisory radio",
    "lane control signal",
    "ramp meter",
    "signal controller",
    "signal section",
    "video switch",
    "other",
)

DEVICE_INFORMATION_TYPE = (
    "device inventory",
    "device status",
    "device schedule",
    "device plan",
    "device maintenance history",
    "device data",
    "device metadata",
    "message appearance",
    "device font table",
    "other",
)

EVENT_REQUEST_FOCUS_VALUES = (
    "specific events",
    "specific response plans",
    "all current events",
    "all event updates",
    "all response plans",
    "other",
)

EVENT_SEVERITY = ("none", "minor", "major", "natural disaster", "other")

EVENT_CATEGORY = ("planned", "current", "forecast")

LINK_DIRECTION = (
    "any other",
    "n",
    "ne",
    "e",
    "se",
    "s",
    "sw",
    "w",
    "nw",
    "not directional",
    "positive direction",
    "negative direction",
    "both directions",
    "other",
)

DEVICE_OPERATIONAL_STATUS = (
    "on",
    "off",
    "out of service",
    "unavailable",
    "unknown",
    "marginal",
    "failed",
    "other",
)

# Not in the brief's list of seven, and it has to be here anyway: `status` is
# a decoded column, so the decoder needs a table for it or it validates
# nothing. 17 strings against integers 1 to 17, read off the XSD.
EVENT_INCIDENT_STATUS = (
    "planned",
    "forecast",
    "contingency plan",
    "response plan activated",
    "reported",
    "confirmed",
    "responding",
    "current",
    "updated",
    "clearing",
    "ended",
    "delete",
    "cancelled",
    "postponed",
    "reopened",
    "new",
    "other",
)

# Type name -> (string values, integer range, expected string count). Only
# Link-direction starts its integer range at 0; every other type here starts
# at 1, and that is a genuine difference between the types.
EXPECTED_TABLES = {
    "Device-type": (DEVICE_TYPE, (1, 12), 12),
    "Device-information-type": (DEVICE_INFORMATION_TYPE, (1, 10), 10),
    "Event-request-focus": (EVENT_REQUEST_FOCUS_VALUES, (1, 6), 6),
    "Event-severity": (EVENT_SEVERITY, (1, 5), 5),
    "Event-category": (EVENT_CATEGORY, (1, 3), 3),
    "Link-direction": (LINK_DIRECTION, (0, 13), 14),
    "Device-operational-status": (DEVICE_OPERATIONAL_STATUS, (1, 8), 8),
    "Event-incident-status": (EVENT_INCIDENT_STATUS, (1, 17), 17),
}


class TestTheEnumerationTables(unittest.TestCase):
    def test_each_table_matches_its_literal_transcription(self):
        for type_name, (values, _integers, _count) in EXPECTED_TABLES.items():
            with self.subTest(enumeration=type_name):
                self.assertEqual(tuple(ENUMERATIONS[type_name].values), values)

    def test_each_integer_range_matches_its_literal_transcription(self):
        for type_name, (_values, integers, _count) in EXPECTED_TABLES.items():
            with self.subTest(enumeration=type_name):
                self.assertEqual(ENUMERATIONS[type_name].integers, integers)

    def test_each_string_count_is_asserted_independently_of_the_integer_range(self):
        for type_name, (_values, _integers, count) in EXPECTED_TABLES.items():
            with self.subTest(enumeration=type_name):
                self.assertEqual(len(ENUMERATIONS[type_name].values), count)

    def test_no_table_carries_a_type_the_matrix_does_not_record(self):
        self.assertEqual(set(ENUMERATIONS), set(EXPECTED_TABLES))


class TestTheDecoderConsultsTheTables(unittest.TestCase):
    # A lookup table nothing reads passes a table-equality test forever.

    def test_the_severity_table_is_actually_consulted(self):
        with self.assertRaises(TMDDResponseError):
            decode("events", EVENT_WITH_UNKNOWN_SEVERITY_VALUE)

    def test_the_incident_status_table_is_actually_consulted(self):
        with self.assertRaises(TMDDResponseError):
            decode("events", EVENT_WITH_UNKNOWN_STATUS_VALUE)

    def test_the_link_direction_table_is_actually_consulted(self):
        with self.assertRaises(TMDDResponseError):
            decode("events", EVENT_WITH_UNKNOWN_DIRECTION_VALUE)

    def test_the_link_direction_table_is_consulted_on_the_device_side_too(self):
        # Link-direction has TWO call sites: the events decoder reads it
        # through event-location, and the DMS inventory decoder reads it
        # through device-inventory-header. The test above only reaches the
        # first. Every conformant DMS fixture carries a valid direction, so
        # without this one the second call site could be reverted to a plain
        # text() read and the whole suite would stay green.
        with self.assertRaises(TMDDResponseError) as caught:
            decode("dms_inventory", DEVICE_WITH_UNKNOWN_DIRECTION_VALUE)
        # Named so the two sites cannot be confused for one another: the
        # error has to point at the device header, not at an event location.
        self.assertIn("device-inventory-header/link-direction", str(caught.exception))

    def test_the_event_category_table_is_actually_consulted(self):
        # event-category is not a decoded column. It is validated because the
        # decoder already walks the element-detail it sits in, and a center
        # sending a value outside a 3-value enum is sending a response we
        # would rather refuse than half-read.
        with self.assertRaises(TMDDResponseError):
            decode("events", EVENT_WITH_UNKNOWN_CATEGORY_VALUE)

    def test_the_operational_status_table_is_actually_consulted(self):
        with self.assertRaises(TMDDResponseError):
            decode("dms_status", DEVICE_STATUS_WITH_UNKNOWN_OPER_STATUS)

    def test_the_device_type_table_is_consulted_for_the_constant_it_supplies(self):
        # dms_inventory.device_type is echoed from the request discriminator,
        # so the table's job here is to catch that constant drifting away
        # from a value the center's own schema accepts.
        self.assertIn(decode("dms_inventory", ONE_DEVICE_AT_KNOWN_COORDS)[0]["device_type"], DEVICE_TYPE)
        self.assertIn(DEVICE_TYPE_DMS, ENUMERATIONS["Device-type"].values)


class TestTheIntegerFormOfAUnion(unittest.TestCase):
    def test_an_integer_inside_the_declared_range_is_accepted_verbatim(self):
        self.assertEqual(decode("dms_status", OPER_STATUS_AS_INTEGER)[0]["oper_status"], "3")

    def test_an_integer_outside_the_declared_range_is_refused(self):
        # 9 is not in Device-operational-status' 1 to 8. Without this, the
        # integer arm of the union would be "any digits at all".
        out_of_range = OPER_STATUS_AS_INTEGER.replace(
            "<device-status>3</device-status>", "<device-status>9</device-status>"
        )
        with self.assertRaises(TMDDResponseError):
            decode("dms_status", out_of_range)


class TestTheRequestBuilderStaysInsideTheseTables(unittest.TestCase):
    # Device-information-type and Event-request-focus never appear in a
    # response, so the only reader they can have is the request builder.

    def test_every_device_information_type_the_builder_sends_is_a_declared_value(self):
        for resource, value in sorted(DEVICE_INFORMATION_TYPES.items()):
            with self.subTest(resource=resource):
                self.assertIn(value, ENUMERATIONS["Device-information-type"].values)

    def test_the_request_focus_the_builder_sends_is_a_declared_value(self):
        self.assertIn(EVENT_REQUEST_FOCUS, ENUMERATIONS["Event-request-focus"].values)

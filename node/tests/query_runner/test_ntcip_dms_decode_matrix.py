"""
Tests that anchor the OID/enum/bitmap constants in `ntcip_dms_decode` to
`docs/superpowers/specs/2026-08-04-ntcip-1203-oid-matrix.md`.

The EXPECTED_* values below are transcribed by hand from the matrix, not
derived from the production module. Comparing the production constant
against a copy of the truth living in this file (rather than against
itself) is the point: a test that reads SIGN_TYPE_NAMES and then asserts
decode_sign_type agrees with SIGN_TYPE_NAMES cannot fail no matter what the
dictionary says, because both sides of the assertion move together.

Decode *function* behavior (missing values, unknown values, full rows) is
covered separately in test_ntcip_dms_decode.py; this file only pins the
constants themselves.
"""

from unittest import TestCase

from redash.query_runner.ntcip_dms_decode import (
    MESSAGE_STATUS_NAMES,
    OIDS,
    RESOURCE_FIELDS,
    SHORT_ERROR_STATUS_BITS,
    SIGN_TYPE_NAMES,
)

# dmsSignType enumeration, matrix lines 28-43.
EXPECTED_SIGN_TYPE_NAMES = {
    1: "other",
    2: "bos",
    3: "cms",
    4: "vmsChar",
    5: "vmsLine",
    6: "vmsFull",
    129: "portableOther",
    130: "portableBOS",
    131: "portableCMS",
    132: "portableVMSChar",
    133: "portableVMSLine",
    134: "portableVMSFull",
}

# dmsMessageStatus enumeration, matrix lines 149-160.
EXPECTED_MESSAGE_STATUS_NAMES = {
    1: "notUsed",
    2: "modifying",
    3: "validating",
    4: "valid",
    5: "error",
    6: "modifyReq",
    7: "validateReq",
    8: "notUsedReq",
}

# shortErrorStatus bitmap, matrix lines 72-92. Bit 0 is reserved and
# intentionally absent from this list.
EXPECTED_SHORT_ERROR_STATUS_BITS = [
    (1, "communications_error"),
    (2, "power_error"),
    (3, "attached_device_error"),
    (4, "lamp_error"),
    (5, "pixel_error"),
    (6, "photocell_error"),
    (7, "message_error"),
    (8, "controller_error"),
    (9, "temperature_warning"),
    (10, "climate_control_error"),
    (11, "critical_temperature_error"),
    (12, "drum_rotor_error"),
    (13, "door_open"),
    (14, "humidity_warning"),
]

# Which fields each resource fetches, per the matrix's three resource
# sections. Task 4 uses this table to build each resource's PDU, so a
# silent drift here would under- or over-fetch a device unnoticed.
EXPECTED_RESOURCE_FIELDS = {
    "dms_identity": [
        "sys_name",
        "sys_descr",
        "dms_sign_type",
        "dms_sign_height",
        "dms_sign_width",
        "vms_sign_height_pixels",
        "vms_sign_width_pixels",
    ],
    "dms_status": [
        "dms_stat_door_open",
        "short_error_status",
        "dms_illum_bright_level_status",
        "dms_illum_num_bright_levels",
    ],
    "dms_message": [
        "dms_msg_table_source",
        "dms_message_multi_string",
        "dms_message_status",
    ],
}


class TestOidMatrix(TestCase):
    """Guards the exact OIDs the matrix specifies, including the two
    corrections a previous draft got wrong: sysName/sysDescr are RFC 1213
    objects with well-known OIDs outside the 1203 tree, and current
    brightness is dmsIllumBrightLevelStatus, never a "BrightnessLevel"
    object (which does not exist)."""

    def test_sys_name_and_sys_descr_are_rfc1213_oids(self):
        self.assertEqual(OIDS["sys_name"], "1.3.6.1.2.1.1.5.0")
        self.assertEqual(OIDS["sys_descr"], "1.3.6.1.2.1.1.1.0")

    def test_sign_type_oid(self):
        self.assertEqual(OIDS["dms_sign_type"], "1.3.6.1.4.1.1206.4.2.3.1.2.0")

    def test_sign_dimensions_are_the_1203_dms_group(self):
        self.assertEqual(OIDS["dms_sign_height"], "1.3.6.1.4.1.1206.4.2.3.1.3.0")
        self.assertEqual(OIDS["dms_sign_width"], "1.3.6.1.4.1.1206.4.2.3.1.4.0")

    def test_pixel_dimensions_come_from_the_vms_group(self):
        self.assertEqual(OIDS["vms_sign_height_pixels"], "1.3.6.1.4.1.1206.4.2.3.2.3.0")
        self.assertEqual(OIDS["vms_sign_width_pixels"], "1.3.6.1.4.1.1206.4.2.3.2.4.0")

    def test_door_open_oid(self):
        self.assertEqual(OIDS["dms_stat_door_open"], "1.3.6.1.4.1.1206.4.2.3.9.6.0")

    def test_short_error_status_oid(self):
        self.assertEqual(OIDS["short_error_status"], "1.3.6.1.4.1.1206.4.2.3.9.7.1.0")

    def test_brightness_is_bright_level_status_not_brightness_level(self):
        self.assertEqual(OIDS["dms_illum_bright_level_status"], "1.3.6.1.4.1.1206.4.2.3.7.5.0")
        self.assertEqual(OIDS["dms_illum_num_bright_levels"], "1.3.6.1.4.1.1206.4.2.3.7.4.0")
        self.assertNotIn("dms_illum_brightness_level", OIDS)
        self.assertNotIn("dms_illum_brightness_values", OIDS)

    def test_current_message_is_the_currentbuffer_table_row(self):
        # Memory type 5 (currentBuffer), message number 1: the row index is
        # "5.1", appended to the column OID, not a bare scalar column.
        self.assertEqual(OIDS["dms_message_multi_string"], "1.3.6.1.4.1.1206.4.2.3.5.8.1.3.5.1")
        self.assertEqual(OIDS["dms_message_status"], "1.3.6.1.4.1.1206.4.2.3.5.8.1.9.5.1")
        self.assertTrue(OIDS["dms_message_multi_string"].endswith(".5.1"))
        self.assertTrue(OIDS["dms_message_status"].endswith(".5.1"))

    def test_message_source_is_a_separate_scalar_pointer(self):
        self.assertEqual(OIDS["dms_msg_table_source"], "1.3.6.1.4.1.1206.4.2.3.6.5.0")


class TestResourceFields(TestCase):
    def test_matches_literal_field_lists_per_resource(self):
        self.assertEqual(RESOURCE_FIELDS, EXPECTED_RESOURCE_FIELDS)

    def test_every_field_has_an_oid(self):
        for fields in RESOURCE_FIELDS.values():
            for field in fields:
                with self.subTest(field=field):
                    self.assertIn(field, OIDS)


class TestSignTypeNamesMatchTheMatrix(TestCase):
    def test_literal_values_transcribed_from_the_matrix(self):
        self.assertEqual(SIGN_TYPE_NAMES, EXPECTED_SIGN_TYPE_NAMES)


class TestMessageStatusNamesMatchTheMatrix(TestCase):
    def test_literal_values_transcribed_from_the_matrix(self):
        self.assertEqual(MESSAGE_STATUS_NAMES, EXPECTED_MESSAGE_STATUS_NAMES)


class TestShortErrorStatusBitsMatchTheMatrix(TestCase):
    def test_literal_values_transcribed_from_the_matrix(self):
        self.assertEqual(SHORT_ERROR_STATUS_BITS, EXPECTED_SHORT_ERROR_STATUS_BITS)

    def test_all_fourteen_bits_one_through_fourteen_are_covered(self):
        self.assertEqual({bit for bit, _ in SHORT_ERROR_STATUS_BITS}, set(range(1, 15)))

    def test_bit_zero_is_reserved_and_absent(self):
        self.assertNotIn(0, {bit for bit, _ in SHORT_ERROR_STATUS_BITS})

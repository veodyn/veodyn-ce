"""
Tests for the decode *functions* in `ntcip_dms_decode`: missing-value
handling, unknown-value handling, MULTI parsing, and full-row assembly.

The OID/enum/bitmap constants these functions read from are pinned
separately, against literals transcribed from the OID matrix, in
test_ntcip_dms_decode_matrix.py.
"""

from unittest import TestCase

from pysnmp.proto.rfc1902 import Integer32, OctetString
from pysnmp.proto.rfc1905 import NoSuchInstance, NoSuchObject

from redash.query_runner.ntcip_dms_decode import (
    decode_dms_identity,
    decode_dms_message,
    decode_dms_status,
    decode_door_open,
    decode_message_status,
    decode_multi,
    decode_short_error_status,
    decode_sign_type,
)


class TestDecodeSignType(TestCase):
    def test_unrecognized_value_does_not_raise(self):
        self.assertEqual(decode_sign_type(200), "unknown(200)")

    def test_missing_via_no_such_object(self):
        self.assertIsNone(decode_sign_type(NoSuchObject("")))

    def test_missing_via_no_such_instance(self):
        self.assertIsNone(decode_sign_type(NoSuchInstance("")))

    def test_missing_via_none(self):
        self.assertIsNone(decode_sign_type(None))


class TestDecodeMessageStatus(TestCase):
    def test_unrecognized_value_does_not_raise(self):
        self.assertEqual(decode_message_status(99), "unknown(99)")

    def test_missing(self):
        self.assertIsNone(decode_message_status(NoSuchObject("")))


class TestDecodeShortErrorStatus(TestCase):
    def test_bit_zero_is_reserved_and_produces_no_name(self):
        self.assertEqual(decode_short_error_status(1), [])

    def test_no_bits_set(self):
        self.assertEqual(decode_short_error_status(0), [])

    def test_combined_bits(self):
        raw = (1 << 1) | (1 << 7) | (1 << 13)  # communications, message, door open
        self.assertEqual(
            decode_short_error_status(raw),
            ["communications_error", "message_error", "door_open"],
        )

    def test_missing(self):
        self.assertIsNone(decode_short_error_status(NoSuchInstance("")))


class TestDecodeDoorOpen(TestCase):
    """dmsStatDoorOpen: "if a bit is set (= 1) then the door is open"
    (matrix line 68). The bit-to-physical-door mapping is manufacturer
    specific, so only the set-means-open semantic is testable here."""

    def test_no_bits_set(self):
        self.assertEqual(decode_door_open(0), [])

    def test_single_bit(self):
        self.assertEqual(decode_door_open(1), [0])
        self.assertEqual(decode_door_open(1 << 3), [3])

    def test_multiple_bits(self):
        self.assertEqual(decode_door_open(0b00000101), [0, 2])

    def test_all_eight_bits(self):
        self.assertEqual(decode_door_open(0xFF), [0, 1, 2, 3, 4, 5, 6, 7])

    def test_missing(self):
        self.assertIsNone(decode_door_open(NoSuchObject("")))


class TestDecodeMulti(TestCase):
    def test_plain_text_is_unchanged(self):
        self.assertEqual(decode_multi("HELLO WORLD"), "HELLO WORLD")

    def test_empty_string(self):
        self.assertEqual(decode_multi(""), "")

    def test_new_line_tag(self):
        self.assertEqual(decode_multi("LINE1[nl]LINE2"), "LINE1\nLINE2")

    def test_new_page_tag(self):
        self.assertEqual(decode_multi("PAGE1[np]PAGE2"), "PAGE1\fPAGE2")

    def test_page_time_tag_is_dropped(self):
        self.assertEqual(decode_multi("A[pt10o]B"), "AB")

    def test_line_justification_tag_is_dropped(self):
        self.assertEqual(decode_multi("A[jl3]B"), "AB")

    def test_colour_tag_is_dropped(self):
        self.assertEqual(decode_multi("A[cf255,255,255]B"), "AB")

    def test_font_tag_is_dropped(self):
        self.assertEqual(decode_multi("A[fo3]B"), "AB")

    def test_combination_of_tags(self):
        raw = "SPEED[nl][cf255,0,0]LIMIT[/cf][np][jl2]65[nl]MPH"
        self.assertEqual(decode_multi(raw), "SPEED\nLIMIT\f65\nMPH")

    def test_none_input_returns_none(self):
        self.assertIsNone(decode_multi(None))

    def test_unclosed_tag_is_malformed(self):
        self.assertIsNone(decode_multi("HELLO[nl"))

    def test_nested_tag_is_malformed(self):
        self.assertIsNone(decode_multi("A[nl[np]]B"))

    def test_stray_closing_bracket_is_malformed(self):
        self.assertIsNone(decode_multi("HELLO]WORLD"))

    def test_malformed_input_never_raises(self):
        # Same case as test_unclosed_tag_is_malformed, phrased as the
        # exception-safety guarantee itself rather than the exact shape.
        try:
            result = decode_multi("[nl][broken")
        except Exception as e:  # noqa: BLE001 - the point is nothing raises
            self.fail(f"decode_multi raised {e!r} on malformed input")
        self.assertIsNone(result)


class TestDecodeDmsIdentity(TestCase):
    def test_full_row_with_real_pysnmp_types(self):
        values = {
            "sys_name": OctetString("DMS-I5-NB-12"),
            "sys_descr": OctetString("Acme Sign Co. Model 9000 v2.1"),
            "dms_sign_type": Integer32(6),
            "dms_sign_height": Integer32(3048),
            "dms_sign_width": Integer32(6096),
            "vms_sign_height_pixels": Integer32(21),
            "vms_sign_width_pixels": Integer32(120),
        }
        row = decode_dms_identity(values)
        self.assertEqual(
            row,
            {
                "sys_name": "DMS-I5-NB-12",
                "sys_descr": "Acme Sign Co. Model 9000 v2.1",
                "sign_type": "vmsFull",
                "height_mm": 3048,
                "width_mm": 6096,
                "height_px": 21,
                "width_px": 120,
            },
        )

    def test_millimetres_and_pixels_are_never_crossed(self):
        values = {
            "dms_sign_height": 3048,
            "dms_sign_width": 6096,
            "vms_sign_height_pixels": 21,
            "vms_sign_width_pixels": 120,
        }
        row = decode_dms_identity(values)
        self.assertEqual((row["height_mm"], row["width_mm"]), (3048, 6096))
        self.assertEqual((row["height_px"], row["width_px"]), (21, 120))

    def test_missing_values_become_none(self):
        values = {k: NoSuchObject("") for k in ("sys_name", "sys_descr", "dms_sign_type")}
        row = decode_dms_identity(values)
        self.assertIsNone(row["sys_name"])
        self.assertIsNone(row["sys_descr"])
        self.assertIsNone(row["sign_type"])

    def test_empty_values_dict_produces_all_none(self):
        row = decode_dms_identity({})
        self.assertTrue(all(v is None for v in row.values()))

    def test_exact_column_set_with_no_sign_type_raw(self):
        row = decode_dms_identity({})
        self.assertEqual(
            set(row.keys()),
            {"sys_name", "sys_descr", "sign_type", "height_mm", "width_mm", "height_px", "width_px"},
        )
        self.assertNotIn("sign_type_raw", row)


class TestDecodeDmsStatus(TestCase):
    def test_full_row(self):
        values = {
            "dms_stat_door_open": 0b00000101,
            "short_error_status": (1 << 1) | (1 << 13),
            "dms_illum_bright_level_status": 12,
            "dms_illum_num_bright_levels": 16,
        }
        row = decode_dms_status(values)
        self.assertEqual(
            row,
            {
                "door_open": [0, 2],
                "door_open_raw": 0b00000101,
                "error_status": ["communications_error", "door_open"],
                "error_status_raw": (1 << 1) | (1 << 13),
                "brightness_level": 12,
                "brightness_levels_total": 16,
            },
        )

    def test_missing_values_become_none(self):
        values = {k: NoSuchInstance("") for k in ("dms_stat_door_open", "short_error_status")}
        row = decode_dms_status(values)
        self.assertIsNone(row["door_open"])
        self.assertIsNone(row["door_open_raw"])
        self.assertIsNone(row["error_status"])
        self.assertIsNone(row["error_status_raw"])

    def test_exact_column_set_with_declared_raw_siblings(self):
        row = decode_dms_status({})
        self.assertEqual(
            set(row.keys()),
            {
                "door_open",
                "door_open_raw",
                "error_status",
                "error_status_raw",
                "brightness_level",
                "brightness_levels_total",
            },
        )


class TestDecodeDmsMessage(TestCase):
    def test_full_row_healthy_message(self):
        values = {
            "dms_msg_table_source": 42,
            "dms_message_multi_string": "SPEED[nl]LIMIT 65",
            "dms_message_status": 4,
        }
        row = decode_dms_message(values)
        self.assertEqual(row["message_multi"], "SPEED[nl]LIMIT 65")
        self.assertEqual(row["message_text"], "SPEED\nLIMIT 65")
        self.assertEqual(row["message_status"], "valid")
        self.assertEqual(row["message_status_raw"], 4)
        self.assertEqual(row["message_source"], "42")

    def test_malformed_multi_keeps_raw_and_nulls_text(self):
        values = {
            "dms_msg_table_source": 1,
            "dms_message_multi_string": "SPEED[nl",
            "dms_message_status": 4,
        }
        row = decode_dms_message(values)
        self.assertEqual(row["message_multi"], "SPEED[nl")
        self.assertIsNone(row["message_text"])

    def test_missing_multi_string_nulls_both_columns(self):
        values = {
            "dms_msg_table_source": 1,
            "dms_message_multi_string": NoSuchObject(""),
            "dms_message_status": 4,
        }
        row = decode_dms_message(values)
        self.assertIsNone(row["message_multi"])
        self.assertIsNone(row["message_text"])

    def test_missing_status_becomes_none(self):
        values = {
            "dms_msg_table_source": 1,
            "dms_message_multi_string": "HELLO",
            "dms_message_status": NoSuchInstance(""),
        }
        row = decode_dms_message(values)
        self.assertIsNone(row["message_status"])
        self.assertIsNone(row["message_status_raw"])

    def test_exact_column_set(self):
        row = decode_dms_message({})
        self.assertEqual(
            set(row.keys()),
            {"message_multi", "message_text", "message_status", "message_status_raw", "message_source"},
        )

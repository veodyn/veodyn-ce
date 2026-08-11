"""
Character encoding on the way in, and the SOAP fault scan that depends on it.

Split out of test_tmdd_transport for the repo's 300-line limit, along a seam
worth having anyway: everything here is about the BYTES a center sent and how
they become characters, and everything left there is about the request, the
size cap and the HTTP status.

Two defects lived in this seam and each was reachable only through a body
that is not ASCII-compatible UTF-8:

1. The fault scan short-circuited on `b"Fault" not in raw`, an ASCII test. A
   UTF-16 fault spells the same word `F\\x00a\\x00u\\x00l\\x00t\\x00`, so it
   failed the scan, fell through to the status check, and was reported as a
   bare "HTTP 500" with the faultstring, the only part saying what the center
   objected to, thrown away.
2. When the HTTP header omitted a charset the transport defaulted to UTF-8
   and ignored the document's own XML declaration. The DECODER is unaffected,
   because it is handed the raw bytes on purpose, so the rows come out right
   and nothing in the returned table can show the defect. What is corrupted
   is the text published to Redis, which is the only copy of the center's own
   response a downstream consumer ever sees. That is why the assertions below
   go through `published_text` rather than through the rows: the ISO-8859-1
   case was already in the suite and asserted only the decoded rows, so it
   passed throughout.
"""

from tests.query_runner.tmdd_fixtures import ONE_DEVICE_AT_KNOWN_COORDS
from tests.query_runner.tmdd_transport_harness import (
    INVENTORY,
    SOAP_FAULT_TEXT,
    FakeResponse,
    TransportCase,
)

NO_CHARSET = {"Content-Type": "text/xml"}

# A device name that is not ASCII, so a decode with the wrong codec is
# visible rather than a no-op.
LATIN_1_BODY = ('<?xml version="1.0" encoding="ISO-8859-1"?>' + ONE_DEVICE_AT_KNOWN_COORDS).replace(
    "I-5 NB MP 165", "Cañón Pass"
)


def utf_16(text, byte_order="little"):
    """`text` as UTF-16 with a byte order mark, the way a center sends it."""
    mark = "﻿"
    return (mark + text).encode("utf-16-le" if byte_order == "little" else "utf-16-be")


class TestTheFaultScanIsNotAnAsciiScan(TransportCase):
    def test_a_utf_16_fault_is_read_as_a_fault_and_not_as_a_bare_http_500(self):
        for byte_order in ("little", "big"):
            with self.subTest(byte_order=byte_order):
                response = FakeResponse(
                    status_code=500,
                    body=utf_16(SOAP_FAULT_TEXT, byte_order),
                    headers={"Content-Type": "text/xml; charset=utf-16"},
                )
                data, error = self.run_with(response)
                self.assertIsNone(data)
                self.assertIn("center returned a SOAP fault", error)
                # The faultstring is the point. Reporting "HTTP 500" alone
                # throws away the only sentence saying what went wrong.
                self.assertIn("Unknown organization", error)

    def test_a_utf_16_fault_arriving_with_http_200_is_still_a_fault(self):
        # The status is not the discriminator here either, and on a 200 there
        # is no HTTP failure to fall through to: before the fix this reached
        # the decoder and was reported as the wrong root element.
        _data, error = self.run_with(FakeResponse(status_code=200, body=utf_16(SOAP_FAULT_TEXT)))
        self.assertIn("Unknown organization", error)

    def test_a_utf_16_body_that_is_not_a_fault_is_not_reported_as_one(self):
        # The control. A scan loose enough to call every UTF-16 body a fault
        # would pass both tests above.
        _data, error = self.run_with(
            FakeResponse(status_code=500, body=utf_16("<html>gateway error</html>")),
        )
        self.assertNotIn("SOAP fault", error)
        self.assertIn("500", error)


class TestTheCharsetTheTextIsDecodedWith(TransportCase):
    def test_the_declaration_is_honoured_when_the_header_omits_a_charset(self):
        # The defect, and the assertion the pre-existing ISO-8859-1 test did
        # not make. The rows were always right; the published text was not.
        published = self.published_text(
            FakeResponse(body=LATIN_1_BODY.encode("iso-8859-1"), headers=NO_CHARSET)
        )
        self.assertIn("Cañón Pass", published)

    def test_the_rows_were_right_all_along_which_is_why_this_hid(self):
        # Kept beside it deliberately. The decoder is handed the BYTES, so it
        # honoured the declaration on its own and no assertion on the table
        # could ever have caught the text being wrong.
        data, error = self.run_with(FakeResponse(body=LATIN_1_BODY.encode("iso-8859-1"), headers=NO_CHARSET))
        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["device_name"], "Cañón Pass")

    def test_an_explicit_header_charset_still_wins_over_the_declaration(self):
        # RFC 3023: for text/xml the HTTP charset governs. A center that
        # states one has said what it means, and the new fallback must not
        # promote itself over it.
        #
        # The two disagree here on purpose: the bytes are UTF-8 and the
        # header says so, while the declaration inside them lies and claims
        # ISO-8859-1. That is the only shape that discriminates, and it does
        # split the two consumers, legitimately: the PARSER is required to
        # believe the declaration, so the rows come back with the mojibake
        # the center asked for, while the published text follows the header.
        body = LATIN_1_BODY.encode()
        published = self.published_text(
            FakeResponse(body=body, headers={"Content-Type": "text/xml; charset=utf-8"})
        )
        self.assertIn("Cañón Pass", published)

    def test_a_utf_16_body_with_no_header_charset_is_read_from_its_byte_order_mark(self):
        # A UTF-16 declaration is itself UTF-16, so it cannot be found by
        # reading the bytes as ASCII. The BOM is what identifies it.
        body = utf_16(LATIN_1_BODY.replace('encoding="ISO-8859-1"', 'encoding="UTF-16"'))
        published = self.published_text(FakeResponse(body=body, headers=NO_CHARSET))
        self.assertIn("Cañón Pass", published)

    def test_a_plain_utf_8_body_with_neither_is_still_read_as_utf_8(self):
        # The documented default, and the control for all of the above: XML's
        # own default is UTF-8 when nothing says otherwise.
        published = self.published_text(FakeResponse(body=INVENTORY, headers=NO_CHARSET))
        self.assertIn("DMS-001", published)

    def test_an_encoding_name_no_codec_matches_falls_back_instead_of_failing(self):
        # The charset comes from the center, so its content is not this
        # connector's to trust. An unknown codec name raises LookupError out
        # of bytes.decode, which is not caught anywhere in post_soap, so a
        # perfectly readable response was reported as a request that failed.
        # A defect the header path already had, and one the declaration path
        # would otherwise have added a second door to.
        published = self.published_text(
            FakeResponse(body=INVENTORY, headers={"Content-Type": "text/xml; charset=x-not-a-codec"})
        )
        self.assertIn("DMS-001", published)

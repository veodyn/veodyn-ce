"""
The TMDD runner's HTTP transport: what it sends, and what it does with what
comes back.

The fake streamed response every case here drives `requests` with lives in
tmdd_transport_harness, and the reasoning for faking rather than recording is
written up there. Character encoding and SOAP fault detection are in
test_tmdd_transport_encoding; the record-count cap, the `since` filter and the
fixed column set are in test_tmdd_records. Everything here stops at the
response body.
"""

from unittest import mock

from redash.query_runner import tmdd_transport
from redash.query_runner.tmdd import TMDD
from tests.query_runner.tmdd_transport_harness import (
    BASE,
    INVENTORY,
    SOAP_FAULT_BODY,
    FakeResponse,
    TransportCase,
)


class TestTheRequestItSends(TransportCase):
    def test_the_soapaction_header_is_sent_and_defaults_to_empty(self):
        self.assertEqual(self.kwargs()["headers"]["SOAPAction"], '""')

    def test_the_soapaction_header_honours_the_configured_literal(self):
        # The WSDL's raw value is two apostrophes, which reads either as
        # "empty" or as a literal action URI of ''. A center wanting the
        # literal is configured, not patched.
        self.assertEqual(self.kwargs(soap_action="''")["headers"]["SOAPAction"], "\"''\"")

    def test_the_content_type_is_the_soap_1_1_one(self):
        self.assertEqual(self.kwargs()["headers"]["Content-Type"], "text/xml; charset=utf-8")

    def test_the_configured_endpoint_gets_the_built_envelope(self):
        self.run_with(FakeResponse(body=INVENTORY))
        self.assertEqual(self.post.call_args.args[0], BASE["endpoint_url"])
        body = self.post.call_args.kwargs["data"]
        self.assertIsInstance(body, bytes)
        self.assertIn(b"deviceInformationRequestMsg", body)
        self.assertIn(b"<organization-id>ORG-1</organization-id>", body)

    def test_the_request_timeout_is_the_configured_one(self):
        self.assertEqual(self.kwargs(request_timeout=7)["timeout"], 7)

    def test_the_body_is_streamed_rather_than_buffered(self):
        # Without stream=True requests reads the whole body before any of our
        # code runs, and the size cap below is then decoration.
        self.assertIs(self.kwargs()["stream"], True)

    def test_verify_tls_false_is_honoured_and_a_ca_bundle_path_wins(self):
        self.assertIs(self.kwargs(verify_tls=False)["verify"], False)
        self.assertIs(self.kwargs()["verify"], True)
        self.assertEqual(self.kwargs(ca_bundle="/etc/ssl/agency.pem")["verify"], "/etc/ssl/agency.pem")
        # An explicit bundle beats the checkbox: someone who pointed at their
        # agency's PEM meant verification on, whichever way the box was left.
        self.assertEqual(
            self.kwargs(verify_tls=False, ca_bundle="/etc/ssl/agency.pem")["verify"], "/etc/ssl/agency.pem"
        )


class TestWhatComesBack(TransportCase):
    def test_a_conformant_response_becomes_rows(self):
        data, error = self.run_with(FakeResponse(body=INVENTORY))
        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["device_id"], "DMS-001")

    def test_the_response_is_closed_even_on_the_happy_path(self):
        self.run_with(FakeResponse(body=INVENTORY))
        self.assertTrue(self.response.closed)

    def test_a_soap_fault_inside_http_500_is_reported_as_a_fault(self):
        data, error = self.run_with(FakeResponse(status_code=500, body=SOAP_FAULT_BODY))
        self.assertIsNone(data)
        self.assertIn("center returned a SOAP fault", error)
        self.assertIn("Unknown organization", error)

    def test_a_soap_fault_arriving_with_http_200_is_still_a_fault(self):
        # The status is not the discriminator. A center that answers 200 with
        # a fault body would otherwise reach the decoder, which would report
        # the wrong root element rather than the center's own complaint.
        _data, error = self.run_with(FakeResponse(status_code=200, body=SOAP_FAULT_BODY))
        self.assertIn("Unknown organization", error)

    def test_a_non_soap_http_500_is_reported_as_an_http_failure(self):
        # The body is parsed for a Fault BEFORE the status is treated as an
        # error, so a proxy's HTML error page must not be reported as a fault
        # with an empty faultstring.
        data, error = self.run_with(FakeResponse(status_code=500, body=b"<html>gateway error</html>"))
        self.assertIsNone(data)
        self.assertNotIn("SOAP fault", error)
        self.assertIn("500", error)
        self.assertIn("gateway error", error)

    def test_a_404_is_reported_with_its_status_too(self):
        _data, error = self.run_with(FakeResponse(status_code=404, body=b"no such endpoint"))
        self.assertIn("404", error)

    def test_a_transport_failure_is_the_familys_request_failed_string(self):
        runner = TMDD(dict(BASE))
        with mock.patch.object(tmdd_transport.requests, "post", side_effect=OSError("name resolution failed")):
            data, error = runner.run_query('{"resource": "dms_inventory"}', None)
        self.assertIsNone(data)
        self.assertEqual(error, "TMDD Center-to-Center request failed: name resolution failed")


class TestTheSizeCap(TransportCase):
    def streamed(self, count, size, **configuration):
        chunk = b"x" * size
        response = FakeResponse(chunks=(chunk for _ in range(count)))
        _data, error = self.run_with(response, **configuration)
        return response.chunks_read, error

    def test_the_body_is_abandoned_mid_stream_once_the_cap_is_passed(self):
        # Not "an oversized response returns an error": that passes while the
        # whole body sits in memory. Assert we stopped reading.
        chunks_read, error = self.streamed(count=1000, size=1024 * 1024)
        self.assertLess(chunks_read, 20)
        self.assertTrue(self.response.closed)
        self.assertIn("10 MB", error)

    def test_a_body_under_the_cap_is_read_to_the_end(self):
        # The control for the test above: without it, a transport that read
        # nothing at all would look like a working cap.
        chunks_read, _error = self.streamed(count=4, size=1024 * 1024)
        self.assertEqual(chunks_read, 4)

    def test_the_configured_cap_is_the_one_enforced(self):
        chunks_read, error = self.streamed(count=1000, size=1024 * 1024, max_response_mb=2)
        self.assertLess(chunks_read, 5)
        self.assertIn("2 MB", error)

    def test_the_decoder_is_reached_through_its_module_so_a_patch_lands(self):
        # The test below is the one the brief asks for, and on its own it does
        # not prove this: with the cap working, decode is not called either
        # way, so assert_not_called passes whether or not the patch reached
        # the real call site. This one calls the decoder for real. A
        # `from tmdd_decode import decode` in tmdd.py binds an alias the patch
        # cannot see, and every stub of the decoder would then quietly
        # exercise the real one.
        with mock.patch("redash.query_runner.tmdd_decode.decode", return_value=[]) as decode:
            data, error = self.run_with(FakeResponse(body=INVENTORY))
        decode.assert_called_once()
        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])

    def test_the_size_cap_runs_before_the_parser_sees_the_body(self):
        with mock.patch("redash.query_runner.tmdd_decode.decode") as decode:
            _data, error = self.run_with(FakeResponse(body=b"x" * (11 * 1024 * 1024)))
        decode.assert_not_called()
        self.assertIn("10 MB", error)


class TestConnectionTest(TransportCase):
    def test_test_connection_issues_the_noop_query(self):
        runner = TMDD(dict(BASE))
        response = FakeResponse(body=INVENTORY)
        with mock.patch.object(tmdd_transport.requests, "post", return_value=response) as post:
            runner.test_connection()
        self.assertIn(b"device-information-type>device inventory<", post.call_args.kwargs["data"])

    def test_test_connection_surfaces_a_fault_as_an_exception(self):
        runner = TMDD(dict(BASE))
        response = FakeResponse(status_code=500, body=SOAP_FAULT_BODY)
        with mock.patch.object(tmdd_transport.requests, "post", return_value=response):
            with self.assertRaises(Exception) as caught:
                runner.test_connection()
        self.assertIn("Unknown organization", str(caught.exception))

    def test_test_connection_surfaces_a_configuration_error_too(self):
        with self.assertRaises(Exception) as caught:
            TMDD({"organization_id": "ORG-1"}).test_connection()
        self.assertIn("'endpoint_url' is not configured", str(caught.exception))

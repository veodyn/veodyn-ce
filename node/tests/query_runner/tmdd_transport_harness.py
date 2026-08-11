"""
The fake streamed response the TMDD transport tests drive `requests` with.

Kept out of the test modules, and without a `test_` prefix so pytest does not
collect it, so that test_tmdd_transport and test_tmdd_transport_encoding
exercise the same fake rather than two that can drift.

`requests.post` is replaced with this rather than with a recorded session,
because two of the properties under test are about how the body is CONSUMED
(a stream abandoned part-way) and how the response is CLOSED, and a recorded
session hands over a finished body that can no longer show either.
FakeResponse therefore counts the chunks that were actually pulled and
refuses to yield another one after `close()`.
"""

import json
import unittest
from unittest import mock

from redash.query_runner import tmdd_transport
from redash.query_runner.tmdd import TMDD
from tests.query_runner.tmdd_fixtures import ONE_DEVICE_AT_KNOWN_COORDS

BASE = {"endpoint_url": "https://c2c.example.org/tmdd", "organization_id": "ORG-1"}

INVENTORY = ONE_DEVICE_AT_KNOWN_COORDS.encode()

# Kept as text as well as bytes: the encoding tests need to re-encode the
# same fault in UTF-16, and a second hand-written copy of it would be a
# second thing to keep in step.
SOAP_FAULT_TEXT = (
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault>'
    "<faultcode>soap:Client</faultcode><faultstring>Unknown organization ORG-1</faultstring>"
    "</soap:Fault></soap:Body></soap:Envelope>"
)
SOAP_FAULT_BODY = SOAP_FAULT_TEXT.encode()


class FakeResponse:
    """A streamed requests.Response, minus everything but the stream."""

    def __init__(self, status_code=200, body=b"", headers=None, chunks=None):
        self.status_code = status_code
        self.headers = {"Content-Type": "text/xml; charset=utf-8"} if headers is None else headers
        self.body = body
        self.chunks = chunks
        self.closed = False
        self.chunks_read = 0

    def iter_content(self, chunk_size):
        source = self.chunks
        if source is None:
            source = (self.body[at : at + chunk_size] for at in range(0, len(self.body), chunk_size))
        for chunk in source:
            # Deliberately not a silent stop. A transport that keeps reading
            # after it has closed the response has not protected anything,
            # and this is the only place that can say so.
            assert not self.closed, "the body was read after the response was closed"
            self.chunks_read += 1
            yield chunk

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()


class TransportCase(unittest.TestCase):
    def run_with(self, response, query='{"resource": "dms_inventory"}', **configuration):
        runner = TMDD(dict(BASE, **configuration))
        with mock.patch.object(tmdd_transport.requests, "post", return_value=response) as post:
            data, error = runner.run_query(query, None)
        self.post = post
        self.response = response
        return data, error

    def kwargs(self, **configuration):
        self.run_with(FakeResponse(body=INVENTORY), **configuration)
        return self.post.call_args.kwargs

    def published_text(self, response, **configuration):
        """The response text that reaches the optional Redis publish.

        The only place the decoded TEXT is observable. The decoder is handed
        the raw bytes, so a charset the transport guessed wrong is invisible
        everywhere except here, which is why the encoding tests go through
        this rather than through the rows.
        """
        query = json.dumps({"resource": "dms_inventory", "pubsub_channel": "feed:dms"})
        runner = TMDD(dict(BASE, **configuration))
        with mock.patch.object(tmdd_transport.requests, "post", return_value=response):
            with mock.patch.object(TMDD, "_publish_to_redis") as publish:
                data, error = runner.run_query(query, None)
        self.assertIsNone(error, f"the run failed before anything was published: {error}")
        self.assertIsNotNone(data)
        return publish.call_args.args[3]

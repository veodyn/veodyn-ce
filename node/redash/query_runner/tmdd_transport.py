"""
The TMDD runner's HTTP transport, and the limits applied to what it brings
back.

Two jobs, kept together because the second is a property of the response the
first read: `post_soap` puts the built envelope on the wire and returns the
body, `apply_record_limits` decides how much of the decoded result the runner
is allowed to return. Neither builds a request (`tmdd_request`) nor reads one
(`tmdd_decode`).

**`requests`, not `requests_or_advocate`, deliberately.** The advocate wrapper
refuses private addresses, and `ENFORCE_PRIVATE_ADDRESS_BLOCK` defaults to
`true` (`redash/settings/__init__.py:76`), so routing this connector through it
would refuse the ordinary case: traffic management centers sit on agency
networks and private VLANs far more often than on public ones. The protection
advocate provides is against a URL a *user* supplied; this endpoint is
data source configuration, editable only by an admin, and the rest of this
connector family already calls `requests` directly (`airnow.py:115`). This is a
recorded deviation, not an oversight to be tidied away later.

**The body is streamed and capped as it arrives.** `requests.post()` without
`stream=True` reads the whole body before returning, so a cap checked against
`len(response.content)` runs after the memory it was protecting has already
been allocated. `_read_capped` pulls the body a chunk at a time and abandons
the response the moment the running total passes the cap, which is a thing a
test can observe: `test_tmdd_transport.FakeResponse` counts the chunks that
were actually taken.

**A SOAP fault is read before the HTTP status.** SOAP 1.1 requires a fault to
travel as HTTP 500, so treating the status first would report every fault the
center raised as a bare "HTTP 500" and throw away the faultstring, which is
the only part of the answer saying what it objected to. A body that is not a
fault (a proxy's HTML error page) falls through to the status.

**Neither the fault scan nor the charset may assume ASCII-compatible bytes.**
Both had the same shape of defect and both were reachable only through a
UTF-16 body. The cheap pre-scan that decides whether to parse for a fault was
`b"Fault" not in raw`, which is an ASCII test: the same word in UTF-16 is
`F\\x00a\\x00u\\x00l\\x00t\\x00`, so a UTF-16 fault failed it and came back as
a bare HTTP 500. And the charset fell back to UTF-8 whenever the HTTP header
omitted one, ignoring the document's own declaration. That second one is
invisible in the rows, because the decoder is handed the BYTES on purpose and
honours the declaration itself; what it corrupts is the text published to
Redis, which is the only copy of the center's own response anything
downstream sees.
"""

import logging
import re
from xml.etree.ElementTree import ParseError

import requests

from redash.query_runner.tmdd_config import (
    DEFAULT_MAX_RECORDS,
    DEFAULT_MAX_RESPONSE_MB,
    SINCE_COLUMNS,
    parse_timestamp,
    positive_number,
)
from redash.query_runner.tmdd_request import ENVELOPE_NS, soap_action_header

__all__ = ["SOAP_CONTENT_TYPE", "TMDDTransportError", "apply_record_limits", "post_soap"]

logger = logging.getLogger(__name__)

# SOAP 1.1. The 1.2 media type (application/soap+xml) belongs to a different
# envelope namespace, and the v3.03d WSDL binds the 1.1 one.
SOAP_CONTENT_TYPE = "text/xml; charset=utf-8"

CHUNK_BYTES = 64 * 1024
BYTES_PER_MB = 1024 * 1024
SNIPPET_CHARS = 200

# "Fault" in the encodings a center realistically answers in. Three
# substring scans rather than one, and no copy of the body: normalising the
# bytes first would allocate a second copy of a response that is allowed to
# be ten megabytes.
FAULT_MARKERS = (b"Fault", "Fault".encode("utf-16-le"), "Fault".encode("utf-16-be"))

# A byte order mark identifies the encoding on its own, and for UTF-16 it is
# the ONLY thing that can: the declaration inside such a document is itself
# UTF-16, so reading the head as ASCII finds nothing there. UTF-32 is not
# listed; no center in the bundle's ecosystem sends it, and its little
# endian mark starts with the UTF-16 one, so guessing would make things
# worse rather than better.
BYTE_ORDER_MARKS = (
    (b"\xef\xbb\xbf", "utf-8-sig"),
    (b"\xff\xfe", "utf-16-le"),
    (b"\xfe\xff", "utf-16-be"),
)

# An XML declaration is only a declaration at the very start of the document,
# which is why this is matched and not searched.
DECLARED_ENCODING = re.compile(rb"""<\?xml[^>]*?encoding\s*=\s*["']([A-Za-z0-9_.:+-]+)["']""")
DECLARATION_BYTES = 200


class TMDDTransportError(Exception):
    """A response this connector will not use, with the reason in it.

    Raised from `_fetch`, so the base wraps it as
    "<name> request failed: <e>". That contract is right for everything here:
    each of these really is a request that was made and did not work.
    """


def _verify(config):
    # An explicit CA bundle wins over the checkbox. Someone who took the
    # trouble to point at their agency's PEM meant verification on, whichever
    # way the box was left, and a private CA is the common case for a center.
    bundle = (config.get("ca_bundle") or "").strip()
    if bundle:
        return bundle
    return bool(config.get("verify_tls", True))


def _number_label(number):
    return str(int(number)) if float(number) == int(number) else str(number)


def _header_charset(response):
    for part in response.headers.get("Content-Type", "").split(";")[1:]:
        key, _, value = part.partition("=")
        if key.strip().lower() == "charset":
            return value.strip().strip('"') or None
    return None


def _declared_charset(raw):
    """The encoding the document itself names, by mark or by declaration."""
    for mark, encoding in BYTE_ORDER_MARKS:
        if raw.startswith(mark):
            return encoding
    found = DECLARED_ENCODING.match(raw[:DECLARATION_BYTES])
    return found.group(1).decode("ascii") if found else None


def _decode_body(raw, response):
    """`raw` as text, using the first charset that names a real codec.

    The order is RFC 3023's for text/xml: the HTTP header governs when it
    states a charset, then the document's own mark or declaration, then
    UTF-8, which is XML's default. requests would default a text/* body with
    no charset to ISO-8859-1; XML never does.

    A codec NAME is not this connector's to trust. Both of the first two
    candidates come from the center, and an unknown one raises LookupError
    out of `bytes.decode`, which nothing above catches, so a perfectly
    readable response would be reported as a request that failed.
    """
    for candidate in (_header_charset(response), _declared_charset(raw), "utf-8"):
        if not candidate:
            continue
        try:
            return raw.decode(candidate, errors="replace")
        except LookupError:
            # Logged rather than swallowed: a center naming a codec Python
            # does not have is a real interoperability problem worth seeing
            # in the log, and it is not a reason to fail a query whose body
            # the next candidate can read.
            logger.warning("TMDD: the center named charset %r, which no codec matches", candidate)
    return raw.decode("utf-8", errors="replace")


def _snippet(raw):
    return " ".join(raw[: SNIPPET_CHARS * 4].decode("utf-8", errors="replace").split())[:SNIPPET_CHARS]


def _read_capped(response, max_bytes, label):
    chunks, total = [], 0
    for chunk in response.iter_content(CHUNK_BYTES):
        total += len(chunk)
        if total > max_bytes:
            # Abandoned here, mid-stream, rather than measured afterwards.
            # Closing the response is what actually stops the body arriving;
            # the error only reports it.
            response.close()
            raise TMDDTransportError(
                f"the response passed the {label} MB cap while it was still arriving, so it was "
                "abandoned. Raise 'Max Response Size (MB)' or narrow the query."
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _soap_fault(raw):
    """The fault the center raised, or None when the body is not one."""
    if not any(marker in raw for marker in FAULT_MARKERS):
        return None
    from defusedxml.ElementTree import fromstring

    try:
        root = fromstring(raw)
    except (ParseError, ValueError):
        # Not well-formed, so not a fault. The status check below reports it,
        # and on a 200 the decoder gives the better diagnosis.
        return None
    fault = root.find(f"{{{ENVELOPE_NS}}}Body/{{{ENVELOPE_NS}}}Fault")
    if fault is None:
        return None
    parts = [(fault.findtext(name) or "").strip() for name in ("faultcode", "faultstring")]
    return " ".join(part for part in parts if part) or "the fault carried no faultcode or faultstring"


def post_soap(config, body, timeout):
    """POST `body` to the configured center. Returns (raw bytes, decoded text).

    Both forms are returned on purpose. The decoder needs the BYTES: a center
    is free to declare an encoding of its own, and only the parser reading
    that declaration can apply it, so a `str` decoded out here has already
    lost whatever the guess got wrong. The text is for the optional Redis
    publish, which has to be JSON-serialisable.
    """
    megabytes = positive_number("max_response_mb", config.get("max_response_mb"), DEFAULT_MAX_RESPONSE_MB)
    headers = {"Content-Type": SOAP_CONTENT_TYPE, "SOAPAction": soap_action_header(config)}
    with requests.post(
        (config.get("endpoint_url") or "").strip(),
        data=body,
        headers=headers,
        timeout=timeout,
        verify=_verify(config),
        stream=True,
    ) as response:
        raw = _read_capped(response, int(megabytes * BYTES_PER_MB), _number_label(megabytes))
        fault = _soap_fault(raw)
        if fault is not None:
            raise TMDDTransportError(f"the center returned a SOAP fault: {fault}")
        if response.status_code >= 400:
            raise TMDDTransportError(f"the center returned HTTP {response.status_code}: {_snippet(raw)}")
        return raw, _decode_body(raw, response)


def _at_or_after(value, since):
    # A record carrying no timestamp is KEPT. `last-comm-time` and
    # `update-time` are both optional in the schema, so a center omitting one
    # is not saying the record is old, and dropping it would hide a live sign
    # behind a filter the user meant only to narrow by time.
    moment = parse_timestamp(value)
    return moment is None or moment >= since


def apply_record_limits(resource, records, config, params):
    """max_records, then since, then limit. The order is load-bearing.

    `max_records` is a cap that ERRORS, so a partial answer is never mistaken
    for the whole one; `limit` is a truncation the query asked for. Capping
    after truncating would therefore let a 50,000-record response through
    unremarked whenever a limit was set, which is the exact case the cap
    exists for. `since` sits between the two so `limit` truncates the rows the
    filter kept rather than rows it was about to drop.
    """
    max_records = positive_number("max_records", config.get("max_records"), DEFAULT_MAX_RECORDS)
    if len(records) > max_records:
        raise TMDDTransportError(
            f"the center returned {len(records)} records, over the max_records cap of "
            f"{_number_label(max_records)}. Raise 'Max Records' or narrow the query."
        )
    since = parse_timestamp(params.get("since"))
    if since is not None:
        records = [record for record in records if _at_or_after(record.get(SINCE_COLUMNS[resource]), since)]
    limit = params.get("limit")
    if limit is not None:
        records = records[:limit]
    return records

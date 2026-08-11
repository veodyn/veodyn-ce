"""
SOAP 1.1 request bodies for the TMDD v3.03d dialogs this connector polls.

Builds only. Nothing here opens a socket and nothing here reads a response;
the transport and the decoder are separate modules beside this one, the same
split `tmdd.py` describes.

**Only the message root is namespace-qualified.** Every schema file in the
v3.03d bundle declares `elementFormDefault="unqualified"` (matrix 2.3), so the
TMDD namespace belongs to the global element named in the WSDL message part
and to nothing beneath it. The root is therefore built as
`{TMDD_NS}name` and every descendant with a bare name. Writing the namespace
as a default `xmlns` on the root instead produces a document that parses to
the same root tag, reads correctly to a human, and fails XSD validation on its
first child. That failure is pinned in
`tests/query_runner/test_tmdd_schema_conformance.py`, and every request this
module builds is handed to the real published schema by
`tests/query_runner/test_tmdd_request.py`.

**Nothing is interpolated into a string.** The whole document is assembled as
an ElementTree and serialised once, so a value carrying `<`, `&` or a quote is
escaped by the serialiser rather than by a rule someone has to remember. An
organization ID is center-supplied configuration, not a constant.

**The two request types carry the requester's identity at different depths.**
`DeviceInformationRequest` has `organization-information` at the request root;
`EventFilterRequest` has no such sibling and carries it one level deeper, at
`request-header/organization-information` (matrix 6.3). Element order inside
both is fixed by an `xs:sequence`, so the order the builders below write in is
load-bearing, not stylistic.

**`params` never reaches the wire.** `since` and `limit` are applied
client-side after decode, because no v3.03d request type carries either
(`tmdd_config.ALLOWED_PARAMS` records why). The argument is accepted so the
signature does not have to change when a center-specific filter is one day
mapped onto `request-filters`, and a test pins that the bytes do not vary
with it today.
"""

import datetime
from xml.etree import ElementTree as ET

from redash.query_runner.tmdd_config import (
    DEFAULT_MESSAGE_TYPE_ID,
    DEFAULT_MESSAGE_TYPE_VERSION,
    DEFAULT_SOAP_ACTION,
)

__all__ = ["ENVELOPE_NS", "TMDD_NS", "build_request", "soap_action_header"]

ENVELOPE_NS = "http://schemas.xmlsoap.org/soap/envelope/"
TMDD_NS = "http://www.tmdd.org/303/messages"

# Registered globally so the serialiser writes `tmdd:eventRequestMsg` rather
# than an `ns0:` prefix it invents. The prefix itself carries no meaning to a
# validator, but an unreadable request is a worse thing to hand an agency
# engineer debugging a rejection.
ET.register_namespace("soap", ENVELOPE_NS)
ET.register_namespace("tmdd", TMDD_NS)

# Transcribed from the enumerations, not paraphrased: `Device-type`,
# `Device-information-type` and `Event-request-focus` (matrix 1 and 3). A
# near miss like "dynamic message signs" is a schema violation, so these are
# constants rather than literals spelled out at each use.
DEVICE_TYPE_DMS = "dynamic message sign"
EVENT_REQUEST_FOCUS = "all current events"

DEVICE_INFORMATION_TYPES = {
    "dms_inventory": "device inventory",
    "dms_status": "device status",
}


def soap_action_header(config):
    """The value for the HTTP `SOAPAction` header, quotes included.

    All ~80 operations in the v3.03d binding declare the identical raw
    attribute value, and that value is two apostrophes rather than an empty
    string (matrix 2.1). Read as an authoring artifact it means "no action",
    which is `SOAPAction: ""`; read literally it means the action URI is `''`,
    which is `SOAPAction: "''"`. The bundle settles neither, so the default is
    the conventional reading and a center wanting the literal one is
    configured, not patched.
    """
    return '"{}"'.format(config.get("soap_action") or DEFAULT_SOAP_ACTION)


def _root(body_element_name):
    envelope = ET.Element(f"{{{ENVELOPE_NS}}}Envelope")
    body = ET.SubElement(envelope, f"{{{ENVELOPE_NS}}}Body")
    # elementFormDefault is "unqualified" in every file of the v3.03d bundle,
    # so ONLY this root is in the TMDD namespace. Descendants are built with
    # bare names and must stay bare. Writing the namespace as a default xmlns
    # here would pull every child into it, producing a document that parses
    # identically at the root and FAILS schema validation.
    message = ET.SubElement(body, f"{{{TMDD_NS}}}{body_element_name}")
    return envelope, message


def _text(parent, name, value):
    child = ET.SubElement(parent, name)
    child.text = value
    return child


def unsigned_byte(key, raw, default):
    """A whole number 0 to 255 as text, or a ValueError naming the field.

    `Event-message-type-identifier` and `Event-message-type-version` are both
    unconstrained `xs:unsignedByte` (matrix 6.3). The configuration form types
    them "number" and cannot express the range, so this is the only place a
    value the center's own schema would reject can be caught before it is
    sent.
    """
    if raw is None or raw == "":
        return str(default)
    try:
        number = float(raw)
    except (TypeError, ValueError):
        number = None
    if number is None or number != int(number) or not 0 <= number <= 255:
        raise ValueError(
            f"TMDD: {key} must be a whole number from 0 to 255, the schema types it xs:unsignedByte. Got {raw!r}."
        )
    return str(int(number))


def _authentication(message, config):
    """Append the optional `authentication` block, or nothing at all.

    `minOccurs="0"`, and both `user-id` and `password` are mandatory once it
    is present (matrix 6.1). An empty `<authentication/>` is not the same as
    an absent one: it asserts a user ID of "", which the schema rejects. The
    runner already refuses half a credential at configuration time, so an
    absent username here means the center wants none.
    """
    username = (config.get("username") or "").strip()
    password = config.get("password") or ""
    if not username:
        return
    block = ET.SubElement(message, "authentication")
    _text(block, "user-id", username)
    _text(block, "password", password)


def _organization_information(parent, config):
    # `organization-id` is the only required child (matrix 6.2). This is the
    # requester's own identity, not `organization-requesting`, which is the
    # separate optional list of organizations a request is about.
    block = ET.SubElement(parent, "organization-information")
    _text(block, "organization-id", config.get("organization_id") or "")
    return block


def _date_time_zone(parent, name, moment):
    """The composite `DateTimeZone` shape, which is not an ISO-8601 string.

    `Date` is `xs:string` with `length` 8 and `Time` is `minLength` 6 /
    `maxLength` 10, so neither field can hold one (matrix 6.4). `offset` is
    `xs:string` with `length` 5 and optional; the bundle documents no format
    for it, and `+HHMM` is inferred from the length facet alone. A naive
    datetime therefore emits no offset rather than a guessed one, so the
    center reads its own default instead of a claim this code cannot support.
    """
    block = ET.SubElement(parent, name)
    _text(block, "date", moment.strftime("%Y%m%d"))
    _text(block, "time", moment.strftime("%H%M%S"))
    utc_offset = moment.utcoffset()
    if utc_offset is not None:
        minutes = int(utc_offset.total_seconds()) // 60
        sign = "-" if minutes < 0 else "+"
        hours, remainder = divmod(abs(minutes), 60)
        _text(block, "offset", f"{sign}{hours:02d}{remainder:02d}")
    return block


def _build_events(config, now):
    # EventFilterRequest: authentication?, request-header, request-type,
    # request-filters?, request-locations?, request-times?.
    envelope, message = _root("eventRequestMsg")
    _authentication(message, config)
    header = ET.SubElement(message, "request-header")
    _organization_information(header, config)
    _text(
        header,
        "message-type-id",
        unsigned_byte("message_type_id", config.get("message_type_id"), DEFAULT_MESSAGE_TYPE_ID),
    )
    _text(
        header,
        "message-type-version",
        unsigned_byte("message_type_version", config.get("message_type_version"), DEFAULT_MESSAGE_TYPE_VERSION),
    )
    _date_time_zone(header, "message-time-stamp", now)
    # `dlFullEventUpdateRequest` and `dlEventIndexRequest` share this request
    # element, so the focus is what selects a full update, not the operation.
    _text(ET.SubElement(message, "request-type"), "request-focus", EVENT_REQUEST_FOCUS)
    return envelope


def _build_device_information(config, information_type):
    # DeviceInformationRequest: authentication?, organization-information,
    # organization-requesting?, device-type, device-information-type,
    # device-filter?. Roughly 30 WSDL operations share this one element, so
    # the two discriminators below are the only thing telling a DMS inventory
    # request apart from a CCTV one (matrix 2.2).
    envelope, message = _root("deviceInformationRequestMsg")
    _authentication(message, config)
    _organization_information(message, config)
    _text(message, "device-type", DEVICE_TYPE_DMS)
    _text(message, "device-information-type", information_type)
    return envelope


def build_request(resource, config, params, now=None):
    """The full SOAP 1.1 envelope for `resource`, UTF-8 encoded.

    `params` has already been checked against the per-resource allow list by
    the runner and is not encoded into the request; see the module docstring.
    `now` is injectable so the message timestamp can be pinned by a test.
    """
    del params
    moment = now if now is not None else datetime.datetime.now(datetime.timezone.utc)
    if resource == "events":
        envelope = _build_events(config, moment)
    elif resource in DEVICE_INFORMATION_TYPES:
        envelope = _build_device_information(config, DEVICE_INFORMATION_TYPES[resource])
    else:
        known = ", ".join(["events", *sorted(DEVICE_INFORMATION_TYPES)])
        raise ValueError(f"TMDD: no request is defined for resource {resource!r}. Known resources: {known}.")
    return ET.tostring(envelope, encoding="utf-8")

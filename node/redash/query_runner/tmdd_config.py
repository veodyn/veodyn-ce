"""
The TMDD runner's configuration surface, as data.

Split out of `tmdd.py` for the repo's 300-line limit, and along the seam
that costs least: the form's field descriptions are long because they carry
rulings a reader of the v3.03d bundle would otherwise have to rediscover,
and none of that text is logic. `tmdd.py` keeps the runner.

The `since` / `limit` table lives here too, because it is the same kind of
thing: a declaration of what the form and the query language accept, read
by the runner rather than executed by it.

So does the validation of both, for the reason `tmdd.py`'s docstring gives:
everything checked here is checked before the transport, so a mistyped form
field or an unreadable filter value is reported as what it is rather than as
a request that failed against a center which was never contacted.
"""

import datetime
import math

SUPPORTED_VERSION = "3.03d"

DEFAULT_SOAP_ACTION = ""
DEFAULT_MESSAGE_TYPE_ID = 1
DEFAULT_MESSAGE_TYPE_VERSION = 1
DEFAULT_MAX_RESPONSE_MB = 10
DEFAULT_MAX_RECORDS = 10000

NOOP_RESOURCE = "dms_inventory"

# Per resource, so a param that is meaningful for one is still refused for
# another. Checked before any transport: a misspelled filter that fell
# through would become an unbounded request against a live center.
#
# Both params are applied client-side, after decode. No request type in the
# v3.03d bundle carries a result count or an updated-since filter, and
# `request-times` has no stated semantics there, so sending one would risk
# silently returning the wrong rows. `dms_inventory` decodes to no timestamp
# column at all, so `since` is refused for it rather than ignored.
ALLOWED_PARAMS = {
    "events": frozenset({"since", "limit"}),
    "dms_inventory": frozenset({"limit"}),
    "dms_status": frozenset({"since", "limit"}),
}

# The decoded column each resource's `since` filter compares against.
# `dms_inventory` is absent for the reason above: it decodes to no timestamp
# column at all, which is why `since` is refused for it rather than ignored.
SINCE_COLUMNS = {
    "events": "update_time",
    "dms_status": "last_update",
}

PARAM_DOCS = {
    "limit": "limit (optional; max rows returned, applied client-side after decode)",
    "since": "since (optional ISO-8601 timestamp; applied client-side after decode)",
}

# Written out by hand rather than derived from ALLOWED_PARAMS, so the two
# tables are independent and a test can prove they still agree.
RESOURCE_RETURNS = {
    "events": ["one row per event: identity, type, severity, status, roadway, coordinates, times"],
    "dms_inventory": ["one row per sign: identity, device type, roadway, direction, coordinates"],
    "dms_status": ["one row per sign: operational status, current message, beacon state, last update"],
}

REQUIRED_FIELDS = ["endpoint_url", "organization_id"]
SECRET_FIELDS = ["password"]

CONFIGURATION_PROPERTIES = {
    "endpoint_url": {
        "type": "string",
        "title": "C2C SOAP Endpoint URL",
        "description": (
            "The center's TMDD Center-to-Center SOAP endpoint. This connector only ever "
            "sends request messages, never a control or command operation."
        ),
    },
    # maxLength, not just a number in the description. jsonschema is what
    # `ConfigurationContainer.validate` runs before a data source is written,
    # and it does not read help text: a 300-character password saved, posted
    # and was refused by the center. No minLength on the two credentials, on
    # purpose: they are optional, both empty is the supported anonymous case,
    # and build_configuration_schema adds minLength only to required strings
    # for exactly that reason.
    "username": {
        "type": "string",
        "title": "User ID",
        "maxLength": 32,
        "description": (
            "Sent as authentication/user-id, 1 to 32 characters. The authentication block "
            "is optional, but both of its children are mandatory once it is present, so a "
            "user ID and a password must be given together or both left empty."
        ),
    },
    "password": {
        "type": "string",
        "title": "Password",
        "maxLength": 256,
        "description": (
            "Sent as authentication/password, 1 to 256 characters. The v3.03d bundle "
            "defines Security-password in two files with different limits; the "
            "authentication block is declared in TMDD.xsd and references it unprefixed, "
            "so TMDD.xsd's limit of 256 is the one the schema enforces."
        ),
    },
    "organization_id": {
        "type": "string",
        "title": "Organization ID",
        "maxLength": 32,
        "description": (
            "This system's organization identifier, 1 to 32 characters. Sent in every "
            "request so the center can attribute it."
        ),
    },
    "tmdd_version": {
        "type": "string",
        "title": "TMDD Version",
        "default": SUPPORTED_VERSION,
        "enum": [SUPPORTED_VERSION],
        "description": (
            "Only v3.03d is implemented. Anything else is refused at query time rather "
            "than sent and hoped for."
        ),
    },
    "soap_action": {
        "type": "string",
        "title": "SOAPAction Header Value",
        "default": DEFAULT_SOAP_ACTION,
        "description": (
            'Left empty, the SOAPAction header is sent as "". The v3.03d WSDL declares the '
            "same raw value for all 80 operations, and that value is two apostrophe "
            "characters rather than an empty string. Read as an authoring artifact it "
            "means empty; read literally it means the action URI is ''. The bundle cannot "
            "settle it, so a center that wants the literal can be given '' here without a "
            "code change."
        ),
    },
    "message_type_id": {
        "type": "number",
        "title": "Message Type ID",
        "default": DEFAULT_MESSAGE_TYPE_ID,
        "description": (
            "Mandatory in an event request header. The v3.03d bundle does not define what "
            "any particular value means, so the default is sent unless a center documents "
            "one of its own."
        ),
    },
    "message_type_version": {
        "type": "number",
        "title": "Message Type Version",
        "default": DEFAULT_MESSAGE_TYPE_VERSION,
        "description": (
            "Mandatory in an event request header. As with the message type ID, the bundle "
            "does not define its values."
        ),
    },
    "verify_tls": {
        "type": "boolean",
        "title": "Verify TLS Certificate",
        "default": True,
    },
    "ca_bundle": {
        "type": "string",
        "title": "CA Bundle Path (optional)",
        "description": (
            "Path to a PEM bundle used to verify the center's certificate. Agency centers "
            "commonly run a private CA, which is worth trusting explicitly rather than "
            "turning verification off."
        ),
    },
    "max_response_mb": {
        "type": "number",
        "title": "Max Response Size (MB)",
        "default": DEFAULT_MAX_RESPONSE_MB,
        "description": "Enforced while the body streams in, before it is parsed.",
    },
    "max_records": {
        "type": "number",
        "title": "Max Records",
        "default": DEFAULT_MAX_RECORDS,
        "description": (
            "A cap on the decoded record count. Exceeding it is an error, not a "
            "truncation, so a partial answer is never mistaken for the whole one. The "
            "limit param is the opposite: it truncates on purpose."
        ),
    },
}


def positive_number(field, raw, default):
    """A number greater than zero, or a ValueError naming the field.

    The sibling of `tmdd_request.unsigned_byte`, and it exists for the same
    reason: the configuration form types both caps "number" and JSON Schema
    cannot express a floor, so a value that is not one would first be noticed
    inside `_fetch`, where the base would dress a mistyped form field up as a
    failed request. An empty value is the pre-existing data source that was
    saved before the field existed, and takes the documented default.

    FINITE, not merely positive. `float()` accepts "nan", "inf" and
    "infinity" in any spelling, and a `<= 0` floor catches neither: every
    comparison against nan is False, so `len(records) > max_records` could
    never be True and the record cap was not lenient but OFF, and inf turns
    it off the honest way. `-inf` was already refused, which is why the hole
    was easy to miss. max_response_mb took the same values through preflight
    and then failed inside `post_soap`, where `int(megabytes * BYTES_PER_MB)`
    runs after the HTTP response is already open, reporting a misconfigured
    field as a request that failed against the center.
    """
    if raw is None or raw == "":
        return default
    try:
        number = float(raw)
    except (TypeError, ValueError):
        number = None
    if number is None or not math.isfinite(number) or number <= 0:
        raise ValueError(f"TMDD: {field} must be a number greater than zero. Got {raw!r}.")
    return number


def parse_timestamp(value):
    """`value` as an aware datetime, or None if it is not a timestamp.

    A value carrying no offset is read as UTC rather than refused. The
    decoder emits one whenever the center's DateTimeZone omitted `offset`,
    which the schema allows, and Python refuses to compare a naive datetime
    with an aware one at all, so the alternatives are to drop every such
    record or to raise on it.
    """
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if moment.tzinfo is None:
        return moment.replace(tzinfo=datetime.timezone.utc)
    return moment


def validate_params(name, resource, params):
    """
    Return an error naming every param this resource does not accept, or a
    value it cannot use, or None. An unknown resource is not this function's
    business: the base reports that one, with the resources that do exist.
    """
    allowed = ALLOWED_PARAMS.get(resource)
    if allowed is None:
        return None
    unknown = sorted(set(params) - allowed)
    if unknown:
        listed = ", ".join(repr(param) for param in unknown)
        return (
            f"{name}: unknown param {listed} for resource {resource!r}. "
            f"Allowed params: {', '.join(sorted(allowed))}."
        )
    return _param_value_error(name, params)


def _param_value_error(name, params):
    # Both params are applied client-side after decode, so a value the filter
    # cannot use has to be caught here: left to _fetch it would raise, and the
    # base would report a typo in the query as a failed request.
    if "since" in params and parse_timestamp(params["since"]) is None:
        return (
            f"{name}: 'since' must be an ISO-8601 timestamp, for example '2026-01-01T00:00:00Z'. "
            f"Got {params['since']!r}."
        )
    if "limit" in params:
        limit = params["limit"]
        # bool first: it is a subclass of int, so True would otherwise pass
        # as a limit of one row.
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 0:
            return f"{name}: 'limit' must be a whole number of rows, zero or more. Got {limit!r}."
    return None

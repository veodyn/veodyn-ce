"""
Reading a TMDD v3.03d document: namespace rule, scalars, and shared types.

The generic half of the decoder. `tmdd_decode` holds the per-resource record
shapes and imports everything below; nothing here knows what a DMS or an
event is. Split out for the repo's 300-line limit, along the seam that costs
least: every function here is a pure helper over an ElementTree node.

**Only the message root is namespace-qualified.** Every file in the v3.03d
bundle declares `elementFormDefault="unqualified"` (matrix 2.3), which is the
rule `tmdd_request._root` builds to, read in reverse: the root global element
is in the TMDD namespace and every descendant is BARE. A center that declares
a default `xmlns` on the root instead produces a document that parses, keeps
the right root tag, and puts every child in the TMDD namespace. Searching for
bare names then matches nothing, the decoder returns no records, and the
empty table reads as "the center had no signs" rather than as a bug. That is
why `root_message` refuses a qualified descendant instead of returning
nothing. An empty response is a different thing and is allowed through: it is
schema-invalid, since the response requires at least one record, but a center
can still send one and it is not ambiguous.

**An enumerated value is carried verbatim.** Both arms of the union are
accepted and neither is translated into the other, for the reason `tmdd_rows`
records. A value in neither arm is refused rather than passed on, because a
column silently holding a value the center's own schema rejects is worse than
a failed query.
"""

from xml.etree.ElementTree import ParseError

from redash.query_runner.tmdd_request import ENVELOPE_NS, TMDD_NS
from redash.query_runner.tmdd_rows import ENUMERATIONS

__all__ = [
    "COORDINATE_BOUNDS",
    "MICRODEGREES",
    "TMDDResponseError",
    "branches",
    "coordinates",
    "enumerated",
    "first_text",
    "integer_value",
    "root_message",
    "text",
    "timestamp",
    "verbatim_text",
]

# Latitude divides -90000000..90000000 over -90..90 degrees and longitude
# -180000000..180000000 over -180..180, so both arms give the same factor
# (matrix 7). The bundle never writes the word "degree" on these types, so
# the raw integer is kept beside every converted value.
MICRODEGREES = 1000000.0

# The two ranges above, as the MANDATORY bounds the matrix records them as
# (section 7). They are per axis and not one shared limit: 180000000 is a
# valid longitude and an impossible latitude. Checked before the division,
# for the reason the enumerations are checked at all, only more so. An
# enumerated value is carried through untouched, so a bad one is at worst a
# string the center's schema rejects; a coordinate is TRANSFORMED, so an
# unchecked one becomes a plausible-looking float in a column a map will
# happily plot at 999 degrees north.
COORDINATE_BOUNDS = {"latitude": 90000000, "longitude": 180000000}


class TMDDResponseError(Exception):
    """A response this connector will not decode, with the reason in it."""


def _parse(xml):
    # defusedxml, not the stdlib parser: this is XML from an external center.
    # Imported here rather than at module scope so `TMDD.enabled()` stays the
    # single gate on its absence.
    from defusedxml.ElementTree import fromstring

    try:
        return fromstring(xml)
    except (ParseError, ValueError) as e:
        raise TMDDResponseError(f"TMDD: the response body is not well-formed XML: {e}") from e


def root_message(xml, message_name):
    """The message element itself, unwrapped from a SOAP envelope if present."""
    root = _parse(xml)
    if root.tag == f"{{{ENVELOPE_NS}}}Envelope":
        body = root.find(f"{{{ENVELOPE_NS}}}Body")
        root = next(iter(body), None) if body is not None else None
        if root is None:
            raise TMDDResponseError("TMDD: the SOAP envelope carries no body element.")
    expected = f"{{{TMDD_NS}}}{message_name}"
    if root.tag != expected:
        raise TMDDResponseError(
            f"TMDD: expected a {message_name} response in the {TMDD_NS} namespace, the center sent {root.tag!r}."
        )
    qualified = next((e.tag for e in root.iter() if e is not root and e.tag.startswith(f"{{{TMDD_NS}}}")), None)
    if qualified is not None:
        raise TMDDResponseError(
            f"TMDD: {qualified!r} is namespace-qualified. The schema declares "
            'elementFormDefault="unqualified", so only the message root carries the TMDD '
            "namespace and every element inside it is bare. Decoding this document would "
            "match nothing and report an empty result instead of a malformed response."
        )
    return root


def text(element, path):
    if element is None:
        return None
    found = element.find(path)
    if found is None:
        return None
    return (found.text or "").strip() or None


def verbatim_text(element, path):
    """`path`'s text exactly as it arrived: nothing stripped, nothing folded.

    `text` above is right for every field this connector reads except one.
    It trims, and it folds an empty element into None, which is what you want
    for an id, a name or an enumerated token, where surrounding whitespace is
    an artifact of how the center pretty-printed its XML.

    `current-message` is the exception, and it needs its own reader rather
    than a change to `text` for everything. TMDD types it as an unrestricted
    string, it can carry NTCIP MULTI markup in which whitespace is
    significant, and docs/docs/connectors.md promises the column is returned
    exactly as the center sent it. The two states also have to stay apart: a
    sign displaying nothing sends an empty element and means "", while a
    center that did not report the field at all means None. `or None`
    collapsed those into one answer.
    """
    if element is None:
        return None
    found = element.find(path)
    if found is None:
        return None
    return found.text or ""


def first_text(element, *paths):
    for path in paths:
        value = text(element, path)
        if value is not None:
            return value
    return None


def enumerated(type_name, value, path):
    """The arriving value, unchanged, or a refusal naming both arms."""
    if value is None:
        return None
    table = ENUMERATIONS[type_name]
    if value in table.values:
        return value
    low, high = table.integers
    try:
        number = int(value)
    except ValueError:
        number = None
    if number is not None and low <= number <= high:
        return value
    raise TMDDResponseError(
        f"TMDD: {path} carries {value!r}, which {type_name} does not define. "
        f"It accepts the integers {low} to {high} or one of: {', '.join(table.values)}."
    )


def integer_value(value, path):
    if value is None:
        return None
    try:
        return int(value)
    except ValueError as e:
        raise TMDDResponseError(f"TMDD: {path} carries {value!r}, which is not a whole number.") from e


def coordinates(geo, path):
    """A GeoLocation as degrees plus the raw integer the conversion used."""
    record = {"latitude": None, "longitude": None, "latitude_raw": None, "longitude_raw": None}
    if geo is None:
        return record
    for name in ("latitude", "longitude"):
        raw = integer_value(text(geo, name), f"{path}/{name}")
        limit = COORDINATE_BOUNDS[name]
        if raw is not None and not -limit <= raw <= limit:
            raise TMDDResponseError(
                f"TMDD: {path}/{name} carries {raw}, outside the mandatory {-limit} to {limit} "
                f"range the schema declares (matrix 7). The value is in millionths of a degree, "
                f"so the row this would produce claims a place that does not exist."
            )
        record[f"{name}_raw"] = raw
        record[name] = None if raw is None else raw / MICRODEGREES
    return record


def timestamp(parent, path):
    """A composite DateTimeZone assembled into an ISO-8601 string.

    `date` is a fixed 8 characters and `time` is 6 to 10, both unseparated,
    so neither field holds an ISO string and the three siblings have to be
    read together (matrix 6.4). `offset` is optional and is a fixed 5
    characters whose layout the bundle never documents; `+HHMM` is inferred
    from the length facet, so an offset of any other length is refused rather
    than reshaped into something that would look authoritative.
    """
    block = parent.find(path) if parent is not None else None
    if block is None:
        return None
    date = text(block, "date")
    moment = text(block, "time")
    if date is None or moment is None:
        raise TMDDResponseError(f"TMDD: {path} is missing its date or time; DateTimeZone needs both.")
    if len(date) != 8 or not date.isdigit() or not 6 <= len(moment) <= 10 or not moment.isdigit():
        raise TMDDResponseError(
            f"TMDD: {path} carries date {date!r} and time {moment!r}. The schema fixes date at 8 "
            "digits (YYYYMMDD) and time at 6 to 10 (HHMMSSssss)."
        )
    stamp = f"{date[0:4]}-{date[4:6]}-{date[6:8]}T{moment[0:2]}:{moment[2:4]}:{moment[4:6]}"
    if len(moment) > 6:
        stamp = f"{stamp}.{moment[6:]}"
    offset = text(block, "offset")
    if offset is None:
        return stamp
    if len(offset) != 5:
        raise TMDDResponseError(f"TMDD: {path}/offset carries {offset!r}; the schema fixes it at 5 characters.")
    return f"{stamp}{offset[0:3]}:{offset[3:5]}"


def _branch_value(element):
    """One choice branch, whole. No child field is discarded."""
    children = list(element)
    if not children:
        return (element.text or "").strip() or None
    value = {}
    for child in children:
        rendered = _branch_value(child)
        if child.tag not in value:
            value[child.tag] = rendered
        elif isinstance(value[child.tag], list):
            value[child.tag].append(rendered)
        else:
            value[child.tag] = [value[child.tag], rendered]
    return value


def branches(parent, path):
    """Every repeat of an xs:choice at `path`, as JSON-ready kind/value pairs.

    Both `EventDescription` and `EventLocation` are choices whose branches
    are mostly nested structures, so which fields exist varies per item and a
    flat column cannot hold them. `kind` is the branch's local name, which is
    the only discriminator the schema gives.
    """
    items = []
    for element in parent.findall(path):
        branch = next(iter(element), None)
        if branch is not None:
            items.append({"kind": branch.tag, "value": _branch_value(branch)})
    return items

"""
The TMDD v3.03d event response documents.

Split out of `tmdd_fixtures` for the repo's 300-line limit. Both documents
here are listed in that module's `CONFORMANT_FIXTURES` and proved against
the published XSD from there.

MessageHeader's required children are organization-SENDING (not
organization-information), message-type-version, message-number and
message-time-stamp. EventReference additionally requires `event-update`.

**No two competing paths carry the same value, and no detail is empty.**
Both rules are here because the fixture broke both and the decode tests
passed anyway. `description` reads event-comments/event-comment while a
near-identical value sits at the first additional-text/description;
`update_time` reads event-reference/update-time while another sits in each
element-detail's event-times. When either pair matched, the flat column
could regress to the wrong path with nothing going red. And every
description and location used to sit in the FIRST element-detail, with the
second carrying only times, so `descriptions` and `locations` could stop
traversing the outer repeat and still produce the expected list.
"""

from tests.query_runner.tmdd_fixture_parts import (
    TIME_1430,
    TIME_1500,
    TIME_1515,
    TIME_1530,
    TIME_1545,
    message,
)

_MESSAGE_HEADER = (
    "<message-header>"
    "<organization-sending><organization-id>WSDOT</organization-id></organization-sending>"
    "<message-type-version>1</message-type-version><message-number>1</message-number>"
    f"<message-time-stamp>{TIME_1530}</message-time-stamp>"
    "</message-header>"
)

# The record-level update-time, and deliberately none of the per-detail ones.
_REFERENCE = (
    "<event-reference><event-id>EVT-000123</event-id><event-update>4</event-update>"
    f"<update-time>{TIME_1545}</update-time></event-reference>"
)

# EventIndicator is an xs:choice, so each repeat carries exactly one field.
_INDICATORS = (
    "<event-indicators>"
    "<event-indicator><status>confirmed</status></event-indicator>"
    "<event-indicator><severity>major</severity></event-indicator>"
    "</event-indicators>"
)

# EventType is a 38-branch choice, each branch an ITIS enumeration. The
# branch LOCAL NAME is the taxonomy; the text inside it is the ITIS code.
_HEADLINE = (
    "<event-headline><headline>"
    "<accidents-and-incidents>injury accident</accidents-and-incidents>"
    "</headline></event-headline>"
)

# Three repeats over two branches in the first detail. `quantity` is a nested
# structure (EventQuantity -> DataExtent -> length-affected), which is what
# forces the JSON value to be an object rather than a scalar. None of these
# three may equal the event-comment below.
_FIRST_DESCRIPTIONS = (
    "<event-descriptions>"
    "<event-description><additional-text><description>First description text</description></additional-text></event-description>"
    "<event-description><quantity><extent><length-affected>2</length-affected></extent></quantity></event-description>"
    "<event-description><additional-text><description>Third</description></additional-text></event-description>"
    "</event-descriptions>"
)

# Two repeats over two different branches of EventLocation, which is the case
# a single flat coordinate column cannot represent.
_FIRST_LOCATIONS = (
    "<event-locations>"
    "<event-location><location-on-link>"
    "<link-designator>I-5</link-designator><link-name>Interstate 5</link-name>"
    "<primary-location>"
    "<geo-location><latitude>47606200</latitude><longitude>-122332100</longitude></geo-location>"
    "<link-name>I-5 at Union St</link-name>"
    "</primary-location>"
    "<link-direction>n</link-direction>"
    "</location-on-link></event-location>"
    "<event-location><area-location>"
    "<area-id>KINGCOUNTY</area-id><area-name>King County</area-name>"
    "</area-location></event-location>"
    "</event-locations>"
)

# The second detail's own content, on a THIRD branch of EventLocation and at
# a different place. The flat `direction`, `latitude` and `longitude` columns
# read the first detail only, so these values appearing in `locations` while
# the flat columns keep the first detail's is the whole assertion.
_SECOND_DESCRIPTIONS = (
    "<event-descriptions>"
    "<event-description><additional-text><description>Second detail text</description></additional-text></event-description>"
    "</event-descriptions>"
)

_SECOND_LOCATIONS = (
    "<event-locations>"
    "<event-location><geo-location>"
    "<latitude>47000000</latitude><longitude>-122000000</longitude>"
    "</geo-location></event-location>"
    "</event-locations>"
)

# Two element details whose update-times differ, which is why the per-detail
# times are kept as an array instead of collapsed into one cell.
_ELEMENT_DETAILS = (
    "<event-element-details>"
    "<event-element-detail>"
    "<event-category>current</event-category>"
    f"{_FIRST_DESCRIPTIONS}{_FIRST_LOCATIONS}"
    f"<event-times><update-time>{TIME_1500}</update-time><start-time>{TIME_1430}</start-time></event-times>"
    "</event-element-detail>"
    "<event-element-detail>"
    f"{_SECOND_DESCRIPTIONS}{_SECOND_LOCATIONS}"
    f"<event-times><update-time>{TIME_1515}</update-time></event-times>"
    "</event-element-detail>"
    "</event-element-details>"
)

# Distinct from every additional-text/description above, so the flat
# `description` column cannot be satisfied by the wrong path.
_COMMENTS = "<event-comments><event-comment>Center comment on EVT-000123</event-comment></event-comments>"

CONTENT_IN_BOTH_DETAILS = message(
    "fEUMsg",
    "<FEU>" f"{_MESSAGE_HEADER}{_REFERENCE}{_INDICATORS}{_HEADLINE}{_ELEMENT_DETAILS}{_COMMENTS}" "</FEU>",
)

# Everything optional on FullEventUpdate is gone: no indicators, no headline,
# no element details, no comments. Only message-header is mandatory.
EVENT_WITH_EVERY_OPTIONAL_BLOCK_ABSENT = message("fEUMsg", f"<FEU>{_MESSAGE_HEADER}{_REFERENCE}</FEU>")

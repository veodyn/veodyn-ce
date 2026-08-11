"""
TMDD v3.03d documents that are deliberately NOT schema-valid.

Split out of `tmdd_fixtures` for the repo's 300-line limit, along the seam
that module's own docstring already draws: everything there is conformant
unless its name says otherwise, and everything here is the otherwise. The
split is one-directional (this module imports that one, never the reverse),
and nothing here may be listed in `CONFORMANT_FIXTURES`.

Every document below is DERIVED from a conformant one by a single string
replacement, so each is invalid on exactly the field its name mentions and
identical to a valid document everywhere else. A hand-written near miss
drifts: the reader cannot then tell whether a decoder refused it for the
reason the test claims or for a second mistake nobody noticed.
"""

from tests.query_runner.tmdd_fixture_parts import TMDD_NS
from tests.query_runner.tmdd_fixtures import (
    CONTENT_IN_BOTH_DETAILS,
    EVENT_WITH_EVERY_OPTIONAL_BLOCK_ABSENT,
    ONE_DEVICE_AT_KNOWN_COORDS,
    OPER_STATUS_AS_STRING,
    WITH_LAST_COMM_TIME,
)

# `current-message` is MANDATORY in DMSStatus, proved against the published
# XSD: omitting it fails with "Unexpected child with tag 'message-beacon' at
# position 2. Tag 'current-message' expected." A center can still send this,
# and the decoder has to tell it apart from a sign that reported a blank
# message, which is schema-valid and lives in tmdd_fixtures.
NO_CURRENT_MESSAGE_ELEMENT = WITH_LAST_COMM_TIME.replace(
    "<current-message>ROAD WORK[nl]AHEAD</current-message>", ""
)

# An empty dMSInventoryMsg is schema-INVALID: the sequence wrapping
# `dms-inventory-item` defaults to minOccurs 1, so a response with no device
# record fails validation, and so does a header-only one. It is kept anyway,
# because a center can still send it and the decoder must survive it rather
# than raise.
NON_CONFORMANT_EMPTY_RESPONSE = '<tmdd:dMSInventoryMsg xmlns:tmdd="http://www.tmdd.org/303/messages"/>'

# A center on some other revision, or a proxy that rewrote the namespace. The
# root's local name still matches, so a decoder keyed on local names alone
# would decode this happily.
FOREIGN_NAMESPACE_RESPONSE = EVENT_WITH_EVERY_OPTIONAL_BLOCK_ABSENT.replace(
    TMDD_NS, "http://www.tmdd.org/304/messages"
)

# The failure mode this whole plan is built around: a default xmlns on the
# root pulls every descendant into the TMDD namespace. The root tag is
# unchanged, so the document parses and looks right; every child search then
# misses and the table comes back empty, which reads as "the center had no
# events".
DEFAULT_XMLNS_RESPONSE = CONTENT_IN_BOTH_DETAILS.replace(
    f'<tmdd:fEUMsg xmlns:tmdd="{TMDD_NS}">', f'<fEUMsg xmlns="{TMDD_NS}">'
).replace("</tmdd:fEUMsg>", "</fEUMsg>")

# One enumerated value replaced by a plausible near miss per document. Each
# is schema-invalid on that one field and nothing else.
EVENT_WITH_UNKNOWN_SEVERITY_VALUE = CONTENT_IN_BOTH_DETAILS.replace(
    "<severity>major</severity>", "<severity>catastrophic</severity>"
)
EVENT_WITH_UNKNOWN_STATUS_VALUE = CONTENT_IN_BOTH_DETAILS.replace(
    "<status>confirmed</status>", "<status>pending</status>"
)
EVENT_WITH_UNKNOWN_DIRECTION_VALUE = CONTENT_IN_BOTH_DETAILS.replace(
    "<link-direction>n</link-direction>", "<link-direction>north</link-direction>"
)
EVENT_WITH_UNKNOWN_CATEGORY_VALUE = CONTENT_IN_BOTH_DETAILS.replace(
    "<event-category>current</event-category>", "<event-category>ongoing</event-category>"
)
DEVICE_STATUS_WITH_UNKNOWN_OPER_STATUS = OPER_STATUS_AS_STRING.replace(
    "<device-status>out of service</device-status>", "<device-status>degraded</device-status>"
)

# The DEVICE side of Link-direction. The events decoder reads that table
# through event-location; dms_inventory reads it through
# device-inventory-header, and every conformant DMS fixture carries a valid
# direction, so without this document the second call site could be reverted
# to a plain text() read with the whole suite still green.
DEVICE_WITH_UNKNOWN_DIRECTION_VALUE = ONE_DEVICE_AT_KNOWN_COORDS.replace(
    "<link-direction>n</link-direction>", "<link-direction>north</link-direction>"
)

# Coordinates outside the mandatory bounds the matrix records in section 7:
# Latitude is -90000000..90000000 and Longitude is -180000000..180000000,
# both in millionths of a degree. Each of these parses as an integer and
# divides cleanly by a million, which is all a decoder checking only "is it a
# whole number" would ever ask, and the row it produces claims a place that
# does not exist.
DEVICE_AT_IMPOSSIBLE_LATITUDE = ONE_DEVICE_AT_KNOWN_COORDS.replace(
    "<latitude>47606200</latitude>", "<latitude>999000000</latitude>"
)
DEVICE_AT_IMPOSSIBLE_LONGITUDE = ONE_DEVICE_AT_KNOWN_COORDS.replace(
    "<longitude>-122332100</longitude>", "<longitude>-999000000</longitude>"
)
# One past the bound in each direction, so the check is proved to be a bound
# and not a rounder cap someone picked. The matching in-range boundary values
# are asserted in test_tmdd_decode against the conformant fixtures.
DEVICE_ONE_PAST_THE_LATITUDE_BOUND = ONE_DEVICE_AT_KNOWN_COORDS.replace(
    "<latitude>47606200</latitude>", "<latitude>90000001</latitude>"
)
DEVICE_ONE_PAST_THE_LONGITUDE_BOUND = ONE_DEVICE_AT_KNOWN_COORDS.replace(
    "<longitude>-122332100</longitude>", "<longitude>-180000001</longitude>"
)

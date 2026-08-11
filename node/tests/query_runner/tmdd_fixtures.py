"""
Shared TMDD v3.03d documents for the TMDD tests: requests, and the two DMS
response resources.

Kept out of the test modules so the conformance harness
(test_tmdd_schema_conformance.py) and the query runner tests exercise the same
bytes. Not a test module itself (no `test_` prefix), so pytest does not collect
it.

Every constant reachable from here is schema-valid against the real TMDD
v3.03d XSD unless its name says otherwise. Before adding one, prove it with
`assert_conforms` from test_tmdd_schema_conformance rather than by reading the
schema; the two request documents below were added that way, and
`CONFORMANT_FIXTURES` at the foot of this module is walked by test_tmdd_decode
so no response fixture can be added without being proved too.

The four fixture modules layer, and the order is what keeps them acyclic:
tmdd_fixture_parts holds the primitives and imports nothing of ours,
tmdd_event_fixtures holds the event documents, this module holds the DMS ones
and re-exports the events so `CONFORMANT_FIXTURES` can cover both, and
tmdd_malformed_fixtures derives the deliberately invalid documents from these.
"""

from tests.query_runner.tmdd_event_fixtures import (
    CONTENT_IN_BOTH_DETAILS,
    EVENT_WITH_EVERY_OPTIONAL_BLOCK_ABSENT,
)
from tests.query_runner.tmdd_fixture_parts import (
    ORG as _ORG,
)
from tests.query_runner.tmdd_fixture_parts import (
    TIME_1500 as _TIME_1500,
)
from tests.query_runner.tmdd_fixture_parts import (
    TIME_1530 as _TIME_1530,
)
from tests.query_runner.tmdd_fixture_parts import (
    message as _message,
)

KNOWN_GOOD_DMS_INVENTORY_REQUEST = '<tmdd:deviceInformationRequestMsg xmlns:tmdd="http://www.tmdd.org/303/messages"><organization-information><organization-id>ORG-1</organization-id></organization-information><device-type>dynamic message sign</device-type><device-information-type>device inventory</device-information-type></tmdd:deviceInformationRequestMsg>'

KNOWN_GOOD_EVENTS_REQUEST = '<tmdd:eventRequestMsg xmlns:tmdd="http://www.tmdd.org/303/messages"><request-header><organization-information><organization-id>O</organization-id></organization-information><message-type-id>1</message-type-id><message-type-version>1</message-type-version><message-time-stamp><date>20260807</date><time>153000</time></message-time-stamp></request-header><request-type><request-focus>all current events</request-focus></request-type></tmdd:eventRequestMsg>'


# --- dms_inventory -------------------------------------------------------
#
# DeviceInventoryHeader's sequence order is load-bearing: organization-
# information, device-id, device-location, device-name, ..., link-name,
# link-direction, ..., route-designator. `dms-sign-type` is mandatory on
# DMSInventory and is sign hardware technology, NOT the device type.

_FULL_DEVICE = (
    "<dms-inventory-item><device-inventory-header>"
    f"{_ORG}"
    "<device-id>DMS-001</device-id>"
    "<device-location><latitude>47606200</latitude><longitude>-122332100</longitude></device-location>"
    "<device-name>I-5 NB MP 165</device-name>"
    "<link-name>Interstate 5 northbound</link-name>"
    "<link-direction>n</link-direction>"
    "<route-designator>I-5</route-designator>"
    "</device-inventory-header><dms-sign-type>vmsFull</dms-sign-type></dms-inventory-item>"
)

# Only the mandatory fields: no link-name, no link-direction, no
# route-designator. Placed FIRST in SPARSE_FIRST_RECORD, which is the shape
# that makes a column set inferred from record one too narrow for record two.
_MINIMAL_DEVICE = (
    "<dms-inventory-item><device-inventory-header>"
    f"{_ORG}"
    "<device-id>DMS-002</device-id>"
    "<device-location><latitude>47500000</latitude><longitude>-122300000</longitude></device-location>"
    "<device-name>SR-520 EB MP 3</device-name>"
    "</device-inventory-header><dms-sign-type>vmsChar</dms-sign-type></dms-inventory-item>"
)

_LINK_NAME_ONLY_DEVICE = (
    "<dms-inventory-item><device-inventory-header>"
    f"{_ORG}"
    "<device-id>DMS-003</device-id>"
    "<device-location><latitude>47000000</latitude><longitude>-122000000</longitude></device-location>"
    "<device-name>SR-167 SB MP 20</device-name>"
    "<link-name>State Route 167</link-name>"
    "</device-inventory-header><dms-sign-type>vmsLine</dms-sign-type></dms-inventory-item>"
)

ONE_DEVICE_AT_KNOWN_COORDS = _message("dMSInventoryMsg", _FULL_DEVICE)

# The same document. _FULL_DEVICE carries route-designator AND link-name, so
# it proves the precedence between them as well as the coordinate conversion,
# and a second near-identical constant would only be a second thing to keep
# in step with the first.
DEVICE_WITH_ROUTE_DESIGNATOR = ONE_DEVICE_AT_KNOWN_COORDS

DEVICE_WITH_ONLY_LINK_NAME = _message("dMSInventoryMsg", _LINK_NAME_ONLY_DEVICE)

SPARSE_FIRST_RECORD = _message("dMSInventoryMsg", _MINIMAL_DEVICE + _FULL_DEVICE)

# Eleven devices, identical apart from the id, for the record-count limits.
# The count is not special: it is one over the max_records value the limit
# tests configure. SPARSE_FIRST_RECORD already proves two dms-inventory-item
# repeats validate, so eleven is the same shape rather than a new one.
ELEVEN_DEVICES = _message(
    "dMSInventoryMsg",
    "".join(_FULL_DEVICE.replace("DMS-001", f"DMS-{number:03d}") for number in range(1, 12)),
)

# --- dms_status ----------------------------------------------------------

_LAST_COMM_TIME = f"<last-comm-time>{_TIME_1530}</last-comm-time>"


def _dms_status_item(device_status, extra_header="", current_message="ROAD WORK[nl]AHEAD", device_id="DMS-001"):
    """One dms-status-item. `current_message=None` leaves the element out.

    The element is optional in DMSStatus, so absent, present-and-empty and
    present-with-content are three different documents a center can send, and
    the decoder has to tell them apart.
    """
    message = "" if current_message is None else f"<current-message>{current_message}</current-message>"
    return (
        "<dms-status-item><device-status-header>"
        f"{_ORG}<device-id>{device_id}</device-id><device-status>{device_status}</device-status>{extra_header}"
        "</device-status-header>"
        f"{message}"
        "<message-beacon>1</message-beacon></dms-status-item>"
    )


# Both forms are legal for the same field: Device-operational-status is a
# union of the integers 1 to 8 and 8 strings, and the schema asserts no
# mapping between them (matrix 3).
OPER_STATUS_AS_INTEGER = _message("dMSStatusMsg", _dms_status_item("3"))
OPER_STATUS_AS_STRING = _message("dMSStatusMsg", _dms_status_item("out of service"))
WITH_LAST_COMM_TIME = _message("dMSStatusMsg", _dms_status_item("on", _LAST_COMM_TIME))

# current-message is an unrestricted string that can carry NTCIP MULTI, where
# whitespace is significant, so these three documents are three different
# answers and not one answer written three ways: a sign showing a padded
# message, a sign that is legitimately BLANK, and a center that did not report
# the element at all. The device-id is padded in the same document on purpose:
# it proves the message keeps its whitespace because it got a reader of its
# own, not because the shared scalar reader stopped trimming for every column.
PADDED_MESSAGE_AND_PADDED_DEVICE_ID = _message(
    "dMSStatusMsg",
    _dms_status_item("on", current_message="  [jl3]  KEEP RIGHT  ", device_id="  DMS-001  "),
)
BLANK_CURRENT_MESSAGE = _message("dMSStatusMsg", _dms_status_item("on", current_message=""))
# The third case, a center that omits the element, is schema-INVALID: proved
# against the published XSD, `current-message` is mandatory in DMSStatus and
# leaving it out fails with "Unexpected child with tag 'message-beacon' at
# position 2". It lives in tmdd_malformed_fixtures for that reason, and the
# decoder still has to survive it.

# Two signs whose last-comm-time is half an hour apart, so a `since` filter
# has one record to keep and one to drop. The second is the first with its
# device-id changed, which is the only field that has to differ.
TWO_SIGNS_HALF_AN_HOUR_APART = _message(
    "dMSStatusMsg",
    _dms_status_item("on", f"<last-comm-time>{_TIME_1500}</last-comm-time>")
    + _dms_status_item("on", _LAST_COMM_TIME).replace("DMS-001", "DMS-002"),
)

# Every fixture in here is walked by test_tmdd_decode and handed to the real
# published XSD. Adding a response fixture without adding it here means it was
# never proved against anything but our own parser. The deliberately
# malformed documents live in tmdd_malformed_fixtures, which imports this
# module and must never appear below.
CONFORMANT_FIXTURES = {
    "KNOWN_GOOD_DMS_INVENTORY_REQUEST": (KNOWN_GOOD_DMS_INVENTORY_REQUEST, "deviceInformationRequestMsg"),
    "KNOWN_GOOD_EVENTS_REQUEST": (KNOWN_GOOD_EVENTS_REQUEST, "eventRequestMsg"),
    "ONE_DEVICE_AT_KNOWN_COORDS": (ONE_DEVICE_AT_KNOWN_COORDS, "dMSInventoryMsg"),
    "DEVICE_WITH_ONLY_LINK_NAME": (DEVICE_WITH_ONLY_LINK_NAME, "dMSInventoryMsg"),
    "SPARSE_FIRST_RECORD": (SPARSE_FIRST_RECORD, "dMSInventoryMsg"),
    "ELEVEN_DEVICES": (ELEVEN_DEVICES, "dMSInventoryMsg"),
    "TWO_SIGNS_HALF_AN_HOUR_APART": (TWO_SIGNS_HALF_AN_HOUR_APART, "dMSStatusMsg"),
    "OPER_STATUS_AS_INTEGER": (OPER_STATUS_AS_INTEGER, "dMSStatusMsg"),
    "OPER_STATUS_AS_STRING": (OPER_STATUS_AS_STRING, "dMSStatusMsg"),
    "WITH_LAST_COMM_TIME": (WITH_LAST_COMM_TIME, "dMSStatusMsg"),
    "PADDED_MESSAGE_AND_PADDED_DEVICE_ID": (PADDED_MESSAGE_AND_PADDED_DEVICE_ID, "dMSStatusMsg"),
    "BLANK_CURRENT_MESSAGE": (BLANK_CURRENT_MESSAGE, "dMSStatusMsg"),
    "CONTENT_IN_BOTH_DETAILS": (CONTENT_IN_BOTH_DETAILS, "fEUMsg"),
    "EVENT_WITH_EVERY_OPTIONAL_BLOCK_ABSENT": (EVENT_WITH_EVERY_OPTIONAL_BLOCK_ABSENT, "fEUMsg"),
}

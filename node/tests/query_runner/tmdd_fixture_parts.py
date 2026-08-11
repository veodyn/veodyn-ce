"""
The pieces every TMDD fixture document is assembled from.

The bottom of a three-layer split forced by the repo's 300-line limit, and
the layering is what keeps it acyclic: this module imports nothing of ours,
`tmdd_event_fixtures` imports it, `tmdd_fixtures` imports both, and
`tmdd_malformed_fixtures` imports `tmdd_fixtures`. Putting these primitives
in `tmdd_fixtures` instead is the obvious arrangement and the one that
cannot work, because the events module needs them and that module's
documents have to be listed in `CONFORMANT_FIXTURES`.

Note the namespace form. TMDD declares elementFormDefault="unqualified", so
a document has a PREFIXED root and BARE children. The same document written
with a default `xmlns` on the root parses identically and is schema-invalid,
which is why the conformance harness exists.

Nothing here was recorded from a live center. Every value is synthetic, and
the identifiers and road names are invented.
"""

TMDD_NS = "http://www.tmdd.org/303/messages"

# `OrganizationInformation` is mandatory in both DeviceInventoryHeader and
# DeviceStatusHeader, and `organization-id` is its only required child.
ORG = "<organization-information><organization-id>WSDOT</organization-id></organization-information>"

# A DateTimeZone is three sibling elements, not an ISO string (matrix 6.4).
# `offset` is the optional fixed-length-5 token. Five distinct times, and
# they are distinct on purpose: two competing paths carrying the same value
# is how a decoded column can regress to the wrong one with the suite green.
TIME_1430 = "<date>20260807</date><time>143000</time><offset>+0000</offset>"
TIME_1500 = "<date>20260807</date><time>150000</time><offset>+0000</offset>"
TIME_1515 = "<date>20260807</date><time>151500</time><offset>+0000</offset>"
TIME_1530 = "<date>20260807</date><time>153000</time><offset>+0000</offset>"
TIME_1545 = "<date>20260807</date><time>154500</time><offset>+0000</offset>"


def message(root_local_name, body, namespace=TMDD_NS):
    """A response document: PREFIXED root, BARE children (matrix 2.3)."""
    return f'<tmdd:{root_local_name} xmlns:tmdd="{namespace}">{body}</tmdd:{root_local_name}>'

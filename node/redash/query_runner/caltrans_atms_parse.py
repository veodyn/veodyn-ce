"""
Text parsers for the `caltrans_atms` runner's two upstream feeds.

Split from `caltrans_atms.py` for the repo's 300-line limit. Nothing here
makes a network call or knows about the connector's resource/column
contract; that lives in `caltrans_atms.py` and `caltrans_atms_rows.py`.
"""

import logging
import re

logger = logging.getLogger(__name__)

# Matches a combined "<route> <direction>" token, e.g. "5 N", "134 W".
# Direction is always a single letter in this feed. Verified against a live
# District 7 webinit.txt fetch (2,135/2,135 VDS rows, 2026-09-23): the
# route+direction token is ALWAYS combined this way, never as two separate
# whitespace-delimited tokens.
ROUTE_DIRECTION_RE = re.compile(r"^(\d+) ([A-Z])$")

# Matches an "<id> <name...>" token where the id and the first word of the
# name are separated by a single space (so the `{2,}`-space split below kept
# them together). Verified against the same live fetch: this is the common
# shape, 2,125/2,135 rows.
ID_NAME_RE = re.compile(r"^(\d+) (.+)$")


def parse_webinit(text):
    """
    Parse `webinit.txt` into VDS station dicts. CMS and shield rows, also
    present in this feed, are skipped: they duplicate sign-inventory ground
    the `tmdd`/`ntcip_dms` connectors already cover, and shields are
    cartographic decoration, not sensor data (Decision 5 of the design
    spec).

    The line is split on runs of 2+ spaces, then the "<route> <direction>"
    token is located by pattern rather than by a fixed column index,
    because its position varies: in 2,125 of 2,135 real District 7 rows the
    id and station name merge into one token ahead of it (a single space
    between them survives the {2,}-space split), and in the remaining 10 the
    id and name are their own separate tokens, shifting everything after
    them right by one. Locating the route/direction token first and reading
    postmile/x/y/lon/lat as fixed offsets AFTER it, and the id/name as
    whatever sits BEFORE it, handles both shapes without guessing which one
    a row is from token count alone — the defect a naive `len(parts) >= N`
    check has, per the design spec's warning against the prior `riits_tiles`
    experiment's earlier, naive `len(parts) >= 10` version (which its own
    iteration history shows was replaced because it mis-split real rows;
    this offset-from-the-anchor approach was verified instead, directly
    against a live fetch, because that prior experiment was never run to
    completion and its own combined-vs-separate assumptions do not hold
    against real District 7 data either — see the implementation notes).

    A line that fails to parse is skipped and logged, not raised: one bad
    row must not fail every station in the feed.
    """
    stations = []
    for line in text.splitlines():
        parts = re.split(r" {2,}", line.strip())
        if not parts or parts[0].strip() != "VDS":
            continue

        route_dir_index = next((i for i, p in enumerate(parts) if ROUTE_DIRECTION_RE.match(p)), None)
        # Needs at least one token naming the station before the anchor, and
        # postmile/x/y/lon/lat (5 tokens) after it.
        if route_dir_index is None or route_dir_index < 1 or len(parts) < route_dir_index + 6:
            logger.warning("caltrans_atms: skipping unparseable webinit row: %r", line)
            continue

        route, direction = ROUTE_DIRECTION_RE.match(parts[route_dir_index]).groups()

        # The id and the name's first word are usually one token (a single
        # space survives the {2,}-space split); a name that itself contains
        # a run of 2+ spaces (e.g. "SAN  GABRIEL") breaks off its own extra
        # token(s) here too, so name_parts can run longer than 1 or 2 and is
        # rejoined with single spaces rather than assumed to be exactly one
        # shape. All three shapes were observed in the live verification
        # fetch (see the module docstring).
        name_parts = parts[1:route_dir_index]
        id_match = ID_NAME_RE.match(name_parts[0]) if name_parts else None
        if id_match:
            vds_id, first_word = id_match.groups()
            name = " ".join([first_word, *name_parts[1:]])
        elif name_parts and name_parts[0].isdigit() and len(name_parts) >= 2:
            vds_id, name = name_parts[0], " ".join(name_parts[1:])
        else:
            logger.warning("caltrans_atms: skipping unparseable webinit row (id/name): %r", line)
            continue

        try:
            postmile = float(parts[route_dir_index + 1])
            # parts[route_dir_index + 2 : + 4] are the State Plane x/y
            # coordinates; unused here, lon/lat cover mapping.
            lon = float(parts[route_dir_index + 4])
            lat = float(parts[route_dir_index + 5])
        except ValueError:
            logger.warning("caltrans_atms: skipping unparseable webinit row (fields): %r", line)
            continue

        stations.append(
            {
                "vds_id": vds_id,
                "name": name,
                "route": route,
                "direction": direction,
                "postmile": postmile,
                "lon": lon,
                "lat": lat,
            }
        )
    return stations


def parse_webupdate(text):
    """
    Parse `webupdate.txt` into raw VDS reading dicts. Whitespace/quote
    tokenized (`re.findall(r'"[^"]*"|\\S+', line)`, since CMS rows on the
    same feed carry quoted message text); CMS rows are skipped. Verified
    against a live District 7 fetch: every one of 2,135 VDS rows is exactly
    `VDS <id> <color_code> <speed> <volume> <good_lanes>`, 6 tokens. A line
    that fails to parse is skipped and logged, not raised.
    """
    readings = []
    for line in text.splitlines():
        parts = re.findall(r'"[^"]*"|\S+', line.strip())
        if not parts or parts[0] != "VDS":
            continue
        if len(parts) < 6:
            logger.warning("caltrans_atms: skipping unparseable webupdate row: %r", line)
            continue
        readings.append(
            {
                "vds_id": parts[1],
                "color_code": parts[2],
                "speed": parts[3],
                "volume": parts[4],
                "good_lanes": parts[5],
            }
        )
    return readings

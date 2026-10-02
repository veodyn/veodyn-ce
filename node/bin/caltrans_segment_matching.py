"""Route/postmile/distance matching for build_caltrans_segment_geometry.py.

Split out to keep the main script under the repo's 300-line limit. Nothing
here writes output or knows about stations pairing; it answers one question,
"which SHN Lines features genuinely belong to this route, direction,
postmile range and location", for the main script to sort and concatenate.
"""

import json
import math
from collections import defaultdict

PROPERTY_ALIASES = {
    "route": ("route", "Route", "ROUTE", "RouteS", "RTE", "Route_ID"),
    "direction": ("direction", "Direction", "DIRECTION", "Dir", "DIR"),
    "begin_postmile": ("begin_postmile", "BeginPostmile", "BEGIN_PM", "BPostmile", "BPM", "PMBegin"),
    "end_postmile": ("end_postmile", "EndPostmile", "END_PM", "EPostmile", "EPM", "PMEnd"),
}

# What this rejects is a route whose postmile numbering is not unique along
# its whole length (a county-line reset, or a realignment carrying its own
# PMPrefix: see PROPERTY_ALIASES above, which does not include it): route +
# direction + postmile alone matched a Ventura-area SHN segment to two
# Thousand-Oaks stations 0.03 postmile apart, and the concatenation jumped
# 90km to a same-numbered stretch near downtown LA before returning.
# Grounding the match in the stations' own real coordinates, which
# postmile-range overlap never checks, is what catches it.
#
# Not a tight radius. Measured against the full live District 7 fetch, the
# distance from a station pair's midpoint to its best-matching SHN segment has
# no clean gap between "real match" and "wrong match", it is a smooth curve
# from 0 out past 100km, because webinit.txt's own lon/lat fields are rounded
# to two decimal places (roughly a football field to a kilometer, depending on
# latitude) and a handful of stations carry outright wrong coordinates (one
# pair named for Lincoln/Culver, real Marina del Rey cross streets, reported
# 60km away in the Inland Empire). 5km rejected legitimate pairs that were
# merely on the far side of that rounding noise; 10km keeps those while still
# rejecting every observed case in the tens-of-km-and-up range, which is where
# the genuine postmile collisions and bad-coordinate rows live. A pair whose
# only candidate is still further than this is skipped, not guessed at: an
# honest gap in the map is preferable to a line that does not follow the road.
MAX_SEGMENT_DISTANCE_KM = 10.0


def _prop(feature, key):
    props = feature.get("properties") or {}
    for alias in PROPERTY_ALIASES[key]:
        if alias in props and props[alias] not in (None, ""):
            return props[alias]
    return None


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _line_coordinates(geometry):
    gtype = geometry.get("type")
    if gtype == "LineString":
        return geometry.get("coordinates") or []
    if gtype == "MultiLineString":
        coords = []
        for part in geometry.get("coordinates") or []:
            coords.extend(part)
        return coords
    return []


def normalize_route(value):
    """
    "5", "005" and 5 must all key to the same route, so a zero-padded (or
    otherwise differently-typed) GIS route id still matches the plain
    integer-as-string route webinit.txt uses. Falls back to a stripped
    string for a route id that isn't purely numeric (rare, but silently
    dropping every pair on such a route into `skipped` would be worse).
    """
    try:
        return str(int(value))
    except (TypeError, ValueError):
        return str(value).strip()


def index_shn_lines(path):
    """route (normalized string) -> [{"lo", "hi", "direction", "coords"}, ...]."""
    with open(path) as fh:
        features = (json.load(fh) or {}).get("features", [])

    index = defaultdict(list)
    for feature in features:
        route = _prop(feature, "route")
        begin = _to_float(_prop(feature, "begin_postmile"))
        end = _to_float(_prop(feature, "end_postmile"))
        coords = _line_coordinates(feature.get("geometry") or {})
        if route is None or begin is None or end is None or not coords:
            continue
        lo, hi = (begin, end) if begin <= end else (end, begin)
        index[normalize_route(route)].append(
            {"lo": lo, "hi": hi, "direction": _prop(feature, "direction"), "coords": coords}
        )
    return index


def haversine_km(a, b):
    """Great-circle distance in km between two [lon, lat] points."""
    lon1, lat1 = a[0], a[1]
    lon2, lat2 = b[0], b[1]
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    x = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def _near_pair(coords, midpoint):
    return any(haversine_km(point, midpoint) <= MAX_SEGMENT_DISTANCE_KM for point in coords)


# Adjacent pre-cut SHN segments are not topologically snapped, so a genuine
# join can be several km wide on its own, measured against the full live
# District 7 build, a legitimate pair spanning a long rural stretch (Route 14
# through the Antelope Valley, postmile 43 to 58) has a 12.8km internal gap
# and is real. What this catches sits well past that: two segments that both
# individually passed the midpoint check above (each is within
# MAX_SEGMENT_DISTANCE_KM of the pair SOMEWHERE along its own length) but are
# not actually adjacent. Route 101 southbound has exactly this, two
# overlapping, non-prefixed postmile ranges (0-22.88 and 17.641-38.19) that
# read as two independent LRS logs for the same route/direction, so a pair
# near postmile 17.6 can pick up one huge segment from each log, each close
# enough at its own postmile-17.6 end, and the concatenation jumps 35km at
# the join, the next value up from that legitimate 12.8km case, with nothing
# in between in the data actually fetched.
MAX_INTERNAL_GAP_KM = 15.0


def has_continuity_break(coords):
    return any(haversine_km(coords[i], coords[i + 1]) > MAX_INTERNAL_GAP_KM for i in range(len(coords) - 1))


def select_shn_segments(shn_by_route, route, direction, lo, hi, midpoint):
    selected = [
        seg
        for seg in shn_by_route.get(normalize_route(route), [])
        if (seg["direction"] is None or seg["direction"] == direction)
        and not (seg["hi"] < lo or seg["lo"] > hi)
        and _near_pair(seg["coords"], midpoint)
    ]
    selected.sort(key=lambda seg: seg["lo"])
    return selected


def direction_coverage(shn_by_route):
    """(segments carrying a direction, total segments) across the whole index."""
    segments = [seg for segs in shn_by_route.values() for seg in segs]
    return sum(1 for seg in segments if seg["direction"] is not None), len(segments)

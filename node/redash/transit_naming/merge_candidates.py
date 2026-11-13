import math
import re
from collections import defaultdict

from redash.transit_naming.coordinates import (
    EARTH_RADIUS_M,
    finite_point,
    meters_between,
)
from redash.transit_naming.locations import stop_511_id

DIFFERENT_511_ID = "different_511_id"
MISSING_511_ID = "missing_511_id"
DEFAULT_WITHIN_M = 15.0
MAX_WITHIN_M = 50.0
METERS_PER_DEGREE = EARTH_RADIUS_M * math.pi / 180
STREET_JOIN = re.compile(r"\s*[/&@]\s*")
WHITESPACE = re.compile(r"\s+")
MERGE_CANDIDATE_COLUMNS = (
    "carrier_a",
    "stop_id_a",
    "511_id_a",
    "public_name_a",
    "direction_a",
    "carrier_b",
    "stop_id_b",
    "511_id_b",
    "public_name_b",
    "direction_b",
    "separation_m",
    "reason",
    "normalization_revision",
)


def _text(value):
    return WHITESPACE.sub(" ", str(value or "")).strip().lower()


def _place(stop):
    on_street, cross_street = _text(stop.get("on_street")), _text(stop.get("cross_street"))
    if on_street and cross_street and on_street != cross_street:
        return frozenset((on_street, cross_street))
    parts = [_text(part) for part in STREET_JOIN.split(str(stop.get("public_name") or ""))]
    if len(parts) == 2 and all(parts) and parts[0] != parts[1]:
        return frozenset(parts)
    return _text(stop.get("public_name")) or None


def _within_m(params):
    raw = params.get("within_m")
    if raw in (None, ""):
        return DEFAULT_WITHIN_M
    value = float(raw)
    if not math.isfinite(value) or value <= 0:
        raise ValueError("within_m must be a positive number of meters")
    return min(value, MAX_WITHIN_M)


def _faces_another_way(a, b):
    direction_a, direction_b = _text(a.get("direction")), _text(b.get("direction"))
    return bool(direction_a and direction_b and direction_a != direction_b)


def _key(stop):
    return str(stop.get("carrier_code") or ""), str(stop.get("stop_id") or "")


def _candidates(stops):
    found = []
    for stop in stops:
        point = finite_point(stop, "lat", "lng")
        place = _place(stop)
        if point is not None and place is not None and not stop.get("retired"):
            found.append((stop, _key(stop), stop_511_id(stop), point, place))
    return found


def _cell(point, step):
    return math.floor(point[0] / step), math.floor(point[1] / step)


def _neighbours(candidates, within_m):
    step = within_m / METERS_PER_DEGREE
    cells = defaultdict(list)
    for entry in candidates:
        cells[_cell(entry[3], step)].append(entry)
    for entry in candidates:
        row, column = _cell(entry[3], step)
        reach = math.floor(1 / max(math.cos(math.radians(entry[3][0])), 0.01)) + 1
        for d_row in (-1, 0, 1):
            for d_column in range(-reach, reach + 1):
                for other in cells.get((row + d_row, column + d_column), ()):
                    if entry[1] < other[1]:
                        yield entry, other


def _row(a, b, separation):
    (first, first_key, first_id, _, _), (second, second_key, second_id, _, _) = a, b
    return {
        "carrier_a": first_key[0],
        "stop_id_a": first_key[1],
        "511_id_a": first_id,
        "public_name_a": first.get("public_name"),
        "direction_a": first.get("direction") or None,
        "carrier_b": second_key[0],
        "stop_id_b": second_key[1],
        "511_id_b": second_id,
        "public_name_b": second.get("public_name"),
        "direction_b": second.get("direction") or None,
        "separation_m": round(separation, 1),
        "reason": DIFFERENT_511_ID if first_id and second_id else MISSING_511_ID,
        "normalization_revision": first.get("normalization_revision") or second.get("normalization_revision") or "",
    }


def _proposed(a, b, wanted):
    (stop_a, key_a, id_a, _, place_a), (stop_b, key_b, id_b, _, place_b) = a, b
    if key_a[0] == key_b[0] or place_a != place_b:
        return False
    if wanted and wanted not in (key_a[0], key_b[0]):
        return False
    return not (id_a and id_a == id_b) and not _faces_another_way(stop_a, stop_b)


def merge_candidate_rows(stops, params):
    within_m = _within_m(params)
    wanted = str(params.get("carrier_code") or "").strip()
    rows = {}
    for a, b in _neighbours(_candidates(stops), within_m):
        if not _proposed(a, b, wanted):
            continue
        separation = meters_between(*a[3], *b[3])
        if separation <= within_m:
            rows[(a[1], b[1])] = _row(a, b, separation)
    return [rows[key] for key in sorted(rows)]

import json
from collections import defaultdict
from math import cos, floor, hypot, isfinite, radians

from redash.transit_naming.profiles import ProfileError
from redash.transit_naming.stops import normalize_part
from redash.transit_naming.suffixes import STREET_REFERENCE, Decision, classify

LEADING_DIRECTIONS = frozenset({"north", "south", "east", "west", "n", "s", "e", "w"})
METERS_PER_DEGREE = 111_320
CELL_DEGREES = 0.002


def _coordinate(value):
    if not isinstance(value, list) or len(value) != 2:
        return None
    if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not isfinite(n) for n in value):
        return None
    lng, lat = float(value[0]), float(value[1])
    return (lng, lat) if -180 <= lng <= 180 and -90 <= lat <= 90 else None


def _street(item):
    if not isinstance(item, list) or len(item) != 2:
        return None
    name, line = item
    if not isinstance(name, str) or not name.strip() or not isinstance(line, list) or len(line) < 2:
        return None
    points = [_coordinate(value) for value in line]
    return None if None in points else (name.strip(), tuple(points))


def parse_streets_json(text, carrier, file):
    try:
        items = json.loads(text)["streets"]
    except (ValueError, KeyError, TypeError) as error:
        raise ProfileError(f"street reference is not a streets document: {error}", carrier, file) from error
    if not isinstance(items, list):
        raise ProfileError("street reference streets must be a list", carrier, file)
    streets = []
    for position, item in enumerate(items):
        street = _street(item)
        if street is None:
            message = f"street {position} must be a non-empty name and two or more [lng, lat] points"
            raise ProfileError(message, carrier, file)
        streets.append(street)
    return tuple(streets)


def _named(name, rules):
    words = name.split()
    spellings = [words]
    if len(words) > 2 and words[0].lower() in LEADING_DIRECTIONS:
        spellings.append(words[1:])
    named = set()
    for spelling in spellings:
        kind, base, suffix = classify(normalize_part(" ".join(spelling), rules), rules)
        if kind == "suffixed":
            named.add((base, suffix))
    return named


def _cells(west, south, east, north):
    for x in range(floor(west / CELL_DEGREES), floor(east / CELL_DEGREES) + 1):
        for y in range(floor(south / CELL_DEGREES), floor(north / CELL_DEGREES) + 1):
            yield x, y


def _meters_to_segment(lat, lng, start, end):
    scale_x = METERS_PER_DEGREE * cos(radians(lat))
    ax, ay = (start[0] - lng) * scale_x, (start[1] - lat) * METERS_PER_DEGREE
    bx, by = (end[0] - lng) * scale_x, (end[1] - lat) * METERS_PER_DEGREE
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    t = 0.0 if length == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / length))
    return hypot(ax + t * dx, ay + t * dy)


class StreetIndex:
    def __init__(self, streets, rules):
        self.cells = defaultdict(list)
        for name, line in streets:
            for base, suffix in _named(name, rules):
                for start, end in zip(line, line[1:]):
                    bounds = (
                        min(start[0], end[0]),
                        min(start[1], end[1]),
                        max(start[0], end[0]),
                        max(start[1], end[1]),
                    )
                    for cell in _cells(*bounds):
                        self.cells[cell].append((base, suffix, start, end))

    def decide(self, base, lat, lng, within_m):
        lat_reach = within_m / METERS_PER_DEGREE
        lng_reach = lat_reach / max(cos(radians(lat)), 0.01)
        suffixes = set()
        for cell in _cells(lng - lng_reach, lat - lat_reach, lng + lng_reach, lat + lat_reach):
            for member, suffix, start, end in self.cells.get(cell, ()):
                if member == base and _meters_to_segment(lat, lng, start, end) <= within_m:
                    suffixes.add(suffix)
        if len(suffixes) == 1:
            return Decision(next(iter(suffixes)), STREET_REFERENCE)
        return Decision(abstained="street_reference_conflict" if suffixes else "no_street")

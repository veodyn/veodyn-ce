import json
import math

from redash.transit_naming.headsigns import normalize_headsign
from redash.transit_naming.patterns import (
    _pattern_ids,
    _sequences,
    _trip_attributes,
    canonical_keys,
    direction_number,
    most_common_smallest,
)

SIMPLIFY_TOLERANCE_DEGREES = 0.00005
PATH_COLUMNS = (
    "carrier_code",
    "route_code",
    "pattern_id",
    "is_canonical",
    "direction_id",
    "direction",
    "headsign",
    "shape_id",
    "trip_count",
    "point_count",
    "geometry",
    "gtfs_digest",
)


def _deviation(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    along = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length_squared
    along = max(0.0, min(1.0, along))
    return math.hypot(point[0] - (start[0] + along * dx), point[1] - (start[1] + along * dy))


def simplify(points, tolerance=SIMPLIFY_TOLERANCE_DEGREES):
    if len(points) <= 2:
        return list(points)
    keep = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    while pending:
        first, last = pending.pop()
        farthest, index = 0.0, None
        for i in range(first + 1, last):
            distance = _deviation(points[i], points[first], points[last])
            if distance > farthest:
                farthest, index = distance, i
        if index is not None and farthest > tolerance:
            keep.add(index)
            pending.extend([(first, index), (index, last)])
    return [points[i] for i in sorted(keep)]


def _simplified(shape):
    if not shape or len(shape) < 2:
        return None
    return simplify([(lon, lat) for _, lat, lon in shape])


def path_rows(carrier_code, route_code, gtfs_route_id, snapshot, profile, digest):
    sequences = _sequences(snapshot, gtfs_route_id)
    ids = _pattern_ids(sequences)
    canonical_patterns = canonical_keys(snapshot, gtfs_route_id, sequences)
    attributes = _trip_attributes(snapshot, gtfs_route_id)
    rows = []
    for key, pattern_id in sorted(ids.items()):
        direction_id, stops = key
        shapes, headsigns, trips = attributes[key]
        shape_id = most_common_smallest(shapes)
        points = _simplified(snapshot.shapes.get(shape_id)) if shape_id else None
        rows.append(
            {
                "carrier_code": carrier_code,
                "route_code": route_code,
                "pattern_id": pattern_id,
                "is_canonical": key in canonical_patterns,
                "direction_id": direction_number(direction_id),
                "direction": profile.direction_letter(route_code, direction_id),
                "headsign": normalize_headsign(most_common_smallest(headsigns), profile.headsign),
                "shape_id": shape_id,
                "trip_count": len(trips),
                "point_count": len(points) if points else 0,
                "geometry": (
                    json.dumps({"type": "LineString", "coordinates": [list(p) for p in points]}) if points else None
                ),
                "gtfs_digest": digest,
            }
        )
    return rows

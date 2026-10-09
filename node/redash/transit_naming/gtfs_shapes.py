import json
import math

from redash.transit_naming.patterns import (
    _canonical,
    _pattern_ids,
    _sequences,
    _trip_attributes,
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
    length = math.hypot(dx, dy)
    if length == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    return abs(dx * (start[1] - point[1]) - (start[0] - point[0]) * dy) / length


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
    longest = _canonical(sequences)
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
                "is_canonical": stops == longest[direction_id],
                "direction_id": direction_number(direction_id),
                "direction": profile.direction_letter(route_code, direction_id),
                "headsign": most_common_smallest(headsigns) or "",
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

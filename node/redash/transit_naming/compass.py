import math

from redash.transit_naming.coordinates import finite_point

MAP = "map"
GEOMETRY = "geometry"
DIRECTION_SOURCES = (MAP, GEOMETRY)
OPPOSITE = {"N": "S", "S": "N", "E": "W", "W": "E"}
TRAVEL_SIGN = {"0": 1.0, "1": -1.0}


def _travel(snapshot, trip):
    stop_times = snapshot.stop_times_by_trip.get(trip["trip_id"], [])
    if len(stop_times) < 2:
        return None
    start = finite_point(snapshot.stops.get(stop_times[0][1], {}), "stop_lat", "stop_lon")
    end = finite_point(snapshot.stops.get(stop_times[-1][1], {}), "stop_lat", "stop_lon")
    if start is None or end is None:
        return None
    return (end[1] - start[1]) * math.cos(math.radians(start[0])), end[0] - start[0]


def route_compass(snapshot, gtfs_route_id):
    east = north = 0.0
    for trip in snapshot.trips:
        sign = TRAVEL_SIGN.get(str(trip.get("direction_id", "")))
        if trip.get("route_id") != gtfs_route_id or sign is None:
            continue
        travel = _travel(snapshot, trip)
        if travel is not None:
            east += sign * travel[0]
            north += sign * travel[1]
    if east == 0 and north == 0:
        return {}
    outbound = ("N" if north > 0 else "S") if abs(north) >= abs(east) else ("E" if east > 0 else "W")
    return {"0": outbound, "1": OPPOSITE[outbound]}


def inferred_directions(profile, snapshot, gtfs_route_id):
    return route_compass(snapshot, gtfs_route_id) if profile.direction_from == GEOMETRY else {}

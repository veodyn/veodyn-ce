import re

TRAILING_LAYOVER = re.compile(r"\blay\s*-?\s*over\s*$", re.IGNORECASE)


def is_layover(*names):
    return any(TRAILING_LAYOVER.search(name or "") for name in names)


def trips_by_pattern(snapshot, gtfs_route_id):
    found = {}
    for trip in snapshot.trips:
        if trip.get("route_id") != gtfs_route_id:
            continue
        times = snapshot.stop_times_by_trip.get(trip["trip_id"], [])
        if times:
            key = (str(trip.get("direction_id", "")), tuple(stop_id for _, stop_id in times))
            found.setdefault(key, []).append((trip["trip_id"], times))
    return found


def _served_by_some_trip(position, trip_times, no_service):
    return any(times[position][0] not in no_service.get(trip_id, ()) for trip_id, times in trip_times)


def passenger_positions(trip_times, no_service, layovers):
    kept = [i for i in range(len(layovers)) if _served_by_some_trip(i, trip_times, no_service)]
    while kept and layovers[kept[0]]:
        kept.pop(0)
    while kept and layovers[kept[-1]]:
        kept.pop()
    return kept

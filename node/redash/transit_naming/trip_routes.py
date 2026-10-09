from redash.transit_naming.patterns import direction_number

TRIP_ROUTE_COLUMNS = ("carrier_code", "trip_id", "route_code", "direction_id", "gtfs_digest")


def _targets(route_code, resolved, profile, snapshots):
    found = set()
    if resolved is not None:
        found.add((resolved.source_name, resolved.gtfs_route_id))
    for gtfs_route_id in profile.extra_trip_routes.get(route_code, ()):
        for source_name, snapshot in snapshots.items():
            if gtfs_route_id in snapshot.routes:
                found.add((source_name, gtfs_route_id))
    return found


def trip_route_rows(carrier_code, resolutions, profile, resolver):
    snapshots = resolver.snapshots()
    route_codes_by_target = {}
    for route_code, resolved in resolutions.items():
        for target in _targets(route_code, resolved, profile, snapshots):
            route_codes_by_target.setdefault(target, []).append(route_code)
    owners = {}
    for source_name, snapshot in snapshots.items():
        for trip in snapshot.trips:
            for route_code in route_codes_by_target.get((source_name, trip.get("route_id")), ()):
                direction = direction_number(str(trip.get("direction_id", "")))
                owners.setdefault(trip["trip_id"], {}).setdefault(route_code, direction)
    digest = resolver.digest
    return [
        {
            "carrier_code": carrier_code,
            "trip_id": trip_id,
            "route_code": route_code,
            "direction_id": direction,
            "gtfs_digest": digest,
        }
        for trip_id, by_route in sorted(owners.items())
        if len(by_route) == 1
        for route_code, direction in by_route.items()
    ]

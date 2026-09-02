import math

from redash.transit_naming import provenance
from redash.transit_naming.snapshot import PatternStop

EARTH_RADIUS_FEET = 20925646.3


def distance_feet(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_FEET * math.asin(math.sqrt(h))


def _coordinates(record, lat_key, lng_key):
    try:
        return float(record.get(lat_key)), float(record.get(lng_key))
    except (TypeError, ValueError):
        return None


def _nearest(gtfs_stop, mca_stops, threshold_feet):
    origin = _coordinates(gtfs_stop, "stop_lat", "stop_lon")
    if origin is None:
        return None
    best, best_distance = None, threshold_feet
    for stop in mca_stops.values():
        target = _coordinates(stop, "lat", "lng")
        if target is None:
            continue
        distance = distance_feet(origin[0], origin[1], target[0], target[1])
        if distance <= best_distance:
            best, best_distance = stop, distance
    return best


def _match(gtfs_stop_id, snapshot, mca_stops, public_names, public_sources, threshold_feet, memo):
    if gtfs_stop_id in memo:
        return memo[gtfs_stop_id]
    if gtfs_stop_id in mca_stops:
        found = (gtfs_stop_id, public_names.get(gtfs_stop_id, ""), "id", public_sources.get(gtfs_stop_id, ""))
    else:
        gtfs_stop = snapshot.stops.get(gtfs_stop_id, {})
        near = _nearest(gtfs_stop, mca_stops, threshold_feet)
        if near is not None:
            near_id = str(near["stop_id"])
            found = (near_id, public_names.get(near_id, ""), "coordinate", public_sources.get(near_id, ""))
        else:
            found = (gtfs_stop_id, gtfs_stop.get("stop_name", ""), "unmatched", provenance.PASSTHROUGH)
    memo[gtfs_stop_id] = found
    return found


def _sequences(snapshot, gtfs_route_id):
    found = {}
    for trip in snapshot.trips:
        if trip.get("route_id") != gtfs_route_id:
            continue
        stops = tuple(stop_id for _, stop_id in snapshot.stop_times_by_trip.get(trip["trip_id"], []))
        if not stops:
            continue
        key = (str(trip.get("direction_id", "")), stops)
        found.setdefault(key, trip.get("shape_id") or trip.get("trip_headsign") or key[0])
    return found


def _pattern_ids(sequences):
    used = {}
    ids = {}
    for key, label in sorted(sequences.items()):
        count = used.get((key[0], label), 0) + 1
        used[(key[0], label)] = count
        ids[key] = label if count == 1 else f"{label}-{count}"
    return ids


def _canonical(sequences):
    best = {}
    for direction_id, stops in sequences:
        current = best.get(direction_id)
        if current is None or (len(stops), [s for s in current]) > (len(current), [s for s in stops]):
            best[direction_id] = stops
    return best


def cut_patterns(
    carrier_code,
    route_code,
    gtfs_route_id,
    snapshot,
    mca_stops,
    public_names,
    profile,
    threshold_feet=130.0,
    public_sources=None,
):
    sequences = _sequences(snapshot, gtfs_route_id)
    ids = _pattern_ids(sequences)
    longest = _canonical(sequences)
    sources = public_sources or {}
    memo = {}
    rows = []
    for (direction_id, stops), pattern_id in sorted(ids.items()):
        letter = profile.direction_letter(route_code, direction_id)
        canonical = stops == longest[direction_id]
        for sequence, gtfs_stop_id in enumerate(stops):
            stop_id, public_name, match, source = _match(
                gtfs_stop_id, snapshot, mca_stops, public_names, sources, threshold_feet, memo
            )
            rows.append(
                PatternStop(
                    carrier_code,
                    route_code,
                    letter,
                    pattern_id,
                    canonical,
                    sequence,
                    stop_id,
                    gtfs_stop_id,
                    public_name,
                    match,
                    "gtfs_stop_times",
                    source,
                )
            )
    return rows


def mca_pattern_membership(carrier_code, route_code, pattern_code, stops, public_names, public_sources=None):
    direction = pattern_code.split(" ")[-1] if " " in pattern_code else ""
    sources = public_sources or {}
    rows = []
    for stop in stops:
        stop_id = str(stop.get("stop_id"))
        rows.append(
            PatternStop(
                carrier_code,
                route_code,
                direction,
                pattern_code,
                True,
                None,
                stop_id,
                "",
                public_names.get(stop_id, stop.get("stop_name", "")),
                "id",
                "mca_pattern",
                sources.get(stop_id, ""),
            )
        )
    return rows


def pattern_row(p, revision, digest):
    return {
        "carrier_code": p.carrier_code,
        "route_code": p.route_code,
        "direction": p.direction,
        "pattern_id": p.pattern_id,
        "is_canonical": p.is_canonical,
        "sequence": p.sequence,
        "stop_id": p.stop_id,
        "gtfs_stop_id": p.gtfs_stop_id,
        "public_name": p.public_name,
        "public_name_source": p.public_name_source,
        "stop_match": p.stop_match,
        "sequence_source": p.sequence_source,
        "normalization_revision": revision,
        "gtfs_digest": digest,
    }

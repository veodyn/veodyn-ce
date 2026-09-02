from redash.query_runner.metrocloudalliance_departures import DEPARTURE_COLUMNS
from redash.transit_naming import provenance
from redash.transit_naming.headsigns import normalize_headsign
from redash.transit_naming.routes import name_route
from redash.transit_naming.stops import name_stop

RENAMED = {"route": "raw_route", "headsign": "raw_headsign", "stop_name": "raw_stop_name"}

PUBLIC_DEPARTURE_COLUMNS = [
    (RENAMED[c.split(":")[0]] + ":" + c.split(":", 1)[1]) if c.split(":")[0] in RENAMED else c
    for c in DEPARTURE_COLUMNS
] + [
    "public_route_name: string - rider-facing route name",
    "public_route_short_name: string - badge text",
    "public_headsign: string - normalized destination sign",
    "public_stop_name: string - rider-facing stop name",
    "public_route_name_source: string - provenance",
    "public_route_short_name_source: string - provenance",
    "public_headsign_source: string - provenance",
    "public_stop_name_source: string - provenance",
    "normalization_revision: string",
    "gtfs_digest: string",
]


def _route_from_raw(raw_route, carrier, profile):
    number = str(raw_route or "")
    route = {
        "carrier_code": carrier,
        "route_code": f"{profile.carrier_code}{number.zfill(3) if number.isdigit() else number}",
        "route_name": number,
    }
    return name_route(route, profile, None)


def enrich_departures(rows, route_names, stop_names, profile, revision, digest):
    out = []
    for row in rows:
        item = {RENAMED.get(key, key): value for key, value in row.items()}
        raw_route = str(item.get("raw_route") or "")
        route = route_names.get(raw_route)
        route_source = route.public_name_source if route else provenance.RULE
        if route is None:
            route = _route_from_raw(raw_route, item.get("carrier"), profile)
        stop_id = str(item.get("stop_id") or "")
        stop = stop_names.get(stop_id)
        stop_source = stop.public_name_source if stop else provenance.RULE
        if stop is None:
            stop = name_stop(
                {
                    "stop_id": stop_id,
                    "stop_name": item.get("raw_stop_name"),
                    "transit_modes": "BUS",
                    "prediction_count": 1,
                },
                profile,
            )
        headsign = normalize_headsign(item.get("raw_headsign"), profile.headsign)
        item.update(
            {
                "public_route_name": route.public_name,
                "public_route_short_name": route.short_name,
                "public_headsign": headsign,
                "public_stop_name": stop.public_name,
                "public_route_name_source": route_source,
                "public_route_short_name_source": route_source,
                "public_headsign_source": provenance.RULE
                if headsign != (item.get("raw_headsign") or "")
                else provenance.PASSTHROUGH,
                "public_stop_name_source": stop_source,
                "normalization_revision": revision,
                "gtfs_digest": digest,
            }
        )
        out.append(item)
    return out

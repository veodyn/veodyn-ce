import re

from redash import settings
from redash.query_runner.metrocloudalliance_departures import flatten_departures
from redash.transit_naming.departures import PUBLIC_DEPARTURE_COLUMNS, enrich_departures
from redash.transit_naming.gtfs_cache import http_fetch
from redash.transit_naming.gtfs_routes import GtfsResolver
from redash.transit_naming.gtfs_shapes import PATH_COLUMNS, path_rows
from redash.transit_naming.locations import (
    LOCATION_COLUMNS,
    location_member_filter,
    location_rows,
)
from redash.transit_naming.override_table import override_table
from redash.transit_naming.patterns import (
    StopIndex,
    cut_patterns,
    mca_pattern_membership,
    pattern_row,
)
from redash.transit_naming.profile_loader import load_profiles, profile_dirs
from redash.transit_naming.routes import name_route, parse_route_number, route_row
from redash.transit_naming.snapshot import PatternStop, RouteName, StopName
from redash.transit_naming.stops import stop_row
from redash.transit_naming.suffixes import CarrierIndexes
from redash.transit_naming.trip_routes import TRIP_ROUTE_COLUMNS, trip_route_rows

archive_fetch = http_fetch
_profile_set = {}


def load_profile_set(reload=False):
    dirs = tuple(profile_dirs())
    if reload or dirs not in _profile_set:
        _profile_set.clear()
        _profile_set[dirs] = load_profiles(dirs)
    return _profile_set[dirs].with_overrides(override_table().current())


def cache_dir():
    return settings.TRANSIT_NAMING_CACHE_DIR


STOP_KEY = re.compile(r"([A-Za-z0-9]{1,8}):([A-Za-z0-9_.\-]{1,40})")


def expand_stop_key(params):
    if "stop" not in params:
        return params
    match = STOP_KEY.fullmatch(str(params["stop"]))
    if match is None:
        raise ValueError('stop must be "<carrier_code>:<stop_id>"')
    expanded = {key: value for key, value in params.items() if key != "stop"}
    expanded["carrier_code"], expanded["stop_id"] = match.groups()
    return expanded


def _carrier(params):
    return str(params.get("carrier_code") or "")


def _profile(profiles, params, records):
    name = next((r.get("carrier_name") for r in records if r.get("carrier_name")), "")
    return profiles.for_carrier(_carrier(params), name)


def _resolver(profile, with_patterns, archive_fetcher=None, with_shapes=False):
    return GtfsResolver(
        profile,
        cache_dir(),
        fetch=archive_fetcher or archive_fetch,
        with_patterns=with_patterns,
        with_shapes=with_shapes,
    )


def _flag(value):
    return value is True or str(value).strip().lower() in ("true", "1", "yes")


def _route_names(routes, profile, resolver, with_resolved=False):
    named = {}
    for route in routes:
        number = parse_route_number(str(route.get("route_code") or ""), profile.carrier_code)
        resolved = resolver.resolve(route["route_code"], number)
        name = name_route(route, profile, resolved)
        named[route["route_code"]] = (route, name, resolved) if with_resolved else (route, name)
    return named


PUBLIC_COLUMN_NAMES = {
    "public_routes": list(route_row({}, RouteName(*[""] * 12), "", "")),
    "public_stops": list(stop_row({}, StopName("", "", "", "", "", "", False, ""), "", "")),
    "public_route_stops": list(pattern_row(PatternStop(*[""] * 11), "", "")),
    "public_route_paths": list(PATH_COLUMNS),
    "public_trip_routes": list(TRIP_ROUTE_COLUMNS),
    "public_departures": [column.split(":")[0] for column in PUBLIC_DEPARTURE_COLUMNS],
    "public_stop_locations": list(LOCATION_COLUMNS),
    "naming_profiles": ["carrier_code", "source_file", "is_default", "gtfs_sources", "overrides", "revision"],
}


def public_routes(params, fetch, profiles, archive_fetcher=None):
    routes = fetch(
        "routes",
        {
            "carrier_code": _carrier(params),
            **({"route_code": params["route_code"]} if params.get("route_code") else {}),
        },
    )
    profile = _profile(profiles, params, routes)
    resolver = _resolver(profile, False, archive_fetcher)
    return [
        route_row(route, name, profiles.revision, resolver.digest)
        for route, name in _route_names(routes, profile, resolver).values()
    ]


def public_stops(params, fetch, profiles, archive_fetcher=None, source=None, keep=None):
    query = {}
    if _carrier(params):
        query["carrier_code"] = _carrier(params)
    if params.get("stop_id"):
        query["stop_id"] = params["stop_id"]
    stops = fetch("stops", query)
    if params.get("stop_id"):

        def load_stops(carrier):
            return fetch("stops", {"carrier_code": carrier})

    else:

        def load_stops(carrier):
            return [s for s in stops if str(s.get("carrier_code") or _carrier(params)) == carrier]

    indexes = CarrierIndexes(profiles.base_revision, source, load_stops, profiles.extra_overrides)
    digests = {}
    rows = []
    for stop in stops if keep is None else filter(keep, stops):
        carrier = str(stop.get("carrier_code") or _carrier(params))
        profile = profiles.for_carrier(carrier)
        if carrier not in digests:
            digests[carrier] = _resolver(profile, False, archive_fetcher).digest
        rows.append(stop_row(stop, indexes.name(stop, profile), profiles.revision, digests[carrier]))
    return rows


def public_route_stops(params, fetch, profiles, archive_fetcher=None, source=None):
    routes = fetch(
        "routes",
        {
            "carrier_code": _carrier(params),
            **({"route_code": params["route_code"]} if params.get("route_code") else {}),
        },
    )
    stops = [s for s in fetch("stops", {"carrier_code": _carrier(params)})]
    profile = _profile(profiles, params, routes)
    resolver = _resolver(profile, True, archive_fetcher)
    indexes = CarrierIndexes(profiles.base_revision, source, lambda carrier: stops, profiles.extra_overrides)
    names = {}
    sources = {}
    live = {}
    for stop in stops:
        named = indexes.name(stop, profile)
        live[str(stop["stop_id"])] = stop
        names[str(stop["stop_id"])] = named.public_name
        sources[str(stop["stop_id"])] = named.public_name_source
    rows = []
    index = StopIndex(live)
    for route_code, (route, name, resolved) in _route_names(routes, profile, resolver, with_resolved=True).items():
        if resolved is not None:
            snapshot = resolver.snapshots()[resolved.source_name]
            patterns = cut_patterns(
                profile.carrier_code,
                route_code,
                name.gtfs_route_id,
                snapshot,
                live,
                names,
                profile,
                public_sources=sources,
                stop_index=index,
            )
        else:
            patterns = []
            for pattern_code in profile.pattern_codes.get(route_code, ()):
                members = fetch("stops", {"carrier_code": _carrier(params), "pattern_code": pattern_code})
                patterns.extend(
                    mca_pattern_membership(
                        profile.carrier_code,
                        route_code,
                        pattern_code,
                        [m for m in members if str(m.get("stop_id")) in live],
                        names,
                        sources,
                    )
                )
        rows.extend(
            pattern_row(p, profiles.revision, resolver.digest)
            for p in patterns
            if p.is_canonical or not _flag(params.get("canonical_only"))
        )
    return rows


def public_route_paths(params, fetch, profiles, archive_fetcher=None):
    routes = fetch("routes", {"carrier_code": _carrier(params)})
    profile = _profile(profiles, params, routes)
    resolver = _resolver(profile, True, archive_fetcher, with_shapes=True)
    rows = []
    for route_code, (route, name, resolved) in _route_names(routes, profile, resolver, with_resolved=True).items():
        if resolved is not None:
            snapshot = resolver.snapshots()[resolved.source_name]
            rows.extend(
                path_rows(profile.carrier_code, route_code, name.gtfs_route_id, snapshot, profile, resolver.digest)
            )
    return rows


def public_trip_routes(params, fetch, profiles, archive_fetcher=None):
    routes = fetch("routes", {"carrier_code": _carrier(params)})
    profile = _profile(profiles, params, routes)
    resolver = _resolver(profile, True, archive_fetcher)
    resolutions = {
        route_code: resolved
        for route_code, (_, _, resolved) in _route_names(routes, profile, resolver, with_resolved=True).items()
    }
    return trip_route_rows(profile.carrier_code, resolutions, profile, resolver)


def public_departures(params, fetch, profiles, now, archive_fetcher=None, source=None):
    query = {
        k: v
        for k, v in params.items()
        if k in ("carrier_code", "stop_id", "search_point", "search_radius", "number_of_results")
    }
    predictions = fetch("predictions", query)
    rows = flatten_departures(predictions, now=now)
    routes = fetch("routes", {"carrier_code": _carrier(params)})
    profile = _profile(profiles, params, routes)
    resolver = _resolver(profile, False, archive_fetcher)
    by_number = {name.route_number: name for _, name in _route_names(routes, profile, resolver).values()}
    indexes = CarrierIndexes(
        profiles.base_revision,
        source,
        lambda carrier: fetch("stops", {"carrier_code": carrier}),
        profiles.extra_overrides,
    )
    stop_names = {}
    for stop_id in sorted({str(r["stop_id"]) for r in rows if r.get("stop_id")})[: profile.departures_stop_lookup_max]:
        for stop in fetch("stops", {"carrier_code": _carrier(params), "stop_id": stop_id}):
            stop_names[str(stop["stop_id"])] = indexes.name(stop, profile)
    return enrich_departures(rows, by_number, stop_names, profile, profiles.revision, resolver.digest)


def naming_profiles(profiles):
    rows = []
    for profile in [profiles.default] + sorted(profiles.profiles.values(), key=lambda p: p.carrier_code):
        rows.append(
            {
                "carrier_code": profile.carrier_code,
                "source_file": profile.source_file,
                "is_default": profile.is_default,
                "gtfs_sources": ", ".join(s.name for s in profile.gtfs_sources),
                "overrides": len(profile.overrides),
                "revision": profiles.revision,
            }
        )
    return rows


def run_public_resource(resource, params, fetch, now=None, archive_fetcher=None, source=None):
    profiles = load_profile_set()
    if resource == "public_routes":
        return public_routes(params, fetch, profiles, archive_fetcher)
    if resource == "public_stops":
        return public_stops(params, fetch, profiles, archive_fetcher, source)
    if resource == "public_stop_locations":
        stops = public_stops({}, fetch, profiles, archive_fetcher, source, location_member_filter(params))
        return location_rows(stops, profiles, params)
    if resource == "public_route_stops":
        return public_route_stops(params, fetch, profiles, archive_fetcher, source)
    if resource == "public_route_paths":
        return public_route_paths(params, fetch, profiles, archive_fetcher)
    if resource == "public_trip_routes":
        return public_trip_routes(params, fetch, profiles, archive_fetcher)
    if resource == "public_departures":
        return public_departures(params, fetch, profiles, now, archive_fetcher, source)
    return naming_profiles(profiles)

from redash import settings
from redash.query_runner.metrocloudalliance_departures import flatten_departures
from redash.transit_naming.departures import PUBLIC_DEPARTURE_COLUMNS, enrich_departures
from redash.transit_naming.gtfs_cache import http_fetch
from redash.transit_naming.gtfs_routes import GtfsResolver
from redash.transit_naming.patterns import (
    cut_patterns,
    mca_pattern_membership,
    pattern_row,
)
from redash.transit_naming.profile_loader import load_profiles, profile_dirs
from redash.transit_naming.routes import name_route, parse_route_number, route_row
from redash.transit_naming.snapshot import PatternStop, RouteName, StopName
from redash.transit_naming.stops import name_stop, stop_row

archive_fetch = http_fetch
_profile_set = {}


def load_profile_set(reload=False):
    dirs = tuple(profile_dirs())
    if reload or dirs not in _profile_set:
        _profile_set.clear()
        _profile_set[dirs] = load_profiles(dirs)
    return _profile_set[dirs]


def cache_dir():
    return settings.TRANSIT_NAMING_CACHE_DIR


PUBLIC_RESOURCES = {
    "public_routes": {
        "path": "v2/transitnetwork/routes",
        "doc_params": ["carrier_code (required): string", "route_code (optional): string - one route"],
        "doc_returns": [
            "carrier_code, carrier_id, carrier_name, route_code, route_id, line_code, line_id: from MCA routes",
            "route_number, brand, public_name, short_name, long_name, mode, color, text_color, gtfs_route_id",
            "public_name_source, brand_source, color_source: gtfs | alias | mca_side_channel | rule | override | passthrough",
            "normalization_revision, gtfs_digest: lineage",
        ],
        "example": '{"resource": "public_routes", "params": {"carrier_code": "MT"}}',
    },
    "public_stops": {
        "path": "v2/transitnetwork/stops",
        "doc_params": ["carrier_code (required): string", "stop_id (optional): string"],
        "doc_returns": [
            "carrier_code, stop_id, uuid, 511_id, public_name, raw_name, on_street, cross_street, direction, relation_to_cross_street",
            "stop_kind: intersection | station | named_place | unparsed",
            "mode: bus | rail | empty; retired: boolean (empty transit_modes and no predictions)",
            "lat, lng, city, accessible, public_name_source, normalization_revision, gtfs_digest",
        ],
        "example": '{"resource": "public_stops", "params": {"carrier_code": "MT"}}',
    },
    "public_route_stops": {
        "path": "v2/transitnetwork/routes",
        "doc_params": [
            "carrier_code (required): string",
            "route_code (optional): string - one route; default every route of the carrier",
        ],
        "doc_returns": [
            "carrier_code, route_code, direction, pattern_id, is_canonical, sequence, stop_id, gtfs_stop_id, public_name",
            "stop_match: id | coordinate | unmatched; sequence_source: gtfs_stop_times | mca_pattern (sequence null)",
            "normalization_revision, gtfs_digest",
        ],
        "example": '{"resource": "public_route_stops", "params": {"carrier_code": "MT", "route_code": "MT030"}}',
    },
    "public_departures": {
        "path": "v2/realtime/predictions",
        "doc_params": [
            "carrier_code (required): string",
            "stop_id (optional): string",
            'search_point (optional): string - "lat,lon"',
            "search_radius (optional): number - meters",
            "number_of_results (optional): integer",
        ],
        "doc_returns": PUBLIC_DEPARTURE_COLUMNS,
        "example": '{"resource": "public_departures", "params": {"carrier_code": "MT", "stop_id": "1166"}}',
    },
    "naming_profiles": {
        "path": "",
        "doc_params": ["none - reads the loaded profile set"],
        "doc_returns": ["carrier_code, source_file, is_default, gtfs_sources, overrides, revision"],
        "example": '{"resource": "naming_profiles"}',
    },
}


def _carrier(params):
    return str(params.get("carrier_code") or "")


def _profile(profiles, params, records):
    name = next((r.get("carrier_name") for r in records if r.get("carrier_name")), "")
    return profiles.for_carrier(_carrier(params), name)


def _resolver(profile, with_patterns, archive_fetcher=None):
    return GtfsResolver(profile, cache_dir(), fetch=archive_fetcher or archive_fetch, with_patterns=with_patterns)


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
    "public_departures": [column.split(":")[0] for column in PUBLIC_DEPARTURE_COLUMNS],
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


def public_stops(params, fetch, profiles, archive_fetcher=None):
    query = {"carrier_code": _carrier(params)}
    if params.get("stop_id"):
        query["stop_id"] = params["stop_id"]
    stops = fetch("stops", query)
    profile = profiles.for_carrier(_carrier(params))
    digest = _resolver(profile, False, archive_fetcher).digest
    return [stop_row(stop, name_stop(stop, profile), profiles.revision, digest) for stop in stops]


def public_route_stops(params, fetch, profiles, archive_fetcher=None):
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
    names = {}
    sources = {}
    live = {}
    for stop in stops:
        named = name_stop(stop, profile)
        if not named.retired:
            live[str(stop["stop_id"])] = stop
            names[str(stop["stop_id"])] = named.public_name
            sources[str(stop["stop_id"])] = named.public_name_source
    rows = []
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
        rows.extend(pattern_row(p, profiles.revision, resolver.digest) for p in patterns)
    return rows


def public_departures(params, fetch, profiles, now, archive_fetcher=None):
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
    stop_names = {}
    for stop_id in sorted({str(r["stop_id"]) for r in rows if r.get("stop_id")})[: profile.departures_stop_lookup_max]:
        for stop in fetch("stops", {"carrier_code": _carrier(params), "stop_id": stop_id}):
            stop_names[str(stop["stop_id"])] = name_stop(stop, profile)
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


def run_public_resource(resource, params, fetch, now=None, archive_fetcher=None):
    profiles = load_profile_set()
    if resource == "public_routes":
        return public_routes(params, fetch, profiles, archive_fetcher)
    if resource == "public_stops":
        return public_stops(params, fetch, profiles, archive_fetcher)
    if resource == "public_route_stops":
        return public_route_stops(params, fetch, profiles, archive_fetcher)
    if resource == "public_departures":
        return public_departures(params, fetch, profiles, now, archive_fetcher)
    return naming_profiles(profiles)

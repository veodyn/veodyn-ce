import logging
import re
from concurrent.futures import ThreadPoolExecutor

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
from redash.transit_naming.mca_patterns import mca_route_patterns
from redash.transit_naming.merge_candidates import (
    MERGE_CANDIDATE_COLUMNS,
    merge_candidate_rows,
)
from redash.transit_naming.override_status import (
    OVERRIDE_STATUS_COLUMNS,
    override_status,
)
from redash.transit_naming.override_table import override_table
from redash.transit_naming.patterns import (
    StopIndex,
    cut_patterns,
    pattern_row,
)
from redash.transit_naming.places import MAX_PLACE_STOPS, PLACE_COLUMNS, place_rows
from redash.transit_naming.profile_loader import load_profiles, profile_dirs
from redash.transit_naming.routes import (
    name_route,
    parse_route_number,
    route_groups,
    route_row,
)
from redash.transit_naming.snapshot import PatternStop, RouteName, StopName
from redash.transit_naming.stop_rows import stop_row
from redash.transit_naming.stops import is_retired
from redash.transit_naming.suffixes import CarrierIndexes
from redash.transit_naming.terminals import TerminalIndexes, TerminusFilter
from redash.transit_naming.trip_routes import TRIP_ROUTE_COLUMNS, trip_route_rows

archive_fetch = http_fetch
_profile_set = {}


def base_profile_set():
    dirs = tuple(profile_dirs())
    if dirs not in _profile_set:
        _profile_set.clear()
        _profile_set[dirs] = load_profiles(dirs)
    return _profile_set[dirs]


def load_profile_set(reload=False):
    if reload:
        _profile_set.clear()
    return base_profile_set().with_overrides(override_table().current())


def cache_dir():
    return settings.TRANSIT_NAMING_CACHE_DIR


STOP_KEY = re.compile(r"([A-Za-z0-9]{1,8}):([A-Za-z0-9_.\-]{1,40})")
PLACE_GROUP = r"[A-Za-z0-9]{1,8}:[A-Za-z0-9_.\-]{1,40}(?:\|[A-Za-z0-9_.\-]{1,40})*"
PLACE_KEY = re.compile(rf"{PLACE_GROUP}(?:,{PLACE_GROUP})*")
PLACE_FETCH_WORKERS = 4
PLACE_ERROR = (
    'place must be "<carrier_code>:<stop_id>[|<stop_id>...]" groups joined by commas, at most '
    f"{MAX_PLACE_STOPS} stops"
)
logger = logging.getLogger(__name__)


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
    "public_carriers": ["carrier_code", "carrier_name", "provider_name", "normalization_revision"],
    "public_places": list(PLACE_COLUMNS),
    "public_stops": list(stop_row({}, StopName("", "", "", "", "", "", False, ""), "", "")),
    "public_route_stops": list(pattern_row(PatternStop(*[""] * 11), "", "")),
    "public_route_paths": list(PATH_COLUMNS),
    "public_trip_routes": list(TRIP_ROUTE_COLUMNS),
    "public_departures": [column.split(":")[0] for column in PUBLIC_DEPARTURE_COLUMNS],
    "public_place_departures": [column.split(":")[0] for column in PUBLIC_DEPARTURE_COLUMNS],
    "public_stop_locations": list(LOCATION_COLUMNS),
    "public_stop_merge_candidates": list(MERGE_CANDIDATE_COLUMNS),
    "naming_profiles": ["carrier_code", "source_file", "is_default", "gtfs_sources", "overrides", "revision"],
    "name_overrides": list(OVERRIDE_STATUS_COLUMNS),
}


def _routes(params, fetch):
    route_code = params.get("route_code")
    if not route_code:
        return fetch("routes", {"carrier_code": _carrier(params)})
    routes = fetch("routes", {"carrier_code": _carrier(params), "route_code": route_code})
    return [route for route in routes if str(route.get("route_code")) == str(route_code)]


def provider_name(profile, carrier_name):
    return profile.provider_name or str(carrier_name or "") or profile.carrier_code


def public_routes(params, fetch, profiles, archive_fetcher=None):
    routes = _routes(params, fetch)
    profile = _profile(profiles, params, routes)
    resolver = _resolver(profile, False, archive_fetcher)
    named = _route_names(routes, profile, resolver, with_resolved=True)
    groups = route_groups(named, profile)
    return [
        route_row(
            route,
            name,
            profiles.revision,
            resolver.digest,
            provider_name=provider_name(profile, route.get("carrier_name")),
            route_group=groups[route_code],
        )
        for route_code, (route, name, _) in named.items()
    ]


def public_places(fetch, profiles, archive_fetcher=None, source=None):
    stops = public_stops({}, fetch, profiles, archive_fetcher, source)
    carrier_names = {str(c.get("carrier_code") or ""): c.get("carrier_name") for c in fetch("carriers", {})}

    def provider_of(carrier):
        name = carrier_names.get(carrier)
        return provider_name(profiles.for_carrier(carrier, name or ""), name)

    return place_rows(stops, profiles, provider_of)


def public_carriers(fetch, profiles):
    rows = []
    for carrier in fetch("carriers", {}):
        code = str(carrier.get("carrier_code") or "")
        name = carrier.get("carrier_name")
        rows.append(
            {
                "carrier_code": code,
                "carrier_name": name,
                "provider_name": provider_name(profiles.for_carrier(code, name or ""), name),
                "normalization_revision": profiles.revision,
            }
        )
    return rows


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
    routes = _routes(params, fetch)
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
            patterns = mca_route_patterns(fetch, _carrier(params), route_code, profile, live, names, sources)
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


def _predictions(fetch, queries):
    if len(queries) == 1:
        return fetch("predictions", queries[0])
    with ThreadPoolExecutor(max_workers=PLACE_FETCH_WORKERS) as pool:
        return [
            record for records in pool.map(lambda query: fetch("predictions", query), queries) for record in records
        ]


def carrier_departures(carrier, queries, fetch, profiles, now, archive_fetcher=None, source=None):
    params = {"carrier_code": carrier}
    rows = flatten_departures(_predictions(fetch, queries), now=now)
    routes = fetch("routes", params)
    profile = _profile(profiles, params, routes)
    resolver = _resolver(profile, False, archive_fetcher)
    named = _route_names(routes, profile, resolver, with_resolved=True)
    by_number = {name.route_number: name for _, name, _ in named.values()}
    by_code = {route_code: name for route_code, (_, name, _) in named.items()}
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
    enriched = enrich_departures(rows, by_number, stop_names, profile, profiles.revision, resolver.digest, by_code)
    terminus = TerminusFilter(
        {route_code: resolved for route_code, (_, _, resolved) in named.items() if resolved is not None},
        TerminalIndexes(profile, cache_dir(), archive_fetcher or archive_fetch, resolver.snapshots()),
        lambda pattern_code: fetch("stops", {"carrier_code": _carrier(params), "pattern_code": pattern_code}),
    )
    return terminus.apply(enriched)


def public_departures(params, fetch, profiles, now, archive_fetcher=None, source=None):
    query = {
        k: v
        for k, v in params.items()
        if k in ("carrier_code", "stop_id", "search_point", "search_radius", "number_of_results")
    }
    return carrier_departures(_carrier(params), [query], fetch, profiles, now, archive_fetcher, source)


def place_stops(place):
    value = str(place or "")
    if PLACE_KEY.fullmatch(value) is None:
        raise ValueError(PLACE_ERROR)
    stops = {}
    for group in value.split(","):
        carrier, ids = group.split(":", 1)
        for stop_id in ids.split("|"):
            if stop_id not in stops.setdefault(carrier, []):
                stops[carrier].append(stop_id)
    if sum(len(ids) for ids in stops.values()) > MAX_PLACE_STOPS:
        raise ValueError(PLACE_ERROR)
    return stops


def _departure_key(row):
    return tuple(
        str(row.get(field))
        for field in (
            "carrier",
            "stop_id",
            "route_code",
            "pattern_code",
            "direction",
            "public_headsign",
            "departure_at",
            "is_realtime",
        )
    )


def public_place_departures(params, fetch, profiles, now, archive_fetcher=None, source=None):
    rows = []
    for carrier, stop_ids in place_stops(params.get("place")).items():
        queries = [{"carrier_code": carrier, "stop_id": stop_id} for stop_id in stop_ids]
        try:
            rows.extend(carrier_departures(carrier, queries, fetch, profiles, now, archive_fetcher, source))
        except Exception as error:
            logger.warning("Leaving %s out of place departures: %s", carrier, error)
    unique = {}
    for row in rows:
        unique.setdefault(_departure_key(row), row)
    return sorted(unique.values(), key=lambda row: str(row.get("departure_at") or ""))


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
    if resource == "public_carriers":
        return public_carriers(fetch, profiles)
    if resource == "public_places":
        return public_places(fetch, profiles, archive_fetcher, source)
    if resource == "public_stops":
        return public_stops(params, fetch, profiles, archive_fetcher, source)
    if resource == "public_stop_locations":
        stops = public_stops({}, fetch, profiles, archive_fetcher, source, location_member_filter(params))
        return location_rows(stops, profiles, params)
    if resource == "public_stop_merge_candidates":
        active = public_stops({}, fetch, profiles, archive_fetcher, source, lambda stop: not is_retired(stop))
        return merge_candidate_rows(active, params)
    if resource == "public_route_stops":
        return public_route_stops(params, fetch, profiles, archive_fetcher, source)
    if resource == "public_route_paths":
        return public_route_paths(params, fetch, profiles, archive_fetcher)
    if resource == "public_trip_routes":
        return public_trip_routes(params, fetch, profiles, archive_fetcher)
    if resource == "public_departures":
        return public_departures(params, fetch, profiles, now, archive_fetcher, source)
    if resource == "public_place_departures":
        return public_place_departures(params, fetch, profiles, now, archive_fetcher, source)
    if resource == "name_overrides":
        return override_status(profiles.extra_overrides, fetch)
    return naming_profiles(profiles)

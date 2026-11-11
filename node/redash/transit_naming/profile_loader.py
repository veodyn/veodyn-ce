import hashlib
import os
import re
from dataclasses import replace

from redash.transit_naming.compass import DIRECTION_SOURCES, MAP
from redash.transit_naming.profile_files import (
    load_strict_yaml,
    parse_overrides_csv,
    read_profile_files,
    with_default_data,
)
from redash.transit_naming.profiles import (
    JOIN_STRATEGIES,
    Alias,
    GtfsSource,
    HeadsignRules,
    Profile,
    ProfileError,
    ProfileSet,
)
from redash.transit_naming.route_rules_loader import route_name_rules
from redash.transit_naming.stop_rules_loader import check_keys, stop_name_rules
from redash.transit_naming.streets import StreetIndex, parse_streets_json

CORE_PROFILE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "profiles")
DEFAULT_FILE = "default.yaml"
TOP_KEYS = {
    "carrier_code",
    "carrier_display_name",
    "gtfs_sources",
    "gtfs_cache_max_age_hours",
    "gtfs_max_download_bytes",
    "aliases",
    "extra_trip_routes",
    "route_name",
    "direction_map",
    "direction_map_by_route",
    "direction_from",
    "pattern_codes",
    "departures_stop_lookup_max",
    "stop_name",
    "headsign",
    "time_format",
    "trim_layover_named_ends",
    "inherit_default",
}
STREETS_SUFFIX = ".streets.json"
HEADSIGN_KEYS = {"title_case", "expand"}
SOURCE_KEYS = {"name", "url", "join"}
ALIAS_KEYS = {"source", "gtfs_route_id", "note"}


def profile_dirs():
    from redash import settings

    return [CORE_PROFILE_DIR] + list(settings.TRANSIT_NAMING_PROFILE_DIRS)


def _headsign_rules(data, carrier, file):
    check_keys(data, HEADSIGN_KEYS, carrier, file, "headsign.")
    expand = {str(k): str(v) for k, v in (data.get("expand") or {}).items()}
    return HeadsignRules(bool(data.get("title_case", True)), expand)


def _gtfs_sources(items, carrier, file):
    sources = []
    for index, item in enumerate(items or []):
        check_keys(item, SOURCE_KEYS, carrier, file, f"gtfs_sources[{index}].")
        if str(item.get("name")) in {source.name for source in sources}:
            field = f"gtfs_sources[{index}].name"
            raise ProfileError(f"duplicate gtfs source name {item.get('name')!r}", carrier, file, field=field)
        join = item.get("join") or []
        for strategy in join:
            if strategy not in JOIN_STRATEGIES:
                field = f"gtfs_sources[{index}].join"
                raise ProfileError(f"unknown join strategy {strategy!r}", carrier, file, field=field)
        sources.append(GtfsSource(str(item["name"]), str(item["url"]), tuple(join)))
    return tuple(sources)


def _aliases(data, sources, carrier, file):
    names = {source.name for source in sources}
    aliases = {}
    for route_code, alias in (data or {}).items():
        check_keys(alias, ALIAS_KEYS, carrier, file, f"aliases.{route_code}.")
        if alias.get("source") not in names:
            field = f"aliases.{route_code}.source"
            raise ProfileError(
                f"alias source {alias.get('source')!r} is not a declared gtfs source", carrier, file, field=field
            )
        aliases[str(route_code)] = Alias(alias["source"], str(alias["gtfs_route_id"]), str(alias.get("note", "")))
    return aliases


def _extra_trip_routes(data, carrier, file):
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ProfileError("extra_trip_routes must be a mapping", carrier, file, field="extra_trip_routes")
    extra = {}
    for route_code, route_ids in data.items():
        if not isinstance(route_code, str) or not route_code:
            raise ProfileError(
                f"extra_trip_routes key {route_code!r} must be a route code string",
                carrier,
                file,
                field="extra_trip_routes",
            )
        field = f"extra_trip_routes.{route_code}"
        if not isinstance(route_ids, list) or not route_ids:
            raise ProfileError("must be a non-empty list of GTFS route ids", carrier, file, field=field)
        if not all(isinstance(route_id, str) and route_id for route_id in route_ids):
            raise ProfileError("every GTFS route id must be a non-empty string", carrier, file, field=field)
        if len(set(route_ids)) != len(route_ids):
            raise ProfileError("GTFS route ids must be unique", carrier, file, field=field)
        extra[route_code] = tuple(route_ids)
    return extra


def _trim_layover_named_ends(data, carrier, file):
    value = data.get("trim_layover_named_ends", True)
    if not isinstance(value, bool):
        raise ProfileError(
            f"trim_layover_named_ends must be true or false, got {value!r}",
            carrier,
            file,
            field="trim_layover_named_ends",
        )
    return value


def _direction_map(data):
    return {str(k): str(v) for k, v in (data or {}).items()}


def _direction_from(data, carrier, file):
    value = data.get("direction_from", MAP)
    if value not in DIRECTION_SOURCES:
        raise ProfileError(
            f"direction_from must be one of {', '.join(DIRECTION_SOURCES)}, got {value!r}",
            carrier,
            file,
            field="direction_from",
        )
    return value


def parse_profile_yaml(text, file, default_data=None):
    try:
        data = load_strict_yaml(text) or {}
    except ProfileError as error:
        declared = re.search(r"^carrier_code:\s*(\S+)", text, re.MULTILINE)
        carrier = declared.group(1).strip("\"'") if declared else ""
        raise ProfileError(str(error), carrier, file, field=error.field) from error
    carrier = str(data.get("carrier_code") or "").strip()
    if not carrier:
        raise ProfileError("carrier_code is required", file=file, field="carrier_code")
    check_keys(data, TOP_KEYS, carrier, file)
    data = with_default_data(data, default_data, file)
    sources = _gtfs_sources(data.get("gtfs_sources"), carrier, file)
    by_route = data.get("direction_map_by_route") or {}
    pattern_codes = data.get("pattern_codes") or {}
    return Profile(
        carrier_code=carrier,
        carrier_display_name=str(data.get("carrier_display_name", "" if data.get("inherit_default") else carrier)),
        route_name=route_name_rules(data.get("route_name") or {}, carrier, file),
        stop_name=stop_name_rules(data.get("stop_name") or {}, carrier, file),
        headsign=_headsign_rules(data.get("headsign") or {}, carrier, file),
        gtfs_sources=sources,
        gtfs_cache_max_age_hours=int(data.get("gtfs_cache_max_age_hours", 24)),
        gtfs_max_download_bytes=int(data.get("gtfs_max_download_bytes", 52428800)),
        aliases=_aliases(data.get("aliases"), sources, carrier, file),
        extra_trip_routes=_extra_trip_routes(data.get("extra_trip_routes"), carrier, file),
        direction_map=_direction_map(data.get("direction_map")),
        direction_map_by_route={str(k): _direction_map(v) for k, v in by_route.items()},
        direction_from=_direction_from(data, carrier, file),
        pattern_codes={str(k): tuple(str(c) for c in v) for k, v in pattern_codes.items()},
        departures_stop_lookup_max=int(data.get("departures_stop_lookup_max", 50)),
        time_format=str(data.get("time_format", "h:mma")),
        trim_layover_named_ends=_trim_layover_named_ends(data, carrier, file),
        source_file=file,
        is_default=os.path.basename(file) == DEFAULT_FILE,
        inherits_default=bool(data.get("inherit_default")),
    )


def _with_streets(profile, streets_path, files):
    if profile.stop_name.street_reference is None:
        return profile
    if streets_path not in files:
        message = f"street_reference needs {os.path.basename(streets_path)} beside the profile"
        raise ProfileError(message, profile.carrier_code, profile.source_file, field="stop_name.street_reference")
    streets = parse_streets_json(files[streets_path].decode("utf-8"), profile.carrier_code, streets_path)
    return replace(profile, streets=StreetIndex(streets, profile.stop_name))


def build_profile_set(dirs, extra_files=None):
    files = read_profile_files(dirs, extra_files)
    digest = hashlib.sha256()
    yaml_paths = [path for path in files if path.endswith(".yaml")]
    for path in sorted(yaml_paths, key=lambda p: (os.path.basename(p), files[p])):
        digest.update(os.path.basename(path).encode("utf-8"))
        digest.update(files[path])
        digest.update(files.get(path[: -len(".yaml")] + ".csv", b""))
        digest.update(files.get(path[: -len(".yaml")] + STREETS_SUFFIX, b""))
    profiles = {}
    default = None
    defaults = [path for path in sorted(files) if os.path.basename(path) == DEFAULT_FILE]
    default_data = load_strict_yaml(files[defaults[-1]].decode("utf-8")) if defaults else None
    for path in sorted(files):
        if not path.endswith(".yaml"):
            continue
        profile = parse_profile_yaml(files[path].decode("utf-8"), path, default_data)
        csv_path = path[: -len(".yaml")] + ".csv"
        if csv_path in files:
            overrides = parse_overrides_csv(files[csv_path].decode("utf-8"), profile.carrier_code, csv_path)
            profile = replace(profile, overrides=overrides)
        profile = _with_streets(profile, path[: -len(".yaml")] + STREETS_SUFFIX, files)
        if profile.is_default:
            default = profile
            continue
        if profile.carrier_code in profiles:
            first = profiles[profile.carrier_code].source_file
            message = f"carrier {profile.carrier_code} is defined twice: {first} and {path}"
            raise ProfileError(message, profile.carrier_code, path, field="carrier_code")
        profiles[profile.carrier_code] = profile
    if default is None:
        raise ProfileError(f"no {DEFAULT_FILE} in {', '.join(dirs)}", file=DEFAULT_FILE)
    return ProfileSet(profiles=profiles, default=default, digest=digest.hexdigest(), files=tuple(sorted(files)))


def load_profiles(dirs):
    return build_profile_set(list(dirs))

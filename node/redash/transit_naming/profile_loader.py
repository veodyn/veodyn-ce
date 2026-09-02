import hashlib
import os
import re
import string
from dataclasses import replace

import yaml

from redash.transit_naming.profile_files import parse_overrides_csv, read_profile_files
from redash.transit_naming.profiles import (
    BRAND_SOURCES,
    JOIN_STRATEGIES,
    MODES,
    PATTERN_PLACEHOLDERS,
    RAIL_PATTERN_PLACEHOLDERS,
    Alias,
    BrandBand,
    GtfsSource,
    HeadsignRules,
    Profile,
    ProfileError,
    ProfileSet,
    RouteNameEntry,
    RouteNameRules,
    StopNameRules,
)

CORE_PROFILE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "profiles")
DEFAULT_FILE = "default.yaml"
TOP_KEYS = {
    "carrier_code",
    "carrier_display_name",
    "gtfs_sources",
    "gtfs_cache_max_age_hours",
    "gtfs_max_download_bytes",
    "aliases",
    "route_name",
    "direction_map",
    "direction_map_by_route",
    "pattern_codes",
    "departures_stop_lookup_max",
    "stop_name",
    "headsign",
    "time_format",
}
ROUTE_NAME_KEYS = {
    "pattern",
    "brand_from",
    "brand_bands",
    "route_names",
    "rail_pattern",
    "legacy_colors",
    "busways",
    "strip_from_brand",
}
STOP_NAME_KEYS = {
    "separator",
    "suffixes",
    "keep_whole",
    "station_suffix",
    "strip_direction_parenthetical",
    "strip_trailing_line_reference",
}
HEADSIGN_KEYS = {"title_case", "expand"}
SOURCE_KEYS = {"name", "url", "join"}
ALIAS_KEYS = {"source", "gtfs_route_id", "note"}
BAND_KEYS = {"from", "to", "brand", "mode"}
ENTRY_KEYS = {"public_name", "short_name", "mode", "color"}
HEX_COLOR = re.compile(r"^[0-9A-Fa-f]{6}$")


class StrictLoader(yaml.SafeLoader):
    pass


def _mapping_without_duplicates(loader, node, deep=False):
    seen = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            raise ProfileError(f"duplicate key {key!r}", field=str(key))
        seen.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep)


StrictLoader.construct_mapping = _mapping_without_duplicates


def profile_dirs():
    from redash import settings

    return [CORE_PROFILE_DIR] + list(settings.TRANSIT_NAMING_PROFILE_DIRS)


def _check_keys(data, allowed, carrier, file, prefix=""):
    for key in data:
        if key not in allowed:
            raise ProfileError(f"unknown key {key!r}", carrier, file, field=f"{prefix}{key}")


def _check_pattern(pattern, allowed, carrier, file, field):
    try:
        names = [name for _, name, _, _ in string.Formatter().parse(pattern) if name is not None]
    except ValueError as error:
        raise ProfileError(f"malformed pattern {pattern!r}: {error}", carrier, file, field=field) from error
    for name in names:
        if name not in allowed:
            raise ProfileError(f"unknown placeholder {name!r} in {pattern!r}", carrier, file, field=field)


def _color(value, carrier, file, field):
    value = "" if value is None else str(value)
    if value and not HEX_COLOR.match(value):
        raise ProfileError(f"{value!r} is not a six digit hex color", carrier, file, field=field)
    return value.upper()


def _brand_bands(items, carrier, file):
    bands = []
    for index, band in enumerate(items or []):
        _check_keys(band, BAND_KEYS, carrier, file, f"route_name.brand_bands[{index}].")
        mode = band.get("mode", "bus")
        if mode not in MODES:
            raise ProfileError(f"unknown mode {mode!r}", carrier, file, field=f"route_name.brand_bands[{index}].mode")
        bands.append(BrandBand(int(band["from"]), int(band["to"]), str(band["brand"]), mode))
    return tuple(bands)


def _route_names(items, carrier, file):
    names = {}
    for route_code, entry in (items or {}).items():
        prefix = f"route_name.route_names.{route_code}"
        if not isinstance(entry, dict) or not entry.get("public_name"):
            raise ProfileError("route_names entry needs public_name", carrier, file, field=f"{prefix}.public_name")
        _check_keys(entry, ENTRY_KEYS, carrier, file, f"{prefix}.")
        if entry.get("mode", "") not in MODES:
            raise ProfileError(f"unknown mode {entry.get('mode')!r}", carrier, file, field=f"{prefix}.mode")
        names[str(route_code)] = RouteNameEntry(
            str(entry["public_name"]),
            str(entry.get("short_name", "")),
            entry.get("mode", ""),
            _color(entry.get("color"), carrier, file, f"{prefix}.color"),
        )
    return names


def _route_name_rules(data, carrier, file):
    _check_keys(data, ROUTE_NAME_KEYS, carrier, file, "route_name.")
    pattern = data.get("pattern", "{brand} Line {route_number}")
    _check_pattern(pattern, PATTERN_PLACEHOLDERS, carrier, file, "route_name.pattern")
    rail_pattern = data.get("rail_pattern", "{public_name} ({legacy_color})")
    _check_pattern(rail_pattern, RAIL_PATTERN_PLACEHOLDERS, carrier, file, "route_name.rail_pattern")
    brand_from = data.get("brand_from", ["carrier_display_name"])
    if isinstance(brand_from, str):
        brand_from = [brand_from]
    for source in brand_from:
        if source not in BRAND_SOURCES:
            raise ProfileError(f"unknown brand source {source!r}", carrier, file, field="route_name.brand_from")
    return RouteNameRules(
        pattern=pattern,
        brand_from=tuple(brand_from),
        brand_bands=_brand_bands(data.get("brand_bands"), carrier, file),
        route_names=_route_names(data.get("route_names"), carrier, file),
        rail_pattern=rail_pattern,
        legacy_colors={str(k): str(v) for k, v in (data.get("legacy_colors") or {}).items()},
        busways=frozenset(str(code) for code in data.get("busways") or []),
        strip_from_brand=tuple(str(s) for s in data.get("strip_from_brand") or []),
    )


def _stop_name_rules(data, carrier, file):
    _check_keys(data, STOP_NAME_KEYS, carrier, file, "stop_name.")
    return StopNameRules(
        separator=str(data.get("separator", "/")),
        suffixes={str(k): str(v) for k, v in (data.get("suffixes") or {}).items()},
        keep_whole=frozenset(str(w) for w in data.get("keep_whole") or []),
        station_suffix=str(data.get("station_suffix", " Station")),
        strip_direction_parenthetical=bool(data.get("strip_direction_parenthetical", True)),
        strip_trailing_line_reference=bool(data.get("strip_trailing_line_reference", True)),
    )


def _headsign_rules(data, carrier, file):
    _check_keys(data, HEADSIGN_KEYS, carrier, file, "headsign.")
    expand = {str(k): str(v) for k, v in (data.get("expand") or {}).items()}
    return HeadsignRules(bool(data.get("title_case", True)), expand)


def _gtfs_sources(items, carrier, file):
    sources = []
    for index, item in enumerate(items or []):
        _check_keys(item, SOURCE_KEYS, carrier, file, f"gtfs_sources[{index}].")
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
        _check_keys(alias, ALIAS_KEYS, carrier, file, f"aliases.{route_code}.")
        if alias.get("source") not in names:
            field = f"aliases.{route_code}.source"
            raise ProfileError(
                f"alias source {alias.get('source')!r} is not a declared gtfs source", carrier, file, field=field
            )
        aliases[str(route_code)] = Alias(alias["source"], str(alias["gtfs_route_id"]), str(alias.get("note", "")))
    return aliases


def _direction_map(data):
    return {str(k): str(v) for k, v in (data or {}).items()}


def parse_profile_yaml(text, file):
    try:
        data = yaml.load(text, Loader=StrictLoader) or {}
    except ProfileError as error:
        declared = re.search(r"^carrier_code:\s*(\S+)", text, re.MULTILINE)
        carrier = declared.group(1).strip("\"'") if declared else ""
        raise ProfileError(str(error), carrier, file, field=error.field) from error
    carrier = str(data.get("carrier_code") or "").strip()
    if not carrier:
        raise ProfileError("carrier_code is required", file=file, field="carrier_code")
    _check_keys(data, TOP_KEYS, carrier, file)
    sources = _gtfs_sources(data.get("gtfs_sources"), carrier, file)
    by_route = data.get("direction_map_by_route") or {}
    pattern_codes = data.get("pattern_codes") or {}
    return Profile(
        carrier_code=carrier,
        carrier_display_name=str(data.get("carrier_display_name", carrier)),
        route_name=_route_name_rules(data.get("route_name") or {}, carrier, file),
        stop_name=_stop_name_rules(data.get("stop_name") or {}, carrier, file),
        headsign=_headsign_rules(data.get("headsign") or {}, carrier, file),
        gtfs_sources=sources,
        gtfs_cache_max_age_hours=int(data.get("gtfs_cache_max_age_hours", 24)),
        gtfs_max_download_bytes=int(data.get("gtfs_max_download_bytes", 52428800)),
        aliases=_aliases(data.get("aliases"), sources, carrier, file),
        direction_map=_direction_map(data.get("direction_map")),
        direction_map_by_route={str(k): _direction_map(v) for k, v in by_route.items()},
        pattern_codes={str(k): tuple(str(c) for c in v) for k, v in pattern_codes.items()},
        departures_stop_lookup_max=int(data.get("departures_stop_lookup_max", 50)),
        time_format=str(data.get("time_format", "h:mma")),
        source_file=file,
        is_default=os.path.basename(file) == DEFAULT_FILE,
    )


def build_profile_set(dirs, extra_files=None):
    files = read_profile_files(dirs, extra_files)
    digest = hashlib.sha256()
    for path in sorted(files):
        digest.update(os.path.basename(path).encode("utf-8"))
        digest.update(files[path])
    profiles = {}
    default = None
    for path in sorted(files):
        if not path.endswith(".yaml"):
            continue
        profile = parse_profile_yaml(files[path].decode("utf-8"), path)
        csv_path = path[: -len(".yaml")] + ".csv"
        if csv_path in files:
            overrides = parse_overrides_csv(files[csv_path].decode("utf-8"), profile.carrier_code, csv_path)
            profile = replace(profile, overrides=overrides)
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

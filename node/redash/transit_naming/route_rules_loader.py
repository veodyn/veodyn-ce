import re
import string

from redash.transit_naming.profiles import (
    BRAND_SOURCES,
    MODES,
    PATTERN_PLACEHOLDERS,
    RAIL_PATTERN_PLACEHOLDERS,
    BrandBand,
    ProfileError,
    RouteNameEntry,
    RouteNameRules,
)
from redash.transit_naming.stop_rules_loader import check_keys

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
BAND_KEYS = {"from", "to", "brand", "mode"}
ENTRY_KEYS = {"public_name", "short_name", "mode", "color"}
HEX_COLOR = re.compile(r"^[0-9A-Fa-f]{6}$")


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
        check_keys(band, BAND_KEYS, carrier, file, f"route_name.brand_bands[{index}].")
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
        check_keys(entry, ENTRY_KEYS, carrier, file, f"{prefix}.")
        if entry.get("mode", "") not in MODES:
            raise ProfileError(f"unknown mode {entry.get('mode')!r}", carrier, file, field=f"{prefix}.mode")
        names[str(route_code)] = RouteNameEntry(
            str(entry["public_name"]),
            str(entry.get("short_name", "")),
            entry.get("mode", ""),
            _color(entry.get("color"), carrier, file, f"{prefix}.color"),
        )
    return names


def route_name_rules(data, carrier, file):
    check_keys(data, ROUTE_NAME_KEYS, carrier, file, "route_name.")
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

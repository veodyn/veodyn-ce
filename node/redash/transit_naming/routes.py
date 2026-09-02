import re

from redash.transit_naming import provenance
from redash.transit_naming.snapshot import MODE_BY_ROUTE_TYPE, RouteName

RAIL_MODES = ("light_rail", "heavy_rail")
LETTER_LINE = re.compile(r"^(?:\S+ )*(?P<letter>[A-Z]) Line$")
LETTER_IN_NAME = re.compile(r"\b([A-Z]) Line\b")


def parse_route_number(route_code, carrier_code):
    remainder = route_code.strip()
    if carrier_code and remainder.startswith(carrier_code):
        remainder = remainder[len(carrier_code) :]
    remainder = remainder.strip()
    if remainder[:1].isdigit():
        stripped = remainder.lstrip("0")
        return stripped or "0"
    return remainder


def _band_for(number, bands):
    if not number.isdigit():
        return None
    value = int(number)
    for band in bands:
        if band.start <= value <= band.end:
            return band
    return None


def _strip_brand(text, rules):
    for suffix in rules.strip_from_brand:
        if text.endswith(suffix):
            text = text[: -len(suffix)]
    return text.strip()


def _brand(route_code, number, profile, resolved):
    rules = profile.route_name
    entry = rules.route_names.get(route_code)
    band = _band_for(number, rules.brand_bands)
    for source in rules.brand_from:
        if source == "gtfs_route_long_name" and resolved is not None:
            if resolved.route_long_name:
                return _strip_brand(resolved.route_long_name, rules), resolved.provenance, "pattern", "gtfs"
            if resolved.route_short_name and not resolved.route_short_name.replace("/", "").isdigit():
                return resolved.route_short_name, resolved.provenance, "outright", "gtfs"
        if source == "brand_bands":
            if entry is not None:
                return entry.public_name, provenance.RULE, "outright", "entry"
            if band is not None:
                return band.brand, provenance.RULE, "pattern", "band"
        if source == "carrier_display_name" and profile.carrier_display_name:
            return profile.carrier_display_name, provenance.RULE, "pattern", "carrier"
    return "", "", "pattern", ""


def _mode(route_code, profile, resolved, entry, number):
    if route_code in profile.route_name.busways:
        return "busway"
    if resolved is not None and resolved.route_type in MODE_BY_ROUTE_TYPE:
        return MODE_BY_ROUTE_TYPE[resolved.route_type]
    if entry is not None and entry.mode:
        return entry.mode
    band = _band_for(number, profile.route_name.brand_bands)
    return band.mode if band is not None else "bus"


def _letter(name):
    match = LETTER_IN_NAME.search(name)
    return match.group(1) if match else ""


def _rail_name(name, rules):
    match = LETTER_LINE.match(name)
    if match and match.group("letter") in rules.legacy_colors:
        return rules.rail_pattern.format(public_name=name, legacy_color=rules.legacy_colors[match.group("letter")])
    return name


def _color(route, profile, resolved, entry):
    if resolved is not None and resolved.route_color:
        return resolved.route_color, resolved.route_text_color, resolved.provenance
    mca = str(route.get("line_color") or "").strip().lstrip("#")
    if mca:
        return mca.upper(), "", provenance.PASSTHROUGH
    if entry is not None and entry.color:
        return entry.color, "", provenance.RULE
    return "", "", ""


def name_route(route, profile, resolved, side_channel=None):
    route_code = str(route.get("route_code") or "")
    number = parse_route_number(route_code, profile.carrier_code)
    rules = profile.route_name
    entry = rules.route_names.get(route_code)
    brand, brand_source, shape, origin = _brand(route_code, number, profile, resolved)
    mode = _mode(route_code, profile, resolved, entry, number)
    public_name = ""
    source = ""
    short_name = number
    entry_short = entry.short_name if entry is not None and entry.short_name else ""
    if brand:
        source = brand_source
        if mode == "busway":
            public_name = brand
            short_name = entry_short or _letter(brand) or number
        elif mode in RAIL_MODES:
            public_name = _rail_name(brand, rules)
            short_name = entry_short or _letter(brand) or number
        elif shape == "outright":
            public_name = brand
            short_name = resolved.route_short_name if origin == "gtfs" else (entry_short or number)
        else:
            public_name = rules.pattern.format(
                brand=brand, route_number=number, carrier_display_name=profile.carrier_display_name
            )
    elif side_channel and side_channel.get("line_name") and side_channel.get("line_short_name"):
        brand = str(side_channel["line_name"])
        public_name = f"{brand} {side_channel['line_short_name']}"
        short_name = str(side_channel["line_short_name"])
        source = brand_source = provenance.MCA_SIDE_CHANNEL
    else:
        brand = profile.carrier_display_name
        public_name = rules.pattern.format(
            brand=brand, route_number=number, carrier_display_name=profile.carrier_display_name
        )
        source = brand_source = provenance.RULE
    override = profile.override_for("route", route_code)
    if override is not None and override.public_name:
        public_name = override.public_name
        source = provenance.OVERRIDE
    color, text_color, color_source = _color(route, profile, resolved, entry)
    long_name = (resolved.route_long_name if resolved else "") or str(route.get("line_name") or "")
    return RouteName(
        route_number=number,
        brand=brand,
        public_name=public_name,
        short_name=short_name,
        long_name=long_name,
        mode=mode,
        color=color,
        text_color=text_color,
        gtfs_route_id=resolved.gtfs_route_id if resolved else "",
        public_name_source=source,
        brand_source=brand_source,
        color_source=color_source,
    )


def route_row(route, name, revision, digest):
    return {
        "carrier_code": route.get("carrier_code"),
        "carrier_id": route.get("carrier_id"),
        "carrier_name": route.get("carrier_name"),
        "route_code": route.get("route_code"),
        "route_id": route.get("route_id"),
        "line_code": route.get("line_code"),
        "line_id": route.get("line_id"),
        "route_number": name.route_number,
        "brand": name.brand,
        "public_name": name.public_name,
        "short_name": name.short_name,
        "long_name": name.long_name,
        "mode": name.mode,
        "color": name.color,
        "text_color": name.text_color,
        "gtfs_route_id": name.gtfs_route_id,
        "public_name_source": name.public_name_source,
        "brand_source": name.brand_source,
        "color_source": name.color_source,
        "normalization_revision": revision,
        "gtfs_digest": digest,
    }

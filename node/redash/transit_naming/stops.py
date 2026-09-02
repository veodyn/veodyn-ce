import re

from redash.transit_naming import provenance
from redash.transit_naming.snapshot import StopName

WHITESPACE = re.compile(r"\s+")
DIRECTION_PARENTHETICAL = re.compile(r"\s*\((north|south|east|west)(bound)?\)\s*$", re.IGNORECASE)
TRAILING_LINE_REFERENCE = re.compile(r"\s*-\s*Metro\s+\w+\s*-?\s*Line\s*$", re.IGNORECASE)
INTERSECTION_SPLIT = re.compile(r"\s*(?:&|/)\s*")
NAMED_PLACE = re.compile(r"park\s*&\s*ride|terminal|dock|\bbay\b|transit center|plaza|station", re.IGNORECASE)
STATION = re.compile(r"\bstation\b", re.IGNORECASE)


def _tidy(text):
    return WHITESPACE.sub(" ", (text or "").replace(" ", " ")).strip()


def normalize_part(text, rules):
    words = []
    for word in _tidy(text).split(" "):
        bare = word.rstrip(".")
        if bare in rules.keep_whole:
            words.append(bare)
            continue
        replacement = rules.suffixes.get(bare) or rules.suffixes.get(bare.capitalize())
        words.append(replacement if replacement else bare)
    return " ".join(words)


def _looks_like_street(part, rules):
    last = part.split(" ")[-1].rstrip(".") if part else ""
    return bool(part) and (last in rules.suffixes or last in rules.suffixes.values() or last in rules.keep_whole)


def _split_direction(raw, rules):
    match = DIRECTION_PARENTHETICAL.search(raw) if rules.strip_direction_parenthetical else None
    if not match:
        return raw, ""
    return raw[: match.start()].strip(), match.group(0).strip(" ()").capitalize()


def _mode(stop):
    modes = str(stop.get("transit_modes") or "").upper()
    if "RAIL" in modes:
        return "rail"
    if "BUS" in modes:
        return "bus"
    return ""


def _station(raw, rules):
    name = raw
    if rules.strip_trailing_line_reference:
        name = TRAILING_LINE_REFERENCE.sub("", name)
    name = STATION.sub("Station", name)
    return _tidy(name)


def name_stop(stop, profile):
    rules = profile.stop_name
    raw = _tidy(stop.get("stop_name"))
    mode = _mode(stop)
    retired = not str(stop.get("transit_modes") or "").strip() and int(stop.get("prediction_count") or 0) == 0
    on_street = _tidy(stop.get("on_street"))
    cross_street = _tidy(stop.get("cross_street"))
    direction = _tidy(stop.get("street_direction"))
    if mode == "rail" or STATION.search(raw):
        public_name = _station(raw, rules)
        result = StopName(
            public_name,
            "",
            "",
            direction,
            "station",
            mode,
            retired,
            provenance.RULE if public_name != raw else provenance.PASSTHROUGH,
        )
    elif on_street and cross_street:
        left, right = normalize_part(on_street, rules), normalize_part(cross_street, rules)
        result = StopName(
            f"{left}{rules.separator}{right}", left, right, direction, "intersection", mode, retired, provenance.RULE
        )
    else:
        body, parsed_direction = _split_direction(raw, rules)
        direction = direction or parsed_direction
        parts = INTERSECTION_SPLIT.split(body)
        if NAMED_PLACE.search(body):
            result = StopName(body, "", "", direction, "named_place", mode, retired, provenance.PASSTHROUGH)
        elif len(parts) == 2 and all(_looks_like_street(part, rules) for part in parts):
            left, right = normalize_part(parts[0], rules), normalize_part(parts[1], rules)
            result = StopName(
                f"{left}{rules.separator}{right}",
                left,
                right,
                direction,
                "intersection",
                mode,
                retired,
                provenance.RULE,
            )
        else:
            result = StopName(raw, "", "", direction, "unparsed", mode, retired, provenance.PASSTHROUGH)
    override = profile.override_for("stop", stop.get("stop_id"))
    if override is not None and override.public_name:
        result = StopName(
            override.public_name,
            result.on_street,
            result.cross_street,
            result.direction,
            result.stop_kind,
            mode,
            retired,
            provenance.OVERRIDE,
        )
    return result


def stop_row(stop, name, revision, digest):
    return {
        "carrier_code": stop.get("carrier_code"),
        "stop_id": stop.get("stop_id"),
        "uuid": stop.get("uuid"),
        "511_id": stop.get("511_id"),
        "public_name": name.public_name,
        "raw_name": stop.get("stop_name"),
        "on_street": name.on_street,
        "cross_street": name.cross_street,
        "direction": name.direction or None,
        "relation_to_cross_street": stop.get("relation_to_cross_street") or None,
        "stop_kind": name.stop_kind,
        "mode": name.mode,
        "retired": name.retired,
        "lat": stop.get("lat"),
        "lng": stop.get("lng"),
        "city": stop.get("city"),
        "accessible": stop.get("accessible"),
        "public_name_source": name.public_name_source,
        "normalization_revision": revision,
        "gtfs_digest": digest,
    }

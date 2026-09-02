import re

from redash.transit_naming import provenance
from redash.transit_naming.snapshot import StopName

WHITESPACE = re.compile(r"\s+")
DIRECTION_PARENTHETICAL = re.compile(r"\s*\((north|south|east|west)(bound)?\)\s*$", re.IGNORECASE)
TRAILING_LINE_REFERENCE = re.compile(r"\s*-\s*Metro\s+\w+\s*-?\s*Line\s*$", re.IGNORECASE)
INTERSECTION_SPLIT = re.compile(r"\s*(?:&|/)\s*")
NAMED_PLACE = re.compile(r"park\s*&\s*ride|terminal|dock|\bbay\b|transit center|plaza|station", re.IGNORECASE)
STATION = re.compile(r"\bstation\b", re.IGNORECASE)
ENDS_WITH_STATION = re.compile(r"\bstation\s*$", re.IGNORECASE)


def _tidy(text):
    return WHITESPACE.sub(" ", (text or "").replace(" ", " ")).strip()


def _suffix_lookup(rules):
    lookup = {value.lower(): value for value in rules.suffixes.values()}
    lookup.update({key.lower(): value for key, value in rules.suffixes.items()})
    return lookup


def normalize_part(text, rules):
    lookup = _suffix_lookup(rules)
    keep = {word.lower() for word in rules.keep_whole}
    words = []
    for word in _tidy(text).split(" "):
        bare = word.rstrip(".")
        if bare.lower() in keep:
            words.append(bare)
            continue
        words.append(lookup.get(bare.lower()) or bare)
    return " ".join(words)


def _looks_like_street(part, rules):
    if not part:
        return False
    last = part.split(" ")[-1].rstrip(".").lower()
    lookup = _suffix_lookup(rules)
    abbreviations = {value.lower() for value in rules.suffixes.values()}
    return last in lookup or last in abbreviations or last in {word.lower() for word in rules.keep_whole}


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


def _without_line_reference(text, rules):
    return _tidy(TRAILING_LINE_REFERENCE.sub("", text)) if rules.strip_trailing_line_reference else text


def _station(body, rules):
    name = STATION.sub("Station", _without_line_reference(body, rules))
    if not STATION.search(name):
        name = name + rules.station_suffix
    return _tidy(name)


def _intersection(left, right, rules, direction, mode, retired):
    left, right = normalize_part(left, rules), normalize_part(right, rules)
    public_name = f"{left}{rules.separator}{right}"
    return StopName(public_name, left, right, direction, "intersection", mode, retired, provenance.RULE)


def _from_raw(raw, body, rules, direction, mode, retired):
    parts = INTERSECTION_SPLIT.split(body)
    if len(parts) == 2 and all(_looks_like_street(part, rules) for part in parts):
        return _intersection(parts[0], parts[1], rules, direction, mode, retired)
    kind = "named_place" if NAMED_PLACE.search(body) else "unparsed"
    source = provenance.RULE if body != raw else provenance.PASSTHROUGH
    return StopName(body, "", "", direction, kind, mode, retired, source)


def name_stop(stop, profile):
    rules = profile.stop_name
    raw = _tidy(stop.get("stop_name"))
    mode = _mode(stop)
    retired = not str(stop.get("transit_modes") or "").strip() and int(stop.get("prediction_count") or 0) == 0
    on_street = _tidy(stop.get("on_street"))
    cross_street = _tidy(stop.get("cross_street"))
    body, parsed_direction = _split_direction(raw, rules)
    direction = _tidy(stop.get("street_direction")) or parsed_direction
    if mode == "rail" or ENDS_WITH_STATION.search(_without_line_reference(body, rules)):
        public_name = _station(body, rules)
        source = provenance.RULE if public_name != raw else provenance.PASSTHROUGH
        result = StopName(public_name, "", "", direction, "station", mode, retired, source)
    elif on_street and cross_street:
        result = _intersection(on_street, cross_street, rules, direction, mode, retired)
    else:
        result = _from_raw(raw, body, rules, direction, mode, retired)
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

import html
import re
from functools import lru_cache

from redash.transit_naming import provenance
from redash.transit_naming.casing import is_uppercase, recase
from redash.transit_naming.snapshot import StopName

WHITESPACE = re.compile(r"\s+")
DIRECTION_PARENTHETICAL = re.compile(r"\s*\((north|south|east|west)(bound)?\)\s*$", re.IGNORECASE)
TRAILING_LINE_REFERENCE = re.compile(r"\s*-\s*Metro\s+\w+(?:\s*(?:&|,|/|and)\s*\w+)*\s*-?\s*Lines?\s*$", re.IGNORECASE)
TRAILING_BOUND = re.compile(r"\s+(NB|SB|EB|WB)$", re.IGNORECASE)
BOUND_WORDS = {"nb": "Northbound", "sb": "Southbound", "eb": "Eastbound", "wb": "Westbound"}
NAMED_PLACE = re.compile(r"park\s*(?:&|and)\s*ride|terminal|dock|\bbay\b|transit center|plaza|station", re.IGNORECASE)
STATION = re.compile(r"\bstation\b", re.IGNORECASE)
ENDS_WITH_STATION = re.compile(r"\bstation\s*$", re.IGNORECASE)
WORD = re.compile(r"[A-Za-z0-9.]+")


def _tidy(text):
    return WHITESPACE.sub(" ", html.unescape(text or "").replace(" ", " ")).strip()


@lru_cache(maxsize=None)
def _intersection_split(split_on):
    return re.compile(r"\s*(?:" + "|".join(re.escape(char) for char in split_on) + r")\s*")


@lru_cache(maxsize=None)
def _street_separator(split_on):
    chars = [char for char in split_on if char != "&"]
    return re.compile("|".join(re.escape(char) for char in chars)) if chars else None


def _split_parts(body, rules):
    return _intersection_split(rules.split_on).split(body)


def _cased(text, rules, uppercase=None):
    return recase(_tidy(text), rules.keep_upper, uppercase, rules.split_on)


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
    if not rules.strip_direction_parenthetical:
        return raw, ""
    match = DIRECTION_PARENTHETICAL.search(raw)
    if match:
        return raw[: match.start()].strip(), match.group(0).strip(" ()").capitalize()
    bound = TRAILING_BOUND.search(raw)
    if bound and raw[: bound.start()].strip():
        return raw[: bound.start()].strip(), BOUND_WORDS[bound.group(1).lower()]
    return raw, ""


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
    left, left_direction = _split_direction(left, rules)
    right, right_direction = _split_direction(right, rules)
    direction = direction or left_direction or right_direction
    left, right = normalize_part(left, rules), normalize_part(right, rules)
    public_name = f"{left}{rules.separator}{right}"
    return StopName(public_name, left, right, direction, "intersection", mode, retired, provenance.RULE)


def _from_raw(raw, body, rules, direction, mode, retired):
    parts = _split_parts(body, rules)
    pair = len(parts) == 2 and all(parts)
    streets = pair and all(_looks_like_street(part, rules) for part in parts)
    place = bool(NAMED_PLACE.search(body))
    separator = _street_separator(rules.split_on)
    if streets or (pair and not place and separator and separator.search(body)):
        return _intersection(parts[0], parts[1], rules, direction, mode, retired)
    kind = "named_place" if place or ("&" in body and len(parts) > 1) else "unparsed"
    source = provenance.RULE if body != raw else provenance.PASSTHROUGH
    return StopName(body, "", "", direction, kind, mode, retired, source)


def _significant_words(text, rules):
    lookup = _suffix_lookup(rules)
    abbreviations = {value.lower() for value in rules.suffixes.values()}
    words = {word.rstrip(".").lower() for word in WORD.findall(text)}
    return {word for word in words if word and word not in lookup and word not in abbreviations}


def _streets_spell_the_raw_name(on_street, cross_street, raw, rules):
    raw_words = {word.rstrip(".").lower() for word in WORD.findall(raw)}
    for street in (on_street, cross_street):
        significant = _significant_words(street, rules)
        if not significant or not significant & raw_words:
            return False
    return True


def raw_street_parts(stop, rules):
    body, _ = _split_direction(_cased(stop.get("stop_name"), rules), rules)
    return [normalize_part(part, rules) for part in _split_parts(body, rules) if part]


def normalize_text(text, rules):
    lookup = _suffix_lookup(rules)
    keep = {word.lower() for word in rules.keep_whole}
    words = []
    for word in _cased(text, rules).split(" "):
        bare = word.rstrip(".")
        replacement = lookup.get(bare.lower())
        words.append(replacement if replacement and bare.lower() not in keep else word)
    return " ".join(words)


def name_stop(stop, profile):
    rules = profile.stop_name
    original = _tidy(stop.get("stop_name"))
    raw = _cased(original, rules)
    mode = _mode(stop)
    retired = not str(stop.get("transit_modes") or "").strip() and int(stop.get("prediction_count") or 0) == 0
    street_case = is_uppercase(original) if original else None
    on_street = _cased(stop.get("on_street"), rules, street_case)
    cross_street = _cased(stop.get("cross_street"), rules, street_case)
    body, parsed_direction = _split_direction(raw, rules)
    direction = _tidy(stop.get("street_direction")) or parsed_direction
    street_pair = on_street and cross_street and on_street.lower() != cross_street.lower()
    if mode == "rail" or ENDS_WITH_STATION.search(_without_line_reference(body, rules)):
        public_name = _station(body, rules)
        source = provenance.RULE if public_name != original else provenance.PASSTHROUGH
        result = StopName(public_name, "", "", direction, "station", mode, retired, source)
    elif street_pair and _streets_spell_the_raw_name(on_street, cross_street, raw, rules):
        result = _intersection(on_street, cross_street, rules, direction, mode, retired)
    else:
        result = _from_raw(original, body, rules, direction, mode, retired)
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
        "original_public_name": name.original_public_name or name.public_name,
        "suffix_completion": name.suffix_completion,
    }

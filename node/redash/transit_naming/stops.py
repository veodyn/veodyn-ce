import html
import re
from functools import lru_cache

from redash.transit_naming import provenance
from redash.transit_naming.casing import (
    capitals_are_a_minority,
    is_shouted_word,
    is_uppercase,
    recase,
)
from redash.transit_naming.directions import (
    DIRECTION_WORDS,
    bound,
    compass_point,
    spell_compass,
    split_bound,
    strip_position_notes,
)
from redash.transit_naming.snapshot import StopName
from redash.transit_naming.street_segments import (
    has_segments,
    split_note,
    street_before_a_station,
    streets_beside_landmarks,
    two_streets,
    without_la_periods,
)

WHITESPACE = re.compile(r"\s+")
TRAILING_LINE_REFERENCE = re.compile(r"\s*-\s*Metro\s+\w+(?:\s*(?:&|,|/|and)\s*\w+)*\s*-?\s*Lines?\s*$", re.IGNORECASE)
NAMED_PLACE = re.compile(r"park & ride|\b(?:terminal|dock|bay|transit center|plaza|station)\b", re.IGNORECASE)
PARK_AND_RIDE = re.compile(r"\bpark(?:\s*&\s*|(?:\s+|\s*-\s*)(?:and|n|'n')(?:\s+|\s*-\s*))ride\b", re.IGNORECASE)
SPACED_SLASH = re.compile(r"\s*[/\\]\s*")
BUS_STOP = re.compile(r"\bbus stop\b", re.IGNORECASE)
BETWEEN = re.compile(r"\bbetween\b", re.IGNORECASE)
STATION = re.compile(r"\bstation\b", re.IGNORECASE)
ENDS_WITH_STATION = re.compile(r"\bstation\s*$", re.IGNORECASE)
WORD = re.compile(r"[A-Za-z0-9.]+")
UPPERCASE_WORD = re.compile(r"\b[A-Z]{2,}\b")
SHOUTED_WORD = re.compile(r"\b[A-Z]{4,}\b")
DESIGNATOR = re.compile(r"^(?:\d+[A-Za-z]?|[A-Z](?:-\d+)?)$")


def _tidy(text):
    return WHITESPACE.sub(" ", html.unescape(text or "").replace(" ", " ")).strip()


def _separator_pattern(chars, words):
    alternatives = [r"\s*(?:" + "|".join(re.escape(char) for char in chars) + r")\s*"] if chars else []
    if words:
        alternatives.append(r"\s+(?:" + "|".join(re.escape(word) for word in words) + r")\s+")
    return re.compile("|".join(alternatives), re.IGNORECASE) if alternatives else None


@lru_cache(maxsize=None)
def _intersection_split(split_on, split_words):
    return _separator_pattern(split_on, split_words)


@lru_cache(maxsize=None)
def _street_separator(split_on, split_words, ampersand_joins_streets):
    chars = [char for char in split_on if ampersand_joins_streets or char != "&"]
    return _separator_pattern(chars, split_words)


def _split_parts(body, rules):
    return _intersection_split(rules.split_on, rules.split_words).split(body)


def _cased(text, rules, uppercase=None):
    cased = recase(_tidy(text), rules.keep_upper, uppercase, rules.split_on)
    return without_la_periods(PARK_AND_RIDE.sub("Park & Ride", cased))


def _street_casing(original, rules):
    uppercase = is_uppercase(original) if original else None
    if uppercase is not False:
        return uppercase, None
    recased = capitals_are_a_minority(original)
    capitals = UPPERCASE_WORD.findall(original)
    kept = {word for word in capitals if not (recased and is_shouted_word(word, rules.keep_upper))}
    return uppercase, frozenset(kept) | rules.keep_upper


def _street_cased(text, rules, casing):
    uppercase, kept = casing
    cased = _cased(text, rules, uppercase)
    if kept is None:
        return cased
    return SHOUTED_WORD.sub(
        lambda match: match.group(0) if match.group(0) in kept else match.group(0).capitalize(), cased
    )


def _suffix_lookup(rules):
    lookup = {value.lower(): value for value in rules.suffixes.values()}
    lookup.update({key.lower(): value for key, value in rules.suffixes.items()})
    return lookup


def _suffix_positions(words):
    last = len(words) - 1
    while last > 0 and words[last].rstrip(".").lower() in DIRECTION_WORDS:
        last -= 1
    designated = {i for i in range(len(words) - 1) if DESIGNATOR.match(words[i + 1].rstrip("."))}
    return designated | {last}


def normalize_part(text, rules):
    lookup = _suffix_lookup(rules)
    keep = {word.lower() for word in rules.keep_whole}
    words = _tidy(text).split(" ")
    positions = _suffix_positions(words)
    normalized = []
    for i, word in enumerate(words):
        bare = word.rstrip(".")
        key = bare.lower()
        designation = key in lookup or key in rules.spell_out or key in DIRECTION_WORDS
        if key in keep or i not in positions:
            normalized.append(bare if designation or key in keep else word)
            continue
        normalized.append(lookup.get(key) or rules.spell_out.get(key) or bare)
    spelled = spell_compass(normalized, lambda word: word.lower() in lookup, rules.trailing_compass == "street")
    return " ".join(spelled)


def _split_trailing_letter(raw, rules):
    words = raw.split(" ")
    if rules.trailing_compass != "direction" or len(words) < 2 or not compass_point(words[-1]):
        return raw, ""
    last_part = _split_parts(raw, rules)[-1].split(" ")
    if len(last_part) == 2 and last_part[0].rstrip(".").lower() in _suffix_lookup(rules):
        return raw, ""
    return " ".join(words[:-1]), bound(words[-1])


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
    body, direction = split_bound(raw)
    return (body, direction) if direction else _split_trailing_letter(raw, rules)


def _mode(stop):
    modes = str(stop.get("transit_modes") or "").upper()
    if "RAIL" in modes:
        return "rail"
    if "BUS" in modes:
        return "bus"
    return ""


def _without_line_reference(text, rules):
    return _tidy(TRAILING_LINE_REFERENCE.sub("", text)) if rules.strip_trailing_line_reference else text


def _tight_separators(text, rules):
    return SPACED_SLASH.sub(rules.separator, text)


def _station(body, rules):
    name = STATION.sub("Station", _without_line_reference(body, rules))
    if not STATION.search(name) and not BUS_STOP.search(name):
        name = name + rules.station_suffix
    return street_before_a_station(_tight_separators(_tidy(name), rules), lambda part: _normalize_street(part, rules))


def _guide_streets(text, rules):
    return streets_beside_landmarks(
        text, lambda piece: normalize_part(piece, rules), lambda word: word.lower() in _suffix_lookup(rules)
    )


def _normalize_street(part, rules):
    words = [word.capitalize() if is_shouted_word(word, rules.keep_upper) else word for word in part.split(" ")]
    normalized = normalize_part(" ".join(words), rules)
    return _guide_streets(normalized, rules) if has_segments(normalized) else normalized


def _intersection(left, right, rules, direction, mode, retired):
    left, left_direction = _split_direction(left, rules)
    right, right_direction = _split_direction(right, rules)
    direction = direction or left_direction or right_direction
    left, right = _normalize_street(left, rules), _normalize_street(right, rules)
    public_name = f"{left}{rules.separator}{right}"
    return StopName(public_name, left, right, direction, "intersection", mode, retired, provenance.RULE)


def _from_raw(raw, body, rules, direction, mode, retired):
    parts = _split_parts(body, rules)
    pair = len(parts) == 2 and all(parts)
    streets = pair and all(_looks_like_street(part, rules) for part in parts)
    place = bool(NAMED_PLACE.search(body))
    separator = _street_separator(rules.split_on, rules.split_words, rules.ampersand_joins_streets)
    if not BETWEEN.search(body) and (streets or (pair and not place and separator and separator.search(body))):
        return _intersection(parts[0], parts[1], rules, direction, mode, retired)
    core, note = split_note(body)
    joined = None if BETWEEN.search(core) else two_streets(core, lambda part: _looks_like_street(part, rules))
    if joined:
        return _intersection(joined[0], joined[1] + note, rules, direction, mode, retired)
    kind = "named_place" if place or ("&" in body and len(parts) > 1) else "unparsed"
    public_name = _guide_streets(_tight_separators(body, rules), rules)
    source = provenance.RULE if public_name != raw else provenance.PASSTHROUGH
    return StopName(public_name, "", "", direction, kind, mode, retired, source)


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
    raw = _cased(strip_position_notes(original), rules)
    mode = _mode(stop)
    retired = not str(stop.get("transit_modes") or "").strip() and int(stop.get("prediction_count") or 0) == 0
    casing = _street_casing(original, rules)
    on_street = _street_cased(stop.get("on_street"), rules, casing)
    cross_street = _street_cased(stop.get("cross_street"), rules, casing)
    body, parsed_direction = _split_direction(raw, rules)
    direction = bound(_tidy(stop.get("street_direction"))) or parsed_direction
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
            original_public_name=result.public_name,
        )
    return result

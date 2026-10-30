import re
from dataclasses import dataclass
from math import isfinite

STREET = "STREET"
ADDRESS = "ADDRESS"
STATION = "STATION"
LANDMARK = "LANDMARK"

PARK_AND_RIDE = "Park & Ride"
PARK_AND_RIDE_TOKEN = "Park\u0000Ride"
HARD_JOIN = re.compile(r"(\s*[/\\&@+]\s*|\s*-\s+|\s+-\s*|(?<=[a-z]{2})-(?=[A-Z][a-z]))")
WORD_JOIN = re.compile(r"(\s+(?:between|opposite|near|after|before|and|at|opp)\s+)", re.IGNORECASE)
PARENTHESES = re.compile(r"\(([^()]*)\)")
TRAILING_NOTE = re.compile(r"\s*\([^()]*\)\s*$")
INTERSECTION_JOINS = frozenset({"/", "\\", "&", "@", "+", "and", "at"})
LOWERCASE_JOINS = frozenset({"and", "at", "between", "near", "opposite", "opp", "after", "before"})
GUIDE_DESIGNATIONS = frozenset(
    {"street", "st", "str", "avenue", "ave", "av", "boulevard", "blvd", "bl", "drive", "dr", "road", "rd"}
    | {"circle", "cir", "terrace", "ter", "terr", "way", "wy"}
)
NAMED_PREFIXES = frozenset({"avenida", "via", "calle", "camino", "paseo"})
NUMBERED_PREFIXES = frozenset(
    {"avenue", "ave", "av", "route", "rt", "hwy", "highway", "interstate", "state", "us", "sr"}
)
DESIGNATOR = re.compile(r"^(?:\d+[A-Za-z]?|[A-Z](?:-\d+)?)$")
COMPASS = frozenset({"n", "s", "e", "w", "north", "south", "east", "west"})
ORDINAL = re.compile(r"^\d+(?:st|nd|rd|th)$", re.IGNORECASE)
HOUSE_NUMBER = re.compile(r"^\d+[A-Za-z]?$")
STATION_END = re.compile(r"\b(?:station|transit center|bus center|transit plaza|terminal)\s*$", re.IGNORECASE)
NUMBERED_COMPASS_PERIOD = re.compile(r"^(\d+[A-Za-z]?\s+[NSEW])\.(?=\s)")
ACRONYM_PERIODS = re.compile(r"\b(?:[A-Z]\.){2,}(?=\s|$|[/,)\-])")


@dataclass(frozen=True)
class Evidence:
    suffixes: frozenset
    keep_whole: frozenset
    abbreviations: frozenset = frozenset()
    knows: object = None

    def is_street(self, text):
        words = [word.rstrip(".,") for word in text.split()]
        if len(words) >= 3 and words[0].lower() in COMPASS:
            words = words[1:]
        if len(words) >= 3 and words[-1].lower() in COMPASS:
            words = words[:-1]
        if not words:
            return False
        first, last = words[0].lower(), words[-1].lower()
        if last in self.keep_whole:
            return True
        if len(words) >= 2 and last in GUIDE_DESIGNATIONS:
            return True
        if len(words) >= 2 and last in self.abbreviations:
            return True
        if len(words) >= 2 and last in self.suffixes:
            return self.knows is not None and self.knows(text)
        if len(words) >= 2 and first in NAMED_PREFIXES:
            return True
        if len(words) >= 2 and first in NUMBERED_PREFIXES and DESIGNATOR.match(words[1]):
            return True
        if ORDINAL.match(words[-1]) and (len(words) == 1 or (len(words) == 2 and first in COMPASS)):
            return True
        return self.knows is not None and self.knows(text)

    def kind(self, text):
        text = text.strip()
        if STATION_END.search(text):
            return STATION
        words = text.split()
        if len(words) >= 2 and HOUSE_NUMBER.match(words[0]) and self.is_street(" ".join(words[1:])):
            return ADDRESS
        return STREET if self.is_street(text) else LANDMARK


def split_note(text):
    match = TRAILING_NOTE.search(text)
    if not match or not text[: match.start()].strip():
        return text, ""
    return text[: match.start()], " " + match.group(0).strip()


def _word_split(chunk, evidence):
    pieces = WORD_JOIN.split(chunk)
    out = []
    i = 0
    while i < len(pieces):
        end = i
        if not evidence.is_street(pieces[i]):
            for j in range(len(pieces) - 1, i, -2):
                joins = {pieces[k].strip().lower() for k in range(i + 1, j, 2)}
                if joins == {"and"} and evidence.is_street("".join(pieces[i : j + 1])):
                    end = j
                    break
        out.append("".join(pieces[i : end + 1]))
        if end + 1 < len(pieces):
            out.append(pieces[end + 1])
        i = end + 2
    return out


def tokenize(text, evidence):
    protected = re.sub(r"park\s*&\s*ride", PARK_AND_RIDE_TOKEN, text, flags=re.IGNORECASE)
    tokens = []
    for i, chunk in enumerate(HARD_JOIN.split(protected)):
        if i % 2:
            tokens.append(chunk)
            continue
        tokens.extend(_word_split(chunk, evidence))
    return [token.replace(PARK_AND_RIDE_TOKEN, PARK_AND_RIDE) for token in tokens]


def shape(tokens, evidence):
    return " ".join(
        evidence.kind(token) if i % 2 == 0 else (token.strip().lower() or "-") for i, token in enumerate(tokens)
    )


def two_streets(text, evidence):
    core, note = split_note(text)
    tokens = tokenize(core, evidence)
    if len(tokens) != 3 or tokens[1].strip().lower() not in INTERSECTION_JOINS:
        return None
    left, right = tokens[0].strip(), tokens[2].strip()
    if left and right and evidence.kind(left) == STREET and evidence.kind(right) == STREET:
        return left, right + note
    return None


def _join(token):
    word = token.strip()
    return token.replace(word, word.lower()) if word.lower() in LOWERCASE_JOINS else token


def _address(core, normalize):
    words = normalize(core).split(" ")
    if len(words) >= 3 and words[1].lower() in ("north", "south", "east", "west"):
        words[1] = words[1][0].upper()
    return " ".join(words)


def station_segments(tokens, evidence):
    protected = set()
    for position, token in enumerate(tokens[::2]):
        if evidence.kind(token.strip()) != STATION:
            continue
        protected.add(position)
        while position > 0 and tokens[2 * position - 1].strip() in ("/", "\\"):
            position -= 1
            protected.add(position)
    return protected


def render_parentheses(text, evidence, normalize):
    return PARENTHESES.sub(lambda match: f"({station_name(match.group(1), evidence, normalize)})", text)


def render(text, evidence, normalize):
    body, note = split_note(text)
    return render_parentheses(_render_tokens(body, evidence, normalize) + note, evidence, normalize)


def _render_segment(token, evidence, normalize):
    lead = token[: len(token) - len(token.lstrip())]
    trail = token[len(token.rstrip()) :]
    core = NUMBERED_COMPASS_PERIOD.sub(r"\1", token.strip())
    kind = evidence.kind(core)
    rendered = _address(core, normalize) if kind == ADDRESS else normalize(core) if kind == STREET else core
    return lead + rendered + trail


def _render_tokens(text, evidence, normalize):
    tokens = tokenize(text, evidence)
    out = []
    for i, token in enumerate(tokens):
        if i % 2:
            out.append(_join(token))
            continue
        out.append(_render_segment(token, evidence, normalize))
    return "".join(out)


def station_name(name, evidence, normalize):
    tokens = tokenize(name, evidence)
    protected = station_segments(tokens, evidence)
    out = []
    for i, token in enumerate(tokens):
        if i % 2:
            out.append(_join(token))
        elif i // 2 not in protected:
            out.append(_render_segment(token, evidence, normalize))
        else:
            out.append(token)
    return "".join(out)


def without_acronym_periods(text):
    return ACRONYM_PERIODS.sub(lambda match: match.group(0).replace(".", ""), text)


def stop_evidence(stop, profile):
    rules = profile.stop_name
    suffixes = frozenset(word.lower() for pair in rules.suffixes.items() for word in pair)
    keep_whole = frozenset(word.lower() for word in rules.keep_whole)
    abbreviations = frozenset(value.lower() for value in rules.suffixes.values())
    reference = rules.street_reference
    try:
        lat, lng = float(stop.get("lat")), float(stop.get("lng"))
    except (TypeError, ValueError):
        return Evidence(suffixes, keep_whole, abbreviations)
    if not (isfinite(lat) and isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
        return Evidence(suffixes, keep_whole, abbreviations)
    if profile.streets is None or reference is None:
        return Evidence(suffixes, keep_whole, abbreviations)

    def knows(text):
        return profile.streets.knows(text, lat, lng, reference.within_m)

    return Evidence(suffixes, keep_whole, abbreviations, knows)

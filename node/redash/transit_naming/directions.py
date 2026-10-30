import re

DIRECTION_WORDS = frozenset(
    {"n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west"}
    | {"nb", "sb", "eb", "wb", "northbound", "southbound", "eastbound", "westbound"}
)
BOUNDS = {"n": "Northbound", "s": "Southbound", "e": "Eastbound", "w": "Westbound"}
BOUND_BY_KEY = {
    key: word
    for letter, word in BOUNDS.items()
    for key in (letter, letter + "b", word.lower(), word.lower().removesuffix("bound"))
}
BOUND_MARKERS = (
    re.compile(
        r"\s*\(\s*(?P<bound>north|south|east|west|[nsew]\s*/?\s*b)(?:bound)?(?:\s+direction)?\s*\)\s*$",
        re.IGNORECASE,
    ),
    re.compile(r"\s+(?P<bound>[NSEW]/?B|(?:north|south|east|west)bound)$", re.IGNORECASE),
    re.compile(r"^(?P<bound>[NSEW]/?B|(?:north|south|east|west)bound)\s+", re.IGNORECASE),
    re.compile(r"\s+(?P<bound>[NSEW]/?B|(?:north|south|east|west)bound)(?=\s*\([^()]*\)\s*$)", re.IGNORECASE),
)
COMPASS_POINTS = {letter: word.removesuffix("bound") for letter, word in BOUNDS.items()}
POSITION_NOTE = re.compile(
    r"\s*-?\s*(?:\b[NS]\s*/\s*(?:[EW](?:\s+[Cc][A-Za-z]*)?)?|\b(?:NE|NW|SE|SW)(?:\s+[Cc]or(?:ner)?)?"
    r"|-\s*[NS][EWew]?\b|\(\s*(?:NE|NW|SE|SW|C?CW|\d+)\s*\)|-)\s*$"
)


def strip_position_notes(raw):
    stripped = raw
    while (shorter := POSITION_NOTE.sub("", stripped)) != stripped and shorter.strip():
        stripped = shorter
    return stripped


def compass_point(word):
    return COMPASS_POINTS.get(word.rstrip(".").lower())


def spell_compass(words, is_suffix, spell_trailing):
    spelled = list(words)
    lettered_street = len(words) == 2 and is_suffix(words[1])
    if len(words) >= 2 and compass_point(words[0]) and not lettered_street:
        spelled[0] = compass_point(words[0])
    if spell_trailing and len(words) >= 3 and compass_point(words[-1]) and is_suffix(words[-2]):
        spelled[-1] = compass_point(words[-1])
    return spelled


def bound(text):
    stripped = (text or "").strip()
    return BOUND_BY_KEY.get(re.sub(r"[\s/.]", "", stripped).lower(), stripped)


def split_bound(raw):
    for marker in BOUND_MARKERS:
        match = marker.search(raw)
        body = (raw[: match.start()] + " " + raw[match.end() :]).strip() if match else ""
        if match and body:
            return " ".join(body.split()), bound(match.group("bound"))
    return raw, ""

import re

from redash.transit_naming.directions import compass_point

STREET_JOIN = re.compile(r"\s*(?:&|@|\+)\s*|\s+(?:and|at)\s+", re.IGNORECASE)
SEGMENT_BOUNDARY = re.compile(
    r"(\s*[/&@+(),]\s*|\s*-\s+|(?<=[a-z]{2})-(?=[A-Z][a-z])|\s+(?:and|at|between|near|opposite|opp|after|before)\s+)",
    re.IGNORECASE,
)
GUIDE_DESIGNATIONS = frozenset(
    {"street", "st", "str", "avenue", "ave", "av", "boulevard", "blvd", "bl", "drive", "dr", "road", "rd"}
    | {"circle", "cir", "terrace", "ter", "terr", "way", "wy"}
)
LEADING_COMPASS = re.compile(r"^(\s*)([NSEW])\.?\s+(?=[A-Z0-9][A-Za-z0-9]*(?:\s|$))")
STATION_JOIN = re.compile(r"\s+(?:&|and|@|at)\s+", re.IGNORECASE)
PREFIX_DESIGNATIONS = frozenset(
    {"avenue", "ave", "av", "avenida", "via", "calle", "camino", "paseo", "route", "rt", "hwy"}
)
TRAVEL_MARKERS = frozenset({"nb", "sb", "eb", "wb"})
ORDINAL = re.compile(r"^\d+(?:st|nd|rd|th)$", re.IGNORECASE)
TRAILING_NOTE = re.compile(r"\s*\([^()]*\)\s*$")
LOS_ANGELES_INITIALS = re.compile(r"\bL\.\s?A\.(?=\s|$|[/,)])")


def split_note(text):
    match = TRAILING_NOTE.search(text)
    if not match or not text[: match.start()].strip():
        return text, ""
    return text[: match.start()], " " + match.group(0).strip()


def has_segments(text):
    return bool(SEGMENT_BOUNDARY.search(text))


def two_streets(body, is_street):
    body, _ = split_note(body)
    parts = [part.strip() for part in STREET_JOIN.split(body)]
    if "/" in body or "\\" in body:
        return None
    if len(parts) == 2 and all(parts) and all(is_street(part) for part in parts):
        return parts
    return None


def _ends_in_a_guide_designation(piece):
    words = piece.split()
    return len(words) >= 2 and words[-1].rstrip(".").lower() in GUIDE_DESIGNATIONS


def _spell_leading_compass(piece, is_designation):
    match = LEADING_COMPASS.match(piece)
    if not match:
        return piece
    rest = piece[match.end() :].split()
    while len(rest) > 1 and rest[-1].lower() in TRAVEL_MARKERS:
        rest = rest[:-1]
    street = (
        (len(rest) == 1 and ORDINAL.match(rest[0]))
        or (len(rest) >= 2 and is_designation(rest[-1].rstrip(".")))
        or (len(rest) >= 2 and rest[0].rstrip(".").lower() in PREFIX_DESIGNATIONS)
    )
    if not street:
        return piece
    return f"{match.group(1)}{compass_point(match.group(2))} {piece[match.end():]}"


def streets_beside_landmarks(text, normalize, is_designation=lambda word: False):
    pieces = SEGMENT_BOUNDARY.split(text)
    out = []
    for i, piece in enumerate(pieces):
        if i % 2 == 0 and _ends_in_a_guide_designation(piece):
            piece = normalize(piece)
        elif i % 2 == 0 and not (i > 0 and pieces[i - 1].strip() == "("):
            piece = _spell_leading_compass(piece, is_designation)
        out.append(piece)
    return "".join(out)


def street_before_a_station(name, normalize):
    match = STATION_JOIN.search(name)
    if not match:
        return name
    return normalize(name[: match.start()]) + name[match.start() :]


def without_la_periods(text):
    return LOS_ANGELES_INITIALS.sub("LA", text)

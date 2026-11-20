import json
import logging
import re
from dataclasses import replace

from redash.transit_naming.casing import recase
from redash.transit_naming.directions import BOUND_BY_KEY, split_bound
from redash.transit_naming.patterns import mca_pattern_membership
from redash.transit_naming.routes import parse_route_number

DASH_RUN = re.compile(r"\s*-{2,}\s*")
DESTINATION_WORDS = "(?:via|to|from|and)"
LEADING_TO = re.compile(r"^to\s+", re.IGNORECASE)
logger = logging.getLogger(__name__)


def _without_route_designation(text, route_code):
    number = parse_route_number(route_code, route_code[:2])
    if not number:
        return text
    prefix = rf"(?:(?:(?!{DESTINATION_WORDS}\b)[A-Za-z]+\s+){{0,3}}?(?:bus|line|route)\s+)?"
    stripped = re.sub(rf"^{prefix}0*{re.escape(number)}\b[\s:-]*", "", text, count=1, flags=re.IGNORECASE)
    return stripped or text


def pattern_headsign(name, route_code, brand, keep_upper=frozenset()):
    text = " ".join(str(name or "").split())
    if not text or text.replace(" ", "").upper() == str(route_code).replace(" ", "").upper():
        return ""
    text = DASH_RUN.sub(" - ", recase(text, keep_upper))
    if brand and text.lower().startswith(brand.lower() + " "):
        text = text[len(brand) + 1 :]
    text = _without_route_designation(text, str(route_code))
    if re.sub(r"[\s/.]", "", text).lower() in BOUND_BY_KEY:
        return ""
    body, direction = split_bound(text)
    text = body if direction else text
    text = " ".join(LEADING_TO.sub("", text).split())
    return text[:1].upper() + text[1:]


def _headsign(pattern, route_code, profile):
    return pattern_headsign(
        pattern.get("pattern_name"), route_code, profile.carrier_display_name, profile.stop_name.keep_upper
    )


def route_pattern_codes(fetch, carrier_code, route_code, profile):
    configured = profile.pattern_codes.get(route_code, ())
    if configured:
        return [(code, "") for code in configured]
    found = []
    seen = set()
    for pattern in fetch("patterns", {"carrier_code": carrier_code, "route_code": route_code}):
        code = str(pattern.get("pattern_code") or "").strip()
        if not code or code in seen or str(pattern.get("route_code")) != str(route_code):
            continue
        seen.add(code)
        found.append((code, _headsign(pattern, route_code, profile)))
    return found


def _lines_served(stop):
    raw = stop.get("lines_served")
    try:
        lines = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError as error:
        logger.warning("Stop %s has unreadable lines_served: %s", stop.get("stop_id"), error)
        return []
    return [line for line in lines if isinstance(line, dict)] if isinstance(lines, list) else []


def _serves(stop, route_number):
    return any(
        parse_route_number(str(line.get("line_short_name") or ""), "") == route_number for line in _lines_served(stop)
    )


def stops_serving_route(route_code, profile, live, names, sources):
    number = parse_route_number(str(route_code), profile.carrier_code)
    served = [stop for stop in live.values() if number and _serves(stop, number)]
    return [
        replace(stop, sequence_source="mca_lines_served")
        for stop in mca_pattern_membership(profile.carrier_code, route_code, str(route_code), served, names, sources)
    ]


def mca_route_patterns(fetch, carrier_code, route_code, profile, live, names, sources):
    rows = []
    for code, headsign in route_pattern_codes(fetch, carrier_code, route_code, profile):
        members = fetch("stops", {"carrier_code": carrier_code, "pattern_code": code})
        served = [member for member in members if str(member.get("stop_id")) in live]
        rows.extend(
            replace(stop, headsign=headsign)
            for stop in mca_pattern_membership(profile.carrier_code, route_code, code, served, names, sources)
        )
    return rows or stops_serving_route(route_code, profile, live, names, sources)

from dataclasses import replace

from redash.transit_naming.casing import recase
from redash.transit_naming.patterns import mca_pattern_membership


def _headsign(pattern, route_code, keep_upper):
    name = str(pattern.get("pattern_name") or "").strip()
    if not name or name.upper() == str(route_code).upper():
        return ""
    return recase(name, keep_upper)


def route_pattern_codes(fetch, carrier_code, route_code, profile):
    configured = profile.pattern_codes.get(route_code, ())
    if configured:
        return [(code, "") for code in configured]
    keep_upper = profile.stop_name.keep_upper
    found = []
    seen = set()
    for pattern in fetch("patterns", {"carrier_code": carrier_code, "route_code": route_code}):
        code = str(pattern.get("pattern_code") or "").strip()
        if not code or code in seen or str(pattern.get("route_code")) != str(route_code):
            continue
        seen.add(code)
        found.append((code, _headsign(pattern, route_code, keep_upper)))
    return found


def mca_route_patterns(fetch, carrier_code, route_code, profile, live, names, sources):
    rows = []
    for code, headsign in route_pattern_codes(fetch, carrier_code, route_code, profile):
        members = fetch("stops", {"carrier_code": carrier_code, "pattern_code": code})
        served = [member for member in members if str(member.get("stop_id")) in live]
        rows.extend(
            replace(stop, headsign=headsign)
            for stop in mca_pattern_membership(profile.carrier_code, route_code, code, served, names, sources)
        )
    return rows

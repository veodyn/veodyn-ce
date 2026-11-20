import logging
import re
from collections import defaultdict

from redash.transit_naming.coordinates import finite_point, meters_between
from redash.transit_naming.locations import location_rows, stop_511_id
from redash.transit_naming.merge_candidates import merge_candidate_rows

logger = logging.getLogger(__name__)

PLACE_COLUMNS = (
    "value",
    "name",
    "place",
    "keys",
    "public_name",
    "names",
    "providers",
    "member_stops",
    "provider_stop_ids",
    "lat",
    "lng",
    "stop_kind",
    "normalization_revision",
)
STATION_KINDS = frozenset({"station", "named_place"})
STATION_RADIUS_M = 300.0
MIN_STATION_NAME = 6
MAX_PLACE_STOPS = 40
MAX_PLACE_VALUE = 200
PARENTHETICAL = re.compile(r"\(.*?\)")
STATION_SUFFIX = re.compile(
    r"\s*(?:-\s*)?\b(?:upper|lower|level|bay|bays|platform|track|gate|stop|plaza|bus|lot)\b.*$"
)
ABBREVIATED_STATION = re.compile(r"\bsta\b\.?")
NOT_WORD = re.compile(r"[^a-z0-9 ]+")


def stop_key(stop):
    return f"{stop['carrier_code']}:{stop['stop_id']}"


def station_name(name):
    text = PARENTHETICAL.sub(" ", str(name or "").lower()).split(" - ")[0]
    text = ABBREVIATED_STATION.sub("station", STATION_SUFFIX.sub("", text))
    return " ".join(NOT_WORD.sub(" ", text).split())


class _Groups:
    def __init__(self):
        self.parent = {}

    def find(self, node):
        self.parent.setdefault(node, node)
        while self.parent[node] != node:
            self.parent[node] = self.parent[self.parent[node]]
            node = self.parent[node]
        return node

    def join(self, first, second):
        self.parent[self.find(first)] = self.find(second)


def _join_stations(stops, groups):
    by_name = defaultdict(list)
    for stop in stops:
        name = station_name(stop.get("public_name")) if stop.get("stop_kind") in STATION_KINDS else ""
        point = finite_point(stop, "lat", "lng")
        if len(name) >= MIN_STATION_NAME and point is not None:
            by_name[name].append((stop, point))
    for members in by_name.values():
        for index, (stop, point) in enumerate(members):
            for other, other_point in members[index + 1 :]:
                if stop["carrier_code"] == other["carrier_code"]:
                    continue
                if meters_between(*point, *other_point) <= STATION_RADIUS_M:
                    groups.join(stop_key(stop), stop_key(other))


def group_stops(stops):
    groups = _Groups()
    by_key = {}
    for stop in stops:
        key = stop_key(stop)
        by_key[key] = stop
        groups.find(key)
        if stop_511_id(stop):
            groups.join(key, "511:" + stop_511_id(stop))
    for row in merge_candidate_rows(stops, {}):
        groups.join(f"{row['carrier_a']}:{row['stop_id_a']}", f"{row['carrier_b']}:{row['stop_id_b']}")
    _join_stations(stops, groups)
    grouped = defaultdict(list)
    for key, stop in by_key.items():
        grouped[groups.find(key)].append(stop)
    return [sorted(members, key=stop_key) for members in grouped.values()]


def _unique(values):
    return list(dict.fromkeys(value for value in values if value))


def place_value(members):
    by_carrier = defaultdict(list)
    for stop in members:
        by_carrier[str(stop["carrier_code"])].append(str(stop["stop_id"]))
    return ",".join(f"{carrier}:{'|'.join(_unique(ids))}" for carrier, ids in sorted(by_carrier.items()))


def _fitting(members, place):
    kept = [stop for stop in members if not stop.get("retired")] if len(members) > MAX_PLACE_STOPS else members
    while kept and (len(kept) > MAX_PLACE_STOPS or len(place_value(kept)) > MAX_PLACE_VALUE):
        kept = kept[:-1]
    if len(kept) < len(members):
        logger.warning("Place %s keeps %d of its %d stops to fit a public parameter", place, len(kept), len(members))
    return kept or members[:1]


def _representative(members, located):
    stations = [stop for stop in members if stop.get("stop_kind") == "station"]
    if stations:
        return min(stations, key=lambda stop: (len(str(stop.get("public_name") or "")), stop_key(stop))), None
    for stop in members:
        location = located.get(stop_511_id(stop))
        if location is not None:
            return stop, location
    return members[0], None


def _place_row(members, located, provider_of, revision):
    ids = sorted(_unique(stop_511_id(stop) for stop in members))
    loose = [stop_key(stop) for stop in members if not stop_511_id(stop)]
    place = ids[0] if ids else loose[0]
    stop, location = _representative(members, located)
    anchor = location or stop
    public_name = (location or {}).get("public_name") or stop.get("public_name") or ""
    providers = ", ".join(_unique(provider_of(str(member["carrier_code"])) for member in members))
    value = place_value(_fitting(members, place))
    return {
        "value": value,
        "name": f"{public_name} ({providers})" if providers else public_name,
        "place": place,
        "keys": ";".join(ids + loose),
        "public_name": public_name,
        "names": "; ".join(_unique(member.get("public_name") for member in members)),
        "providers": providers,
        "member_stops": value,
        "provider_stop_ids": ", ".join(_unique(str(member["stop_id"]) for member in members)),
        "lat": anchor.get("lat"),
        "lng": anchor.get("lng"),
        "stop_kind": stop.get("stop_kind"),
        "normalization_revision": revision,
    }


def place_rows(stops, profiles, provider_of):
    located = {row["511_id"]: row for row in location_rows(stops, profiles, {})}
    rows = [_place_row(members, located, provider_of, profiles.revision) for members in group_stops(stops)]
    return sorted(rows, key=lambda row: row["place"])

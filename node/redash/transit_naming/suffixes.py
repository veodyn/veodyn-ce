import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass, replace
from math import asin, cos, isfinite, radians, sin, sqrt
from urllib.parse import urlsplit

import redis

from redash.transit_naming import provenance
from redash.transit_naming.stops import name_stop, raw_street_parts

INDEX_TTL_SECONDS = 6 * 3600
DIRECTION_WORDS = frozenset(
    {"n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west"}
    | {"nb", "sb", "eb", "wb", "northbound", "southbound", "eastbound", "westbound"}
)
SAME_INTERSECTION = "same_intersection"
UNIQUE_STREET = "unique_street"
EARTH_RADIUS_M = 6_371_000


@dataclass(frozen=True)
class Decision:
    suffix: str = ""
    method: str = ""
    abstained: str = ""


def source_hash(base_url, api_key):
    parts = urlsplit(str(base_url or "").strip())
    endpoint = f"{parts.scheme.lower()}://{parts.netloc.lower()}{parts.path.rstrip('/')}?{parts.query}"
    return hashlib.sha256(f"{endpoint}\x00{api_key or ''}".encode()).hexdigest()


def index_key(carrier, revision, source):
    return f"transit-naming:suffix-index:{carrier}:{revision}:{source}"


def _meters(lat_a, lng_a, lat_b, lng_b):
    d_lat, d_lng = radians(lat_b - lat_a), radians(lng_b - lng_a)
    haversine = sin(d_lat / 2) ** 2 + cos(radians(lat_a)) * cos(radians(lat_b)) * sin(d_lng / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(haversine))


def _coordinates(stop):
    try:
        lat, lng = float(stop["lat"]), float(stop["lng"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (isfinite(lat) and isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def classify(part, rules):
    abbreviations = {value.lower() for value in rules.suffixes.values()}
    keep = {word.lower() for word in rules.keep_whole}
    words = [word.rstrip(".") for word in part.split(" ") if word]
    if not words:
        return "empty", "", ""
    last = words[-1].lower()
    if last in DIRECTION_WORDS:
        return "direction", part.lower(), ""
    if last in keep:
        return "whole", part.lower(), ""
    if last in abbreviations:
        if len(words) == 1 or any(word.lower() in abbreviations for word in words[:-1]):
            return "invalid", part.lower(), ""
        return "suffixed", " ".join(words[:-1]).lower(), words[-1]
    return "bare", part.lower(), ""


def _eligible_coordinates(stop, name):
    if name.stop_kind != "intersection" or name.retired or name.public_name_source == provenance.OVERRIDE:
        return None
    return _coordinates(stop)


def _maps_one_to_one(name_bases, raw_bases):
    return name_bases == raw_bases or name_bases == raw_bases[::-1]


def donor_entries(stops, profile):
    rules = profile.stop_name
    entries = []
    for stop in stops:
        name = name_stop(stop, profile)
        coordinates = _eligible_coordinates(stop, name)
        raw = raw_street_parts(stop, rules)
        if coordinates is None or len(raw) != 2:
            continue
        parts = [classify(part, rules) for part in (name.on_street, name.cross_street)]
        raw_bases = [classify(part, rules)[1] for part in raw]
        if not _maps_one_to_one([part[1] for part in parts], raw_bases):
            continue
        suffixes = [part[2] if part[0] == "suffixed" else "" for part in parts]
        if any(suffixes):
            entries.append((parts[0][1], parts[1][1], suffixes[0], suffixes[1], *coordinates))
    return entries


class SuffixIndex:
    def __init__(self, entries):
        self.entries = [tuple(entry) for entry in entries]
        self.by_pair = defaultdict(list)
        self.by_base = defaultdict(list)
        for base_a, base_b, suffix_a, suffix_b, lat, lng in self.entries:
            pair = tuple(sorted((base_a, base_b)))
            for base, suffix in ((base_a, suffix_a), (base_b, suffix_b)):
                if suffix:
                    self.by_pair[pair].append((base, suffix, lat, lng))
                    self.by_base[base].append((suffix, lat, lng))

    def dumps(self):
        return json.dumps(self.entries)

    @classmethod
    def loads(cls, text):
        return cls(json.loads(text))

    def decide(self, base, other, lat, lng, completion):
        near = {
            suffix
            for member, suffix, d_lat, d_lng in self.by_pair.get(tuple(sorted((base, other))), ())
            if member == base and _meters(lat, lng, d_lat, d_lng) <= completion.same_intersection_m
        }
        if len(near) == 1:
            return Decision(next(iter(near)), SAME_INTERSECTION)
        if len(near) > 1:
            return Decision(abstained="same_intersection_conflict")
        donors = self.by_base.get(base, ())
        if not donors:
            return Decision(abstained="no_donor")
        if len({suffix for suffix, _, _ in donors}) > 1:
            return Decision(abstained="several_suffixes")
        nearest = min(_meters(lat, lng, d_lat, d_lng) for _, d_lat, d_lng in donors)
        if nearest > completion.unique_street_m:
            return Decision(abstained="out_of_range")
        return Decision(donors[0][0], UNIQUE_STREET)


def build_index(stops, profile):
    return SuffixIndex(donor_entries(stops, profile))


def complete_name(stop, name, profile, index):
    completion = profile.stop_name.complete_suffixes
    if completion is None or index is None:
        return name
    coordinates = _eligible_coordinates(stop, name)
    if coordinates is None:
        return name
    rules = profile.stop_name
    parts = [classify(part, rules) for part in (name.on_street, name.cross_street)]
    texts = [name.on_street, name.cross_street]
    methods = []
    for i, (kind, base, _) in enumerate(parts):
        if kind != "bare":
            continue
        decision = index.decide(base, parts[1 - i][1], *coordinates, completion)
        if decision.suffix:
            texts[i] = f"{texts[i]} {decision.suffix}"
            methods.append(decision.method)
    if not methods:
        return name
    method = SAME_INTERSECTION if SAME_INTERSECTION in methods else UNIQUE_STREET
    return replace(
        name,
        public_name=f"{texts[0]}{rules.separator}{texts[1]}",
        on_street=texts[0],
        cross_street=texts[1],
        original_public_name=name.public_name,
        suffix_completion=method,
    )


def name_stops(stops, profile, index):
    return [complete_name(stop, name_stop(stop, profile), profile, index) for stop in stops]


def _cached(key):
    try:
        from redash import redis_connection

        cached = redis_connection.get(key)
    except redis.RedisError:
        return None
    return None if cached is None else SuffixIndex.loads(cached)


def _store(key, index):
    try:
        from redash import redis_connection

        redis_connection.setex(key, INDEX_TTL_SECONDS, index.dumps())
    except redis.RedisError:
        pass


def carrier_index(profile, revision, source, load_stops):
    if profile.stop_name.complete_suffixes is None:
        return None
    if source is None:
        return build_index(load_stops(), profile)
    key = index_key(profile.carrier_code, revision, source)
    index = _cached(key)
    if index is None:
        index = build_index(load_stops(), profile)
        _store(key, index)
    return index


class CarrierIndexes:
    def __init__(self, revision, source, load_stops):
        self.revision = revision
        self.source = source
        self.load_stops = load_stops
        self.built = {}

    def get(self, profile):
        carrier = profile.carrier_code
        if carrier not in self.built:
            self.built[carrier] = carrier_index(profile, self.revision, self.source, lambda: self.load_stops(carrier))
        return self.built[carrier]

    def name(self, stop, profile):
        return complete_name(stop, name_stop(stop, profile), profile, self.get(profile))

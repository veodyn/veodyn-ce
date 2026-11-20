import json
import logging
import os

from redash.transit_naming.gtfs_routes import GtfsResolver

logger = logging.getLogger(__name__)
MEMO_LIMIT = 8
_memo = {}


def terminal_index(snapshot):
    trips = {trip["trip_id"]: (trip["route_id"], trip["direction_id"]) for trip in snapshot.trips}
    served, final, inner = {}, {}, {}
    for trip_id, sequence in snapshot.stop_times_by_trip.items():
        key = trips.get(trip_id)
        skipped = snapshot.no_service_stop_times.get(trip_id, frozenset())
        stops = [stop_id for position, stop_id in sequence if position not in skipped]
        if key is None or not stops:
            continue
        served.setdefault(key, set()).update(stops)
        final.setdefault(key, set()).add(stops[-1])
        inner.setdefault(key, set()).update(stops[:-1])
    index = {}
    for (route_id, direction_id), stops in served.items():
        key = (route_id, direction_id)
        index.setdefault(route_id, {})[direction_id] = {"stops": stops, "final": final[key] - inner[key]}
    return index


def _as_json(index):
    return {
        route_id: {
            direction_id: {name: sorted(ids) for name, ids in parts.items()} for direction_id, parts in by.items()
        }
        for route_id, by in index.items()
    }


def _from_json(raw):
    return {
        route_id: {direction_id: {name: set(ids) for name, ids in parts.items()} for direction_id, parts in by.items()}
        for route_id, by in raw.items()
    }


def _path(cache_dir, digest):
    return os.path.join(cache_dir, f"terminals-{digest}.json")


def _read(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            return _from_json(json.load(handle))
    except (OSError, ValueError, AttributeError) as error:
        logger.warning("Ignoring unreadable terminal stop index %s: %s", path, error)
        return None


def _write(path, index):
    temporary = f"{path}.{os.getpid()}.tmp"
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(_as_json(index), handle)
        os.replace(temporary, path)
    except OSError as error:
        logger.warning("Could not cache terminal stop index %s: %s", path, error)


def _remember(digest, index):
    if len(_memo) >= MEMO_LIMIT:
        _memo.clear()
    _memo[digest] = index


class TerminalIndexes:
    def __init__(self, profile, cache_dir, fetch, snapshots):
        self.profile = profile
        self.cache_dir = cache_dir
        self.fetch = fetch
        self.snapshots = snapshots
        self._built = None

    def for_source(self, source_name):
        snapshot = self.snapshots.get(source_name)
        if snapshot is None:
            return None
        if snapshot.digest in _memo:
            return _memo[snapshot.digest]
        index = _read(_path(self.cache_dir, snapshot.digest))
        if index is None:
            index = self._build().get(snapshot.digest)
        if index is not None:
            _remember(snapshot.digest, index)
        return index

    def _build(self):
        if self._built is not None:
            return self._built
        self._built = {}
        try:
            full = GtfsResolver(self.profile, self.cache_dir, fetch=self.fetch, with_patterns=True).snapshots()
        except Exception as error:
            logger.warning("No terminal stop index for %s: %s", self.profile.carrier_code, error)
            return self._built
        for snapshot in full.values():
            index = terminal_index(snapshot)
            _write(_path(self.cache_dir, snapshot.digest), index)
            self._built[snapshot.digest] = index
        return self._built


def _direction_of(members, directions):
    if not members:
        return None
    overlap = sorted(
        ((len(members & parts["stops"]), direction_id) for direction_id, parts in directions.items()), reverse=True
    )
    best, direction_id = overlap[0]
    runner_up = overlap[1][0] if len(overlap) > 1 else 0
    return direction_id if best * 2 >= len(members) and best > 2 * runner_up else None


class TerminusFilter:
    def __init__(self, resolved_by_code, indexes, members_for):
        self.resolved_by_code = resolved_by_code
        self.indexes = indexes
        self.members_for = members_for
        self._directions = {}

    def _members(self, pattern_code):
        try:
            return {str(member.get("stop_id")) for member in self.members_for(pattern_code)}
        except Exception as error:
            logger.warning("Keeping departures of %s, its stops could not be read: %s", pattern_code, error)
            return set()

    def is_arrival_at_the_end(self, row, sibling_patterns=None):
        stop_id = str(row.get("stop_id") or "")
        pattern_code = str(row.get("pattern_code") or "") or (sibling_patterns or {}).get(_sibling_key(row), "")
        resolved = self.resolved_by_code.get(row.get("route_code"))
        if not pattern_code or not stop_id or resolved is None:
            return False
        directions = (self.indexes.for_source(resolved.source_name) or {}).get(resolved.gtfs_route_id, {})
        if not any(stop_id in parts["final"] for parts in directions.values()):
            return False
        key = (resolved.gtfs_route_id, pattern_code)
        if key not in self._directions:
            self._directions[key] = _direction_of(self._members(pattern_code), directions)
        direction_id = self._directions[key]
        return direction_id is not None and stop_id in directions[direction_id]["final"]

    def apply(self, rows):
        siblings = _sibling_patterns(rows)
        return [row for row in rows if not self.is_arrival_at_the_end(row, siblings)]


def _sibling_key(row):
    return (str(row.get("stop_id") or ""), str(row.get("route_code") or ""), str(row.get("direction") or ""))


def _sibling_patterns(rows):
    found = {}
    for row in rows:
        if row.get("pattern_code"):
            found.setdefault(_sibling_key(row), set()).add(str(row["pattern_code"]))
    return {key: next(iter(codes)) for key, codes in found.items() if len(codes) == 1}

import csv
import hashlib
import io
import zipfile

from redash.query_runner.gtfs_realtime_transport import sanitize_feed_url
from redash.query_runner.gtfs_static_tables import (
    DecompressionBudget,
    check_archive_bounds,
    open_table,
    table_members,
)
from redash.transit_naming import provenance
from redash.transit_naming.gtfs_cache import cached_archive, http_fetch
from redash.transit_naming.snapshot import GtfsSnapshot, ResolvedRoute

ROUTE_FIELDS = ("route_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color")
TRIP_FIELDS = ("route_id", "trip_id", "direction_id", "shape_id", "trip_headsign")
STOP_FIELDS = ("stop_id", "stop_name", "stop_lat", "stop_lon")


def _rows(archive, members, table, budget, fields):
    if table not in members:
        return
    with open_table(archive, members[table], budget) as text:
        for row in csv.DictReader(text):
            yield {field: (row.get(field) or "").strip() for field in fields}


def read_snapshot(source_name, content, safe_url, with_patterns=False):
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as error:
        raise ValueError(f"GTFS archive from {safe_url} is not a readable zip: {error}") from error
    check_archive_bounds(archive, safe_url)
    members = table_members(archive)
    budget = DecompressionBudget(safe_url)
    routes = {row["route_id"]: row for row in _rows(archive, members, "routes", budget, ROUTE_FIELDS)}
    trips = ()
    stop_times = {}
    stops = {}
    if with_patterns:
        trips = tuple(_rows(archive, members, "trips", budget, TRIP_FIELDS))
        for row in _rows(archive, members, "stop_times", budget, ("trip_id", "stop_sequence", "stop_id")):
            stop_times.setdefault(row["trip_id"], []).append((int(row["stop_sequence"]), row["stop_id"]))
        for sequence in stop_times.values():
            sequence.sort()
        stops = {row["stop_id"]: row for row in _rows(archive, members, "stops", budget, STOP_FIELDS)}
    return GtfsSnapshot(source_name, hashlib.sha256(content).hexdigest(), routes, trips, stop_times, stops)


def _resolved(gtfs_route_id, row, snapshot, provenance_value):
    return ResolvedRoute(
        gtfs_route_id,
        row.get("route_short_name", ""),
        row.get("route_long_name", ""),
        row.get("route_type", ""),
        row.get("route_color", "").upper(),
        row.get("route_text_color", "").upper(),
        snapshot.source_name,
        provenance_value,
        snapshot.digest,
    )


def _join(strategy, route_number, snapshot):
    for gtfs_route_id, row in snapshot.routes.items():
        if strategy == "short_name" and route_number in [
            p.strip() for p in row["route_short_name"].split("/") if p.strip()
        ]:
            return gtfs_route_id, row
        if strategy == "route_id_prefix" and gtfs_route_id.split("-")[0] == route_number:
            return gtfs_route_id, row
    return None, None


def resolve_route(route_code, route_number, profile, snapshots):
    alias = profile.aliases.get(route_code)
    if alias is not None and alias.source in snapshots:
        row = snapshots[alias.source].routes.get(alias.gtfs_route_id)
        if row is not None:
            return _resolved(alias.gtfs_route_id, row, snapshots[alias.source], provenance.ALIAS)
    for source in profile.gtfs_sources:
        snapshot = snapshots.get(source.name)
        if snapshot is None:
            continue
        for strategy in source.join:
            gtfs_route_id, row = _join(strategy, route_number, snapshot)
            if row is not None:
                return _resolved(gtfs_route_id, row, snapshot, provenance.GTFS)
    return None


class GtfsResolver:
    def __init__(self, profile, cache_dir, fetch=http_fetch, with_patterns=False, now=None):
        self.profile = profile
        self.cache_dir = cache_dir
        self.fetch = fetch
        self.with_patterns = with_patterns
        self.now = now
        self.refresh_errors = []
        self._snapshots = None

    def snapshots(self):
        if self._snapshots is None:
            self._snapshots = {}
            for source in self.profile.gtfs_sources:
                safe_url = sanitize_feed_url(source.url)
                archive = cached_archive(
                    source.url,
                    self.cache_dir,
                    self.profile.gtfs_cache_max_age_hours,
                    self.profile.gtfs_max_download_bytes,
                    self.fetch,
                    now=self.now,
                    validate=lambda content, name=source.name, url=safe_url: read_snapshot(name, content, url),
                )
                if archive.refresh_error:
                    self.refresh_errors.append(archive.refresh_error)
                self._snapshots[source.name] = read_snapshot(
                    source.name, archive.content, safe_url, self.with_patterns
                )
        return self._snapshots

    @property
    def digest(self):
        digests = sorted(snapshot.digest for snapshot in self.snapshots().values())
        if not digests:
            return ""
        return hashlib.sha256("".join(digests).encode("utf-8")).hexdigest()

    def resolve(self, route_code, route_number):
        return resolve_route(route_code, route_number, self.profile, self.snapshots())

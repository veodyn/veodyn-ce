from __future__ import annotations

import tempfile
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path
from urllib.parse import urlsplit

from gtfs_validator.reading import open_raw_view

from validator_service.archive_limits import ArchiveTooLarge, check_uncompressed_size
from validator_service.entities import (
    AGENCY,
    MAX_ENTITIES_PER_KIND,
    MAX_ID_CHARS,
    MAX_LABEL_CHARS,
    ROUTE,
    STOP,
    TRIP,
    Entity,
    EntityIndex,
)
from validator_service.fetch import download

AGENCY_TABLE = "agency.txt"
ROUTES_TABLE = "routes.txt"
STOPS_TABLE = "stops.txt"
TRIPS_TABLE = "trips.txt"
FEED_INFO_TABLE = "feed_info.txt"

INDEXED_TABLES = (AGENCY_TABLE, ROUTES_TABLE, STOPS_TABLE, TRIPS_TABLE, FEED_INFO_TABLE)

SUPPORTED_SCHEMES = frozenset({"http", "https"})

Row = dict[str, str]


class EntityIndexError(Exception):
    pass


def has_supported_scheme(url: str) -> bool:
    try:
        return urlsplit(url).scheme.lower() in SUPPORTED_SCHEMES
    except ValueError:
        return False


def fetch_entity_index(url: str, *, timeout: float, max_bytes: int, max_uncompressed_bytes: int) -> EntityIndex:
    with tempfile.TemporaryDirectory(prefix="validator-entities-") as tmp_dir:
        archive_path = Path(tmp_dir) / "gtfs.zip"
        download(url, archive_path, timeout=timeout, max_bytes=max_bytes)
        try:
            check_uncompressed_size(archive_path, max_uncompressed_bytes=max_uncompressed_bytes)
        except ArchiveTooLarge as exc:
            raise EntityIndexError(f"{url}: {exc}") from exc
        return build_entity_index(archive_path)


def build_entity_index(archive_path: Path) -> EntityIndex:
    try:
        with open_raw_view(archive_path, tables=INDEXED_TABLES) as view:
            feed_version = _first_feed_version(view.rows(FEED_INFO_TABLE))
            by_kind = {
                AGENCY: _entities(view.rows(AGENCY_TABLE), AGENCY, "agency_id", _agency_label),
                ROUTE: _entities(view.rows(ROUTES_TABLE), ROUTE, "route_id", _route_label),
                STOP: _entities(view.rows(STOPS_TABLE), STOP, "stop_id", _stop_label),
                TRIP: _entities(view.rows(TRIPS_TABLE), TRIP, "trip_id", _trip_label),
            }
    except Exception as exc:
        raise EntityIndexError(f"the archive could not be read as GTFS: {exc}") from exc
    return EntityIndex(feed_version=feed_version, by_kind=by_kind)


def _entities(rows: Iterator[Row], kind: str, id_column: str, label_of: Callable[[Row], str]) -> tuple[Entity, ...]:
    collected: list[Entity] = []
    for row in rows:
        identifier = row.get(id_column, "").strip()
        if not identifier or len(identifier) > MAX_ID_CHARS:
            continue
        label = label_of(row).strip()[:MAX_LABEL_CHARS].strip()
        collected.append(Entity(kind=kind, id=identifier, label=label or identifier))
        if len(collected) >= MAX_ENTITIES_PER_KIND:
            break
    return tuple(collected)


def _first_feed_version(rows: Iterable[Row]) -> str:
    for row in rows:
        return row.get("feed_version", "").strip()
    return ""


def _agency_label(row: Row) -> str:
    return row.get("agency_name", "")


def _route_label(row: Row) -> str:
    return f"{row.get('route_short_name', '')} {row.get('route_long_name', '')}".strip()


def _stop_label(row: Row) -> str:
    return row.get("stop_name", "")


def _trip_label(row: Row) -> str:
    return row.get("trip_headsign", "")

"""
GTFS-Realtime query runner.

Transit agencies publish vehicle positions, trip updates and service alerts as
GTFS-Realtime. Vehicle positions can arrive as JSON-shaped messages over a
long-lived WebSocket stream, or as protobuf over plain HTTP (the more common
publication form); trip updates and service alerts are HTTP protobuf only. A
query runner can't hold a websocket stream open, so the websocket path
connects, samples messages for a few seconds (capped at 30s so RQ workers
can't hang), dedupes by vehicle id keeping the newest update, and returns the
snapshot. The HTTP paths fetch one protobuf FeedMessage snapshot instead, so
sampling does not apply there.

Agencies commonly publish vehicle positions, trip updates and alerts at three
distinct URLs, so each resource has its own optional feed URL configuration
field; only feed_url (vehicle positions) is required.

trip_updates is the on-time-performance enabler: one row per stop_time_update
carrying the agency's own arrival/departure delays plus a computed on_time
flag, so a dashboard can average on_time over a route or a time window.
"""

import json
import math
import time
from urllib.parse import urlsplit

import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
)
from redash.query_runner.gtfs_realtime_entities import (
    build_alert_row,
    build_trip_update_rows,
    keep_newest,
    parse_vehicle_entity,
    parse_vehicle_message,
)
from redash.query_runner.gtfs_realtime_resources import (
    DEFAULT_EARLY_SECONDS,
    DEFAULT_LATE_SECONDS,
    DEFAULT_SAMPLE_SECONDS,
    MAX_SAMPLE_SECONDS,
    RESOURCES,
)
from redash.query_runner.gtfs_realtime_transport import (
    HTTP_TIMEOUT_SECONDS,
    read_bounded,
    sanitize_feed_url,
)

try:
    from websockets.sync.client import connect as ws_connect

    ws_available = True
except ImportError:
    ws_connect = None
    ws_available = False

try:
    from google.transit import gtfs_realtime_pb2

    pb_available = True
except ImportError:
    gtfs_realtime_pb2 = None
    pb_available = False

WEBSOCKET_SCHEMES = ("ws", "wss")
HTTP_SCHEMES = ("http", "https")


def _parse_threshold_seconds(params, param_name, default):
    value = params.get(param_name, default)
    invalid = ValueError(f"trip_updates: '{param_name}' param must be a number >= 0, got {value!r}")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise invalid
    if not math.isfinite(value):
        raise invalid
    if value < 0:
        raise invalid
    return value


class GtfsRealtime(BaseResourceRunner):
    resources = RESOURCES
    default_resource = "vehicle_positions"
    noop_query = '{"resource": "vehicle_positions", "params": {"sample_seconds": 3}}'

    @classmethod
    def name(cls):
        return "GTFS-Realtime"

    @classmethod
    def type(cls):
        return "gtfs_realtime"

    @classmethod
    def enabled(cls):
        return ws_available or pb_available

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "feed_url": {
                    "type": "string",
                    "title": "GTFS-Realtime feed URL",
                    "description": (
                        "URL of the feed. {routes} is substituted with the routes param. Use a "
                        "wss:// or ws:// URL for a JSON websocket feed, e.g. "
                        "wss://feed.example.org/ws/vehicle_positions/{routes}, or an http:// or "
                        "https:// URL for a protobuf FeedMessage feed, e.g. "
                        "https://feed.example.org/gtfs-rt/vehicle_positions/{routes}"
                    ),
                },
                "trip_updates_url": {
                    "type": "string",
                    "title": "Trip updates URL (optional)",
                    "description": (
                        "HTTP or HTTPS URL of the agency's GTFS-Realtime TripUpdate protobuf feed. "
                        "{routes} is substituted with the routes param."
                    ),
                },
                "service_alerts_url": {
                    "type": "string",
                    "title": "Service alerts URL (optional)",
                    "description": (
                        "HTTP or HTTPS URL of the agency's GTFS-Realtime Alert protobuf feed. "
                        "{routes} is substituted with the routes param."
                    ),
                },
                "route_labels": {
                    "type": "string",
                    "title": "Route labels (JSON object, optional)",
                    "description": (
                        'Maps a route id to a display name, e.g. {"42": "Green Line"}. '
                        "Unmapped routes report their id unchanged."
                    ),
                    "default": "",
                },
                "sample_seconds": {
                    "type": "number",
                    "title": "Default Sample Window (seconds, websocket feeds only)",
                    "default": DEFAULT_SAMPLE_SECONDS,
                },
            },
            required=["feed_url"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.feed_url_template = self.configuration.get("feed_url", "")
        self.trip_updates_url_template = self.configuration.get("trip_updates_url", "")
        self.service_alerts_url_template = self.configuration.get("service_alerts_url", "")
        self.sample_seconds = self.configuration.get("sample_seconds", DEFAULT_SAMPLE_SECONDS)

        raw_labels = self.configuration.get("route_labels", "") or "{}"
        try:
            self.route_labels = json.loads(raw_labels)
        except ValueError as exc:
            raise ValueError(f"route_labels is not valid JSON: {exc}") from exc
        if not isinstance(self.route_labels, dict):
            raise ValueError("route_labels must be a JSON object")

    def _resource_url(self, template, params, resource, field_title):
        """Resolve a resource's own feed URL, requiring it configured and HTTP-only."""
        if not template or not template.strip():
            raise ValueError(f"{resource} requires the {field_title} to be configured on this data source")
        routes = str(params.get("routes", "")).replace(" ", "")
        url = template.format(routes=routes)
        if urlsplit(url).scheme not in HTTP_SCHEMES:
            raise ValueError(f"{resource} supports HTTP protobuf feeds only")
        return url

    def _fetch(self, resource, params):
        if resource == "vehicle_positions":
            routes = str(params.get("routes", "")).replace(" ", "")
            url = self.feed_url_template.format(routes=routes)
            scheme = urlsplit(url).scheme
            if scheme in WEBSOCKET_SCHEMES:
                return self._fetch_ws(url, params)
            if scheme in HTTP_SCHEMES:
                return self._fetch_vehicle_positions_http(url)
            raise ValueError(f"unsupported GTFS-Realtime feed URL scheme: {scheme!r}")

        if resource == "trip_updates":
            url = self._resource_url(self.trip_updates_url_template, params, "trip_updates", "Trip updates URL")
            early_seconds = _parse_threshold_seconds(params, "early_seconds", DEFAULT_EARLY_SECONDS)
            late_seconds = _parse_threshold_seconds(params, "late_seconds", DEFAULT_LATE_SECONDS)
            feed = self._fetch_feed_message(url)
            rows = []
            for entity in feed.entity:
                rows.extend(build_trip_update_rows(entity, self.route_labels, early_seconds, late_seconds))
            return rows, rows

        if resource == "service_alerts":
            url = self._resource_url(self.service_alerts_url_template, params, "service_alerts", "Service alerts URL")
            feed = self._fetch_feed_message(url)
            rows = [row for row in (build_alert_row(entity) for entity in feed.entity) if row is not None]
            return rows, rows

        raise ValueError(f"Unknown resource {resource!r}")

    def _fetch_ws(self, url, params):
        if not ws_available:
            raise ValueError("websockets is not installed; websocket GTFS-Realtime feeds are unavailable")

        sample_seconds = min(float(params.get("sample_seconds", self.sample_seconds)), MAX_SAMPLE_SECONDS)
        vehicles = {}
        deadline = time.monotonic() + sample_seconds
        with ws_connect(url, open_timeout=10) as ws:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    raw_message = ws.recv(timeout=remaining)
                except TimeoutError:
                    break
                try:
                    message = json.loads(raw_message)
                except (TypeError, ValueError):  # silent-ok: malformed feed frames are expected, skip them
                    continue
                parsed = parse_vehicle_message(message, self.route_labels)
                if parsed is None:
                    continue
                keep_newest(vehicles, parsed)

        records = [{k: v for k, v in vehicle.items() if k != "_ts"} for vehicle in vehicles.values()]
        return records, records

    def _fetch_feed_message(self, url):
        """Fetch and parse one protobuf FeedMessage snapshot, shared by every HTTP resource."""
        if not pb_available:
            raise ValueError("gtfs-realtime-bindings is not installed; HTTP protobuf feeds are unavailable")

        safe_url = sanitize_feed_url(url)
        try:
            response = requests.get(url, timeout=HTTP_TIMEOUT_SECONDS, stream=True)
            response.raise_for_status()
            content = read_bounded(response, safe_url)
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else "unknown"
            raise ValueError(f"GTFS-Realtime request to {safe_url} failed with HTTP {status}") from exc
        except requests.RequestException as exc:
            raise ValueError(f"GTFS-Realtime request to {safe_url} failed: {type(exc).__name__}") from exc

        feed = gtfs_realtime_pb2.FeedMessage()
        try:
            feed.ParseFromString(content)
        except Exception as exc:
            raise ValueError(f"could not parse GTFS-Realtime protobuf feed from {safe_url}: {exc}") from exc
        if not feed.IsInitialized():
            raise ValueError(f"GTFS-Realtime protobuf feed from {safe_url} is missing required fields")
        return feed

    def _fetch_vehicle_positions_http(self, url):
        feed = self._fetch_feed_message(url)
        vehicles = {}
        for entity in feed.entity:
            parsed = parse_vehicle_entity(entity, self.route_labels)
            if parsed is None:
                continue
            keep_newest(vehicles, parsed)

        records = [{k: v for k, v in vehicle.items() if k != "_ts"} for vehicle in vehicles.values()]
        return records, records


register(GtfsRealtime)

"""
GTFS-Realtime query runner.

Transit agencies publish vehicle positions as GTFS-Realtime, either as
JSON-shaped messages over a long-lived WebSocket stream, or as protobuf over
plain HTTP (the more common publication form). A query runner can't hold a
websocket stream open, so the websocket path connects, samples messages for a
few seconds (capped at 30s so RQ workers can't hang), dedupes by vehicle id
keeping the newest update, and returns the snapshot. The HTTP path fetches one
protobuf FeedMessage snapshot instead, so sampling does not apply there.

The feed URL and the optional route id to display name map are both
connector configuration, so one runner instance can point at any agency's
GTFS-Realtime feed rather than one hardcoded host.
"""

import json
import time
from urllib.parse import urlsplit

import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
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

DEFAULT_SAMPLE_SECONDS = 8
MAX_SAMPLE_SECONDS = 30
WEBSOCKET_SCHEMES = ("ws", "wss")
HTTP_SCHEMES = ("http", "https")


def parse_vehicle_message(message, route_labels):
    """Map one GTFS-Realtime JSON vehicle entity to a row, or None without a position."""
    vehicle_id = message.get("id")
    vehicle = message.get("vehicle") or {}
    position = vehicle.get("position") or {}
    latitude = position.get("latitude")
    longitude = position.get("longitude")
    if vehicle_id is None or latitude is None or longitude is None:
        return None

    trip = vehicle.get("trip") or {}
    route_id = trip.get("routeId", "")
    ts = vehicle.get("timestamp")

    row = {
        "vehicle_id": vehicle_id,
        "latitude": latitude,
        "longitude": longitude,
        "bearing": position.get("bearing"),
        "speed": position.get("speed"),
        "direction_id": trip.get("directionId"),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(int(ts))) if ts else None,
        "_ts": int(ts) if ts else 0,
    }
    row["route_id"] = route_id
    row["line"] = route_labels.get(route_id, route_id)
    return row


def parse_vehicle_entity(entity, route_labels):
    """Map one GTFS-Realtime protobuf FeedEntity to a row, or None without a position.

    HasField decides presence, not truthiness: unset optional scalars read as
    0/0.0, and an explicit timestamp of 0 must not read as absent.
    """
    vehicle = entity.vehicle
    if not vehicle.HasField("position"):
        return None

    descriptor_id = vehicle.vehicle.id
    vehicle_id = descriptor_id if descriptor_id else entity.id
    if not vehicle_id:
        return None

    position = vehicle.position
    trip = vehicle.trip
    route_id = trip.route_id if trip.HasField("route_id") else ""
    has_ts = vehicle.HasField("timestamp")
    ts = vehicle.timestamp if has_ts else None

    row = {
        "vehicle_id": vehicle_id,
        "latitude": position.latitude,
        "longitude": position.longitude,
        "bearing": position.bearing if position.HasField("bearing") else None,
        "speed": position.speed if position.HasField("speed") else None,
        "direction_id": trip.direction_id if trip.HasField("direction_id") else None,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(ts)) if has_ts else None,
        "_ts": ts if has_ts else 0,
    }
    row["route_id"] = route_id
    row["line"] = route_labels.get(route_id, route_id)
    return row


def _keep_newest(vehicles, parsed):
    """Insert parsed into vehicles, keeping the newer entry per vehicle_id."""
    key = str(parsed["vehicle_id"])
    if key not in vehicles or parsed["_ts"] >= vehicles[key]["_ts"]:
        vehicles[key] = parsed


class GtfsRealtime(BaseResourceRunner):
    resources = {
        "vehicle_positions": {
            "doc_params": [
                "routes (optional): string - comma separated route ids to subscribe to, "
                "substituted into {routes} in the feed URL",
                "sample_seconds (optional): number - websocket feeds only, how long to sample before "
                f"returning (default {DEFAULT_SAMPLE_SECONDS}, capped at {MAX_SAMPLE_SECONDS}); "
                "HTTP protobuf feeds are a single snapshot and ignore this",
            ],
            "doc_returns": [
                "vehicle_id: string",
                "route_id: string",
                "line: string",
                "latitude: float",
                "longitude: float",
                "bearing: float",
                "speed: float",
                "direction_id: integer",
                "timestamp: string (UTC, from the vehicle feed)",
            ],
            "example": '{"resource": "vehicle_positions", "params": {"routes": "1,2"}}',
        },
    }
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
        self.sample_seconds = self.configuration.get("sample_seconds", DEFAULT_SAMPLE_SECONDS)

        raw_labels = self.configuration.get("route_labels", "") or "{}"
        try:
            self.route_labels = json.loads(raw_labels)
        except ValueError as exc:
            raise ValueError(f"route_labels is not valid JSON: {exc}") from exc
        if not isinstance(self.route_labels, dict):
            raise ValueError("route_labels must be a JSON object")

    def _fetch(self, resource, params):
        routes = str(params.get("routes", "")).replace(" ", "")
        url = self.feed_url_template.format(routes=routes)
        scheme = urlsplit(url).scheme

        if scheme in WEBSOCKET_SCHEMES:
            return self._fetch_ws(url, params)
        if scheme in HTTP_SCHEMES:
            return self._fetch_http(url)
        raise ValueError(f"unsupported GTFS-Realtime feed URL scheme: {scheme!r}")

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
                _keep_newest(vehicles, parsed)

        records = [{k: v for k, v in vehicle.items() if k != "_ts"} for vehicle in vehicles.values()]
        return records, records

    def _fetch_http(self, url):
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

        vehicles = {}
        for entity in feed.entity:
            parsed = parse_vehicle_entity(entity, self.route_labels)
            if parsed is None:
                continue
            _keep_newest(vehicles, parsed)

        records = [{k: v for k, v in vehicle.items() if k != "_ts"} for vehicle in vehicles.values()]
        return records, records


register(GtfsRealtime)

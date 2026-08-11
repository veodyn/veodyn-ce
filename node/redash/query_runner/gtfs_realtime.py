"""
GTFS-Realtime query runner.

Transit agencies publish vehicle positions as GTFS-Realtime-shaped JSON over
long-lived WebSocket streams. A query runner can't hold the stream open, so
run_query connects, samples messages for a few seconds (capped at 30s so RQ
workers can't hang), dedupes by vehicle id keeping the newest update, and
returns the snapshot.

The feed URL and the optional route id to display name map are both
connector configuration, so one runner instance can point at any agency's
GTFS-Realtime feed rather than one hardcoded host.
"""

import json
import time

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
)

try:
    from websockets.sync.client import connect as ws_connect

    ws_available = True
except ImportError:
    ws_connect = None
    ws_available = False

DEFAULT_SAMPLE_SECONDS = 8
MAX_SAMPLE_SECONDS = 30


def parse_vehicle_message(message, route_labels):
    """Map one GTFS-Realtime vehicle entity to a row, or None without a position."""
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


class GtfsRealtime(BaseResourceRunner):
    resources = {
        "vehicle_positions": {
            "doc_params": [
                "routes (optional): string - comma separated route ids to subscribe to, "
                "substituted into {routes} in the feed URL",
                "sample_seconds (optional): number - how long to sample before returning "
                f"(default {DEFAULT_SAMPLE_SECONDS}, capped at {MAX_SAMPLE_SECONDS})",
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
        return ws_available

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "feed_url": {
                    "type": "string",
                    "title": "GTFS-Realtime feed URL",
                    "description": (
                        "Websocket URL of the feed. {routes} is substituted with the "
                        "routes param, e.g. wss://feed.example.org/ws/vehicle_positions/{routes}"
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
                    "title": "Default Sample Window (seconds)",
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
        sample_seconds = min(float(params.get("sample_seconds", self.sample_seconds)), MAX_SAMPLE_SECONDS)
        url = self.feed_url_template.format(routes=routes)

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
                key = str(parsed["vehicle_id"])
                if key not in vehicles or parsed["_ts"] >= vehicles[key]["_ts"]:
                    vehicles[key] = parsed

        records = [{k: v for k, v in vehicle.items() if k != "_ts"} for vehicle in vehicles.values()]
        return records, records


register(GtfsRealtime)

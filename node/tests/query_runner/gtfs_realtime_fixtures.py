"""Shared builders for the GTFS-Realtime websocket and HTTP protobuf tests."""

from unittest.mock import MagicMock

try:
    from google.transit import gtfs_realtime_pb2
except ImportError:
    gtfs_realtime_pb2 = None

MSG_A = {
    "id": "1150-1161",
    "vehicle": {
        "position": {"latitude": 10.05, "longitude": 20.24, "bearing": 90.0, "speed": 12.3},
        "trip": {"routeId": "10"},
        "timestamp": 1752940000,
    },
}
MSG_A_NEWER = {
    "id": "1150-1161",
    "vehicle": {
        "position": {"latitude": 10.06, "longitude": 20.25, "bearing": 92.0, "speed": 15.0},
        "trip": {"routeId": "10"},
        "timestamp": 1752940060,
    },
}
MSG_B = {
    "id": "2200-1",
    "vehicle": {
        "position": {"latitude": 9.98, "longitude": 20.35, "bearing": 180.0, "speed": 9.9},
        "trip": {"routeId": "20"},
        "timestamp": 1752940030,
    },
}

SAMPLE_VEHICLE_MESSAGE_ROUTE_42 = {
    "id": "9000-1",
    "vehicle": {
        "position": {"latitude": 10.0, "longitude": 20.0, "bearing": 45.0, "speed": 10.0},
        "trip": {"routeId": "42", "directionId": 1},
        "timestamp": 1752940000,
    },
}

ROUTE_LABELS = {"10": "Blue Line", "20": "Green Line"}


def fake_ws(messages):
    """Context manager whose recv() yields messages then times out."""
    ws = MagicMock()
    iterator = iter(messages)

    def recv(timeout=None):
        try:
            return next(iterator)
        except StopIteration:
            raise TimeoutError()

    ws.recv.side_effect = recv
    manager = MagicMock()
    manager.__enter__.return_value = ws
    manager.__exit__.return_value = False
    return manager


def build_vehicle_entity(
    entity_id="",
    vehicle_id=None,
    latitude=1.0,
    longitude=2.0,
    bearing=None,
    speed=None,
    route_id=None,
    direction_id=None,
    timestamp=None,
    with_position=True,
):
    """One FeedEntity carrying a VehiclePosition, leaving unset fields unset."""
    if gtfs_realtime_pb2 is None:
        raise RuntimeError("gtfs-realtime-bindings is required to build protobuf test fixtures")
    entity = gtfs_realtime_pb2.FeedEntity()
    entity.id = entity_id
    if with_position:
        entity.vehicle.position.latitude = latitude
        entity.vehicle.position.longitude = longitude
        if bearing is not None:
            entity.vehicle.position.bearing = bearing
        if speed is not None:
            entity.vehicle.position.speed = speed
    if vehicle_id is not None:
        entity.vehicle.vehicle.id = vehicle_id
    if route_id is not None:
        entity.vehicle.trip.route_id = route_id
    if direction_id is not None:
        entity.vehicle.trip.direction_id = direction_id
    if timestamp is not None:
        entity.vehicle.timestamp = timestamp
    return entity


def build_feed_message(entities, version="2.0"):
    """A FeedMessage wrapping entities. version=None omits the required header field."""
    if gtfs_realtime_pb2 is None:
        raise RuntimeError("gtfs-realtime-bindings is required to build protobuf test fixtures")
    feed = gtfs_realtime_pb2.FeedMessage()
    if version is not None:
        feed.header.gtfs_realtime_version = version
    feed.header.incrementality = gtfs_realtime_pb2.FeedHeader.FULL_DATASET
    feed.header.timestamp = 1752940000
    for entity in entities:
        feed.entity.add().CopyFrom(entity)
    return feed


def fake_response(content, raise_error=None):
    """A requests.Response stand-in exposing only what _fetch_http reads: a
    streamed, chunked body via iter_content, matching the real requests API."""
    response = MagicMock()
    response.raise_for_status.side_effect = raise_error

    def iter_content(chunk_size=65536):
        for start in range(0, len(content), chunk_size):
            yield content[start : start + chunk_size]

    response.iter_content.side_effect = iter_content
    return response

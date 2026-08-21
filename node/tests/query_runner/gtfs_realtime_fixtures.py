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


def build_stop_time_update(
    stop_id=None,
    stop_sequence=None,
    schedule_relationship=None,
    arrival_delay=None,
    arrival_time=None,
    departure_delay=None,
    departure_time=None,
):
    """One TripUpdate.StopTimeUpdate, leaving unset fields unset."""
    if gtfs_realtime_pb2 is None:
        raise RuntimeError("gtfs-realtime-bindings is required to build protobuf test fixtures")
    stu = gtfs_realtime_pb2.TripUpdate.StopTimeUpdate()
    if stop_id is not None:
        stu.stop_id = stop_id
    if stop_sequence is not None:
        stu.stop_sequence = stop_sequence
    if schedule_relationship is not None:
        stu.schedule_relationship = schedule_relationship
    if arrival_delay is not None:
        stu.arrival.delay = arrival_delay
    if arrival_time is not None:
        stu.arrival.time = arrival_time
    if departure_delay is not None:
        stu.departure.delay = departure_delay
    if departure_time is not None:
        stu.departure.time = departure_time
    return stu


def build_trip_update_entity(
    entity_id="",
    trip_id=None,
    route_id=None,
    direction_id=None,
    trip_schedule_relationship=None,
    vehicle_id=None,
    timestamp=None,
    stop_time_updates=(),
):
    """One FeedEntity carrying a TripUpdate, leaving unset fields unset."""
    if gtfs_realtime_pb2 is None:
        raise RuntimeError("gtfs-realtime-bindings is required to build protobuf test fixtures")
    entity = gtfs_realtime_pb2.FeedEntity()
    entity.id = entity_id
    trip_update = entity.trip_update
    trip_update.trip.SetInParent()  # trip is a required field of TripUpdate, even when empty
    if trip_id is not None:
        trip_update.trip.trip_id = trip_id
    if route_id is not None:
        trip_update.trip.route_id = route_id
    if direction_id is not None:
        trip_update.trip.direction_id = direction_id
    if trip_schedule_relationship is not None:
        trip_update.trip.schedule_relationship = trip_schedule_relationship
    if vehicle_id is not None:
        trip_update.vehicle.id = vehicle_id
    if timestamp is not None:
        trip_update.timestamp = timestamp
    for stu in stop_time_updates:
        trip_update.stop_time_update.add().CopyFrom(stu)
    return entity


def build_alert_entity(
    entity_id="",
    cause=None,
    effect=None,
    severity_level=None,
    header=None,
    description=None,
    url=None,
    active_periods=(),
    informed_entities=(),
):
    """One FeedEntity carrying an Alert, leaving unset fields unset.

    active_periods: list of (start, end) tuples, either may be None to leave unset.
    informed_entities: list of (route_id, stop_id) tuples, either may be None.
    """
    if gtfs_realtime_pb2 is None:
        raise RuntimeError("gtfs-realtime-bindings is required to build protobuf test fixtures")
    entity = gtfs_realtime_pb2.FeedEntity()
    entity.id = entity_id
    alert = entity.alert
    alert.SetInParent()  # force presence even when every field below is left unset
    if cause is not None:
        alert.cause = cause
    if effect is not None:
        alert.effect = effect
    if severity_level is not None:
        alert.severity_level = severity_level
    if header is not None:
        alert.header_text.translation.add(text=header, language="en")
    if description is not None:
        alert.description_text.translation.add(text=description, language="en")
    if url is not None:
        alert.url.translation.add(text=url, language="en")
    for start, end in active_periods:
        period = alert.active_period.add()
        if start is not None:
            period.start = start
        if end is not None:
            period.end = end
    for route_id, stop_id in informed_entities:
        selector = alert.informed_entity.add()
        if route_id is not None:
            selector.route_id = route_id
        if stop_id is not None:
            selector.stop_id = stop_id
    return entity


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

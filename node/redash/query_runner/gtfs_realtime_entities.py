"""
Row-building for GTFS-Realtime entities: vehicle positions, trip updates and
service alerts, from both the JSON websocket shape and the protobuf
FeedEntity shape.

HasField decides presence throughout, not truthiness: unset optional scalars
read as 0/0.0/"", and an explicit zero timestamp or delay must not read as
absent.
"""

import time

UTC_FORMAT = "%Y-%m-%d %H:%M:%S"


def _utc(epoch_seconds):
    return time.strftime(UTC_FORMAT, time.gmtime(epoch_seconds))


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
        "timestamp": _utc(int(ts)) if ts else None,
        "_ts": int(ts) if ts else 0,
    }
    row["route_id"] = route_id
    row["line"] = route_labels.get(route_id, route_id)
    return row


def parse_vehicle_entity(entity, route_labels):
    """Map one GTFS-Realtime protobuf FeedEntity to a row, or None without a position."""
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
        "timestamp": _utc(ts) if has_ts else None,
        "_ts": ts if has_ts else 0,
    }
    row["route_id"] = route_id
    row["line"] = route_labels.get(route_id, route_id)
    return row


def keep_newest(vehicles, parsed):
    """Insert parsed into vehicles, keeping the newer entry per vehicle_id."""
    key = str(parsed["vehicle_id"])
    if key not in vehicles or parsed["_ts"] >= vehicles[key]["_ts"]:
        vehicles[key] = parsed


def _stop_time_event(event):
    """Return (delay, utc time string) for a StopTimeEvent, or (None, None) when unset."""
    delay = event.delay if event.HasField("delay") else None
    at = _utc(event.time) if event.HasField("time") else None
    return delay, at


def _on_time(effective_delay, stop_schedule_relationship, trip_schedule_relationship, early_seconds, late_seconds):
    """None on a skipped stop or a canceled trip: a flag there would poison avg(on_time)."""
    if effective_delay is None:
        return None
    if stop_schedule_relationship != "SCHEDULED":
        return None
    if trip_schedule_relationship == "CANCELED":
        return None
    return -early_seconds <= effective_delay <= late_seconds


def build_trip_update_rows(entity, route_labels, early_seconds, late_seconds):
    """Map one FeedEntity carrying a TripUpdate to rows, one per stop_time_update."""
    if not entity.HasField("trip_update"):
        return []

    trip_update = entity.trip_update
    trip = trip_update.trip
    trip_id = trip.trip_id if trip.HasField("trip_id") else ""
    route_id = trip.route_id if trip.HasField("route_id") else ""
    direction_id = trip.direction_id if trip.HasField("direction_id") else None
    vehicle_id = trip_update.vehicle.id
    trip_schedule_relationship = type(trip).ScheduleRelationship.Name(trip.schedule_relationship)
    has_ts = trip_update.HasField("timestamp")
    timestamp = _utc(trip_update.timestamp) if has_ts else None
    line = route_labels.get(route_id, route_id)

    rows = []
    for stu in trip_update.stop_time_update:
        stop_id = stu.stop_id if stu.HasField("stop_id") else ""
        stop_sequence = stu.stop_sequence if stu.HasField("stop_sequence") else None
        stop_schedule_relationship = type(stu).ScheduleRelationship.Name(stu.schedule_relationship)

        arrival_delay = arrival_time = None
        if stu.HasField("arrival"):
            arrival_delay, arrival_time = _stop_time_event(stu.arrival)
        departure_delay = departure_time = None
        if stu.HasField("departure"):
            departure_delay, departure_time = _stop_time_event(stu.departure)

        effective_delay = arrival_delay if arrival_delay is not None else departure_delay
        on_time = _on_time(
            effective_delay, stop_schedule_relationship, trip_schedule_relationship, early_seconds, late_seconds
        )

        rows.append(
            {
                "trip_id": trip_id,
                "route_id": route_id,
                "line": line,
                "direction_id": direction_id,
                "vehicle_id": vehicle_id,
                "stop_id": stop_id,
                "stop_sequence": stop_sequence,
                "arrival_delay": arrival_delay,
                "departure_delay": departure_delay,
                "arrival_time": arrival_time,
                "departure_time": departure_time,
                "trip_schedule_relationship": trip_schedule_relationship,
                "stop_schedule_relationship": stop_schedule_relationship,
                "timestamp": timestamp,
                "on_time": on_time,
            }
        )
    return rows


def _first_translation(translated_string):
    if translated_string.translation:
        return translated_string.translation[0].text
    return ""


def _active_from(periods):
    starts = [period.start for period in periods if period.HasField("start")]
    return _utc(min(starts)) if starts else None


def _active_to(periods):
    """None if there are no periods, or any period lacks an end: open-ended means no end."""
    if not periods or any(not period.HasField("end") for period in periods):
        return None
    return _utc(max(period.end for period in periods))


def build_alert_row(entity):
    """Map one FeedEntity carrying an Alert to a row, or None without an alert."""
    if not entity.HasField("alert"):
        return None

    alert = entity.alert
    periods = list(alert.active_period)
    route_ids = sorted({selector.route_id for selector in alert.informed_entity if selector.HasField("route_id")})
    stop_ids = sorted({selector.stop_id for selector in alert.informed_entity if selector.HasField("stop_id")})

    return {
        "alert_id": entity.id,
        "cause": type(alert).Cause.Name(alert.cause),
        "effect": type(alert).Effect.Name(alert.effect),
        "severity_level": type(alert).SeverityLevel.Name(alert.severity_level)
        if alert.HasField("severity_level")
        else None,
        "header": _first_translation(alert.header_text),
        "description": _first_translation(alert.description_text),
        "url": _first_translation(alert.url),
        "active_from": _active_from(periods),
        "active_to": _active_to(periods),
        "informed_route_ids": ",".join(route_ids),
        "informed_stop_ids": ",".join(stop_ids),
    }

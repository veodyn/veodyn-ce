"""Rows to GTFS-Realtime bytes: what maps, what is refused, what stays absent."""

import pytest
from google.transit import gtfs_realtime_pb2

from veodyn_api.services.gtfs_rt_serializer import (
    SerializationError,
    serialize_vehicle_positions,
)

COLUMN_MAP = {
    "vehicle_id": "bus",
    "latitude": "lat",
    "longitude": "lon",
    "trip_id": "trip",
}


def _parse(payload: bytes) -> gtfs_realtime_pb2.FeedMessage:
    message = gtfs_realtime_pb2.FeedMessage()
    message.ParseFromString(payload)
    return message


def test_a_row_becomes_an_entity():
    rows = [{"bus": "bus-1", "lat": 34.05, "lon": -118.25, "trip": "t1"}]

    message = _parse(serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700))

    assert message.header.gtfs_realtime_version == "2.0"
    assert message.header.timestamp == 1700
    assert len(message.entity) == 1
    entity = message.entity[0]
    assert entity.id == "bus-1"
    assert entity.vehicle.vehicle.id == "bus-1"
    assert entity.vehicle.trip.trip_id == "t1"
    assert entity.vehicle.position.latitude == pytest.approx(34.05)


def test_each_coordinate_comes_from_its_own_column():
    """Latitude and longitude are distinct, differently signed, and not swapped.

    A serializer that hardcoded longitude, or copied latitude into it, passes
    every assertion that only looks at latitude.
    """
    rows = [{"bus": "bus-1", "lat": 34.05, "lon": -118.25, "trip": "t1"}]

    position = _parse(serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700)).entity[0].vehicle.position

    assert position.latitude == pytest.approx(34.05)
    assert position.longitude == pytest.approx(-118.25)


def test_numeric_strings_coerce():
    """A warehouse column can arrive as text; a valid number in it is valid."""
    rows = [{"bus": "bus-1", "lat": "34.05", "lon": "-118.25", "trip": "t1"}]

    position = _parse(serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700)).entity[0].vehicle.position

    assert position.latitude == pytest.approx(34.05)
    assert position.longitude == pytest.approx(-118.25)


def test_a_row_missing_a_required_value_is_refused_not_dropped():
    """The runner drops these silently today; the publisher must not.

    A dropped row is a feed that is quietly short, which validates clean and
    is wrong. Refusing names the defect while it is still fixable.
    """
    rows = [{"bus": "bus-1", "lat": None, "lon": -118.25, "trip": "t1"}]

    with pytest.raises(SerializationError) as excinfo:
        serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700)

    assert "latitude" in excinfo.value.reason


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("latitude", "north"),
        ("longitude", "west"),
        ("latitude", 91.0),
        ("latitude", -90.5),
        ("longitude", 181.0),
        ("longitude", -180.5),
        ("longitude", "181"),
        ("latitude", "nan"),
        ("latitude", "inf"),
        ("longitude", "-inf"),
        ("latitude", float("nan")),
        ("longitude", float("inf")),
        ("latitude", "1e39"),
        ("latitude", True),
        ("longitude", False),
    ],
)
def test_a_coordinate_the_feed_cannot_honestly_carry_is_refused(field, value):
    """Uncoercible, out of the WGS-84 range, not finite, or a boolean.

    Protobuf encodes every one of these and the bytes parse clean, so the feed
    is well formed and false unless the refusal happens here, while the row
    index is still known. `float(True)` is 1.0, an ordinary coordinate off the
    coast of Africa, and never what a boolean column meant.
    """
    row = {"bus": "bus-1", "lat": 34.05, "lon": -118.25}
    row["lat" if field == "latitude" else "lon"] = value

    with pytest.raises(SerializationError) as excinfo:
        serialize_vehicle_positions([row], COLUMN_MAP, feed_timestamp=1700)

    assert field in excinfo.value.reason
    assert "row 0" in excinfo.value.reason


@pytest.mark.parametrize(("latitude", "longitude"), [(90.0, 180.0), (-90.0, -180.0), (0.0, 0.0)])
def test_the_edges_of_the_wgs84_range_are_accepted(latitude, longitude):
    """The range is inclusive, and null island is a real point on it."""
    rows = [{"bus": "bus-1", "lat": latitude, "lon": longitude}]

    position = _parse(serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700)).entity[0].vehicle.position

    assert position.latitude == pytest.approx(latitude)
    assert position.longitude == pytest.approx(longitude)


def test_a_column_map_missing_a_required_field_is_refused():
    with pytest.raises(SerializationError) as excinfo:
        serialize_vehicle_positions([], {"vehicle_id": "bus"}, feed_timestamp=1700)

    assert "latitude" in excinfo.value.reason
    assert "longitude" in excinfo.value.reason


def test_a_column_map_naming_a_field_the_serializer_does_not_write_is_refused():
    """A typo, or a GTFS field nobody implemented here, must not be ignored.

    Ignoring it publishes a feed missing a column the operator believes is in
    it, which is the dropped-row failure wearing a different hat.
    """
    column_map = {**COLUMN_MAP, "timestamps": "ts", "occupancy_status": "occ"}

    with pytest.raises(SerializationError) as excinfo:
        serialize_vehicle_positions([], column_map, feed_timestamp=1700)

    assert "timestamps" in excinfo.value.reason
    assert "occupancy_status" in excinfo.value.reason


def test_optional_fields_are_omitted_when_unmapped():
    """An unmapped optional field must be absent, not present-and-default.

    A zero bearing is a real heading, so writing 0.0 for "we do not know"
    publishes an assertion the data never made.
    """
    rows = [{"bus": "bus-1", "lat": 34.05, "lon": -118.25}]
    message = _parse(
        serialize_vehicle_positions(
            rows, {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"}, feed_timestamp=1700
        )
    )

    assert not message.entity[0].vehicle.position.HasField("bearing")
    assert not message.entity[0].vehicle.HasField("trip")
    assert not message.entity[0].vehicle.HasField("timestamp")


@pytest.mark.parametrize("empty", [None, "", "   "], ids=["null", "empty", "whitespace"])
def test_a_mapped_optional_field_with_an_empty_value_stays_absent(empty):
    """Mapping a column does not assert the row has a value in it.

    `bearing` mapped and NULL is still "we do not know", so it must not land
    as 0.0, which is a due-north heading a reader would act on.
    """
    rows = [{"bus": "bus-1", "lat": 34.05, "lon": -118.25, "hdg": empty, "ts": empty}]
    column_map = {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon", "bearing": "hdg", "timestamp": "ts"}

    vehicle = _parse(serialize_vehicle_positions(rows, column_map, feed_timestamp=1700)).entity[0].vehicle

    assert not vehicle.position.HasField("bearing")
    assert not vehicle.HasField("timestamp")


def test_a_mapped_optional_field_with_a_value_is_written():
    rows = [{"bus": "bus-1", "lat": 34.05, "lon": -118.25, "hdg": 0.0, "spd": "12.5"}]
    column_map = {
        "vehicle_id": "bus",
        "latitude": "lat",
        "longitude": "lon",
        "bearing": "hdg",
        "speed": "spd",
    }

    message = _parse(serialize_vehicle_positions(rows, column_map, feed_timestamp=1700))

    position = message.entity[0].vehicle.position
    # A zero that came from the data is a real bearing, and it is written.
    assert position.HasField("bearing")
    assert position.bearing == pytest.approx(0.0)
    assert position.speed == pytest.approx(12.5)


@pytest.mark.parametrize("value", ["north", "nan", "1e39", True], ids=["text", "nan", "float32-overflow", "boolean"])
def test_a_mapped_optional_field_carrying_an_unusable_value_is_refused(value):
    """Non-blank and uncoercible is a source defect, not a silent omission.

    Dropping it hides the defect from the validator that would otherwise name
    it, and mapping the column said it was meant to be published.
    """
    rows = [{"bus": "bus-1", "lat": 34.05, "lon": -118.25, "hdg": value}]
    column_map = {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon", "bearing": "hdg"}

    with pytest.raises(SerializationError) as excinfo:
        serialize_vehicle_positions(rows, column_map, feed_timestamp=1700)

    assert "bearing" in excinfo.value.reason
    assert "row 0" in excinfo.value.reason


@pytest.mark.parametrize("value", [1700, "1700", 1700.0], ids=["int", "text", "whole-float"])
def test_a_whole_second_timestamp_is_written(value):
    rows = [{"bus": "bus-1", "lat": 34.05, "lon": -118.25, "ts": value}]
    column_map = {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon", "timestamp": "ts"}

    vehicle = _parse(serialize_vehicle_positions(rows, column_map, feed_timestamp=1800)).entity[0].vehicle

    assert vehicle.HasField("timestamp")
    assert vehicle.timestamp == 1700


@pytest.mark.parametrize(
    ("value", "fragment"),
    [(1700.5, "whole number"), ("1700.5", "whole number"), ("bad", "not a number"), (-1.0, "range"), (1e20, "range")],
    ids=["fraction", "fraction-text", "text", "negative", "past-uint64"],
)
def test_a_timestamp_the_field_cannot_carry_is_refused(value, fragment):
    """`int(stamp)` used to truncate, moving the reported time in silence."""
    rows = [{"bus": "bus-1", "lat": 34.05, "lon": -118.25, "ts": value}]
    column_map = {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon", "timestamp": "ts"}

    with pytest.raises(SerializationError) as excinfo:
        serialize_vehicle_positions(rows, column_map, feed_timestamp=1800)

    assert "timestamp" in excinfo.value.reason
    assert fragment in excinfo.value.reason
    assert "row 0" in excinfo.value.reason


def test_changed_data_changes_the_bytes():
    """The digest and content-changed rules are noise unless output tracks input.

    Equal input gives equal bytes, and one changed coordinate gives different
    ones. A field the serializer forgot to write is invisible to every other
    assertion but this one.
    """
    rows = [{"bus": "b1", "lat": 34.05, "lon": -118.25, "trip": "t1"}]
    moved = [{"bus": "b1", "lat": 34.05, "lon": -118.26, "trip": "t1"}]

    first = serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700)
    again = serialize_vehicle_positions([dict(rows[0])], COLUMN_MAP, feed_timestamp=1700)
    after_move = serialize_vehicle_positions(moved, COLUMN_MAP, feed_timestamp=1700)

    assert first == again
    assert first != after_move


def test_row_order_is_preserved_not_sorted():
    """Determinism is over equal input, so the feed keeps the query's order."""
    rows = [
        {"bus": "b2", "lat": 34.06, "lon": -118.26, "trip": "t2"},
        {"bus": "b1", "lat": 34.05, "lon": -118.25, "trip": "t1"},
    ]

    message = _parse(serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700))

    assert [entity.id for entity in message.entity] == ["b2", "b1"]


def test_duplicate_entity_ids_are_refused():
    rows = [
        {"bus": "b1", "lat": 34.05, "lon": -118.25, "trip": "t1"},
        {"bus": "b1", "lat": 34.06, "lon": -118.26, "trip": "t2"},
    ]

    with pytest.raises(SerializationError) as excinfo:
        serialize_vehicle_positions(rows, COLUMN_MAP, feed_timestamp=1700)

    assert "b1" in excinfo.value.reason


def test_an_empty_row_set_is_an_empty_feed_not_an_error():
    """Nothing running is a fact a feed can state; a complete map says so."""
    message = _parse(serialize_vehicle_positions([], COLUMN_MAP, feed_timestamp=1700))

    assert message.header.timestamp == 1700
    assert list(message.entity) == []

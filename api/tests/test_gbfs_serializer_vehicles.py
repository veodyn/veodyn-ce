"""The GBFS vehicles shape, per version, plus its field vocabulary ratchet.

The shape is free-floating rather than docked, and the two versions disagree
about more than one spelling: 2.3 files it as `free_bike_status.json` under
`data.bikes` keyed by `bike_id`, 3.0 as `vehicle_status.json` under
`data.vehicles` keyed by `vehicle_id`. Both spellings come out of the schemas in
the pinned gbfs-validator distribution.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from veodyn_api.services.gbfs_serializer import (
    REQUIRED_FIELDS,
    SUPPORTED_FIELDS,
    member_files,
    serialize_gbfs,
)
from veodyn_api.services.gtfs_rt_serializer import SerializationError

VOCABULARY = json.loads((Path(__file__).parent / "gbfs_field_vocabulary.json").read_text())

COLUMN_MAP = {
    "vehicle_id": "vid",
    "lat": "y",
    "lon": "x",
    "is_reserved": "res",
    "is_disabled": "dis",
    "last_reported": "seen",
    "current_range_meters": "range",
}
SYSTEM_23 = {"system_id": "city", "language": "en", "name": "City Bikes", "timezone": "America/New_York"}
SYSTEM_30 = dict(SYSTEM_23, opening_hours="24/7", feed_contact_email="ops@city.example")
# Values a query really returns: a coordinate as text, a flag as 0/1, a range as
# text. What is asserted below is what the serializer makes of them.
ROW = {"vid": "v1", "y": "34.05", "x": "-118.24", "res": 0, "dis": 1, "seen": 1755400000, "range": "12000"}


def _serialize(
    version: str = "2.3",
    rows: list[dict[str, Any]] | None = None,
    column_map: dict[str, str] | None = None,
) -> dict[str, Any]:
    return serialize_gbfs(
        "vehicles",
        rows if rows is not None else [ROW],
        COLUMN_MAP if column_map is None else column_map,
        SYSTEM_23 if version == "2.3" else SYSTEM_30,
        version,
        slug="scooters-live",
        origin="https://veodyn.example",
        feed_timestamp=1755400100,
    )


def test_23_files_a_free_floating_system_as_free_bike_status() -> None:
    files = _serialize()
    assert set(files) == {"gbfs.json", "system_information.json", "free_bike_status.json"}
    disco = files["gbfs.json"]
    feeds = {f["name"]: f["url"] for f in disco["data"]["en"]["feeds"]}
    assert set(feeds) == {"system_information", "free_bike_status"}
    assert feeds["free_bike_status"] == "https://veodyn.example/api/public/feeds/scooters-live/free_bike_status.json"
    bike = files["free_bike_status.json"]["data"]["bikes"][0]
    assert bike["bike_id"] == "v1"
    assert "vehicle_id" not in bike
    assert bike["lat"] == 34.05
    assert bike["lon"] == -118.24
    assert bike["is_reserved"] is False
    assert bike["is_disabled"] is True
    assert bike["last_reported"] == 1755400000
    assert bike["current_range_meters"] == 12000.0


def test_30_files_it_as_vehicle_status_and_stamps_rfc3339() -> None:
    files = _serialize(version="3.0")
    assert set(files) == {"gbfs.json", "system_information.json", "vehicle_status.json"}
    disco = files["gbfs.json"]
    assert disco["last_updated"] == "2025-08-17T03:08:20Z"
    assert {f["name"] for f in disco["data"]["feeds"]} == {"system_information", "vehicle_status"}
    vehicle = files["vehicle_status.json"]["data"]["vehicles"][0]
    assert vehicle["vehicle_id"] == "v1"
    assert "bike_id" not in vehicle
    assert vehicle["last_reported"] == "2025-08-17T03:06:40Z"
    assert files["system_information.json"]["data"]["languages"] == ["en"]


def test_no_station_file_is_written_for_this_shape() -> None:
    """A docked file set published off a dockless binding would validate as a
    system with no stations, which is not the same claim."""
    for version in ("2.3", "3.0"):
        assert not [name for name in _serialize(version=version) if name.startswith("station_")]
        assert not [name for name in member_files("vehicles", version) if name.startswith("station_")]


def test_the_stations_shape_keeps_its_own_file_set() -> None:
    assert member_files("stations", "2.3") == member_files("stations", "3.0")
    assert set(member_files("stations", "2.3")) == {
        "system_information.json",
        "station_information.json",
        "station_status.json",
    }


@pytest.mark.parametrize("field", ["vehicle_id", "lat", "lon", "is_reserved", "is_disabled", "last_reported"])
def test_every_required_field_is_refused_blank_by_name(field: str) -> None:
    with pytest.raises(SerializationError, match=f"required field {field} is blank"):
        _serialize(rows=[{key: value for key, value in ROW.items() if key != COLUMN_MAP[field]}])


@pytest.mark.parametrize("field", ["vehicle_id", "lat", "lon", "is_reserved", "is_disabled", "last_reported"])
def test_every_required_field_is_refused_unmapped_by_name(field: str) -> None:
    with pytest.raises(SerializationError, match=f"missing required field.*{field}"):
        _serialize(column_map={key: value for key, value in COLUMN_MAP.items() if key != field})


def test_a_field_this_shape_does_not_write_is_refused_not_dropped() -> None:
    """`vehicle_type_id` is the one somebody reaches for first, and it names a
    vehicle_types.json this version does not publish."""
    with pytest.raises(SerializationError, match="vehicle_type_id"):
        _serialize(column_map={**COLUMN_MAP, "vehicle_type_id": "kind"})
    with pytest.raises(SerializationError, match="station_id"):
        _serialize(column_map={**COLUMN_MAP, "station_id": "sid"})


def test_current_range_meters_is_a_finite_non_negative_number_or_absent() -> None:
    for value in ("far", True, float("nan"), float("inf")):
        with pytest.raises(SerializationError, match="current_range_meters"):
            _serialize(rows=[dict(ROW, range=value)])
    with pytest.raises(SerializationError, match="negative"):
        _serialize(rows=[dict(ROW, range=-1)])
    without = {key: value for key, value in ROW.items() if key != "range"}
    bike = _serialize(rows=[without])["free_bike_status.json"]["data"]["bikes"][0]
    assert "current_range_meters" not in bike


def test_a_coordinate_outside_its_bounds_is_still_refused_here() -> None:
    with pytest.raises(SerializationError, match="outside"):
        _serialize(rows=[dict(ROW, y=91)])
    with pytest.raises(SerializationError, match="outside"):
        _serialize(rows=[dict(ROW, x=181)])


def test_a_flag_that_is_not_a_boolean_is_refused() -> None:
    with pytest.raises(SerializationError, match="is_reserved"):
        _serialize(rows=[dict(ROW, res="maybe")])


def test_a_repeated_vehicle_id_is_refused_naming_the_row() -> None:
    with pytest.raises(SerializationError, match="row 1: duplicate vehicle_id 'v1'"):
        _serialize(rows=[ROW, dict(ROW)])


def test_member_files_refuses_a_shape_rather_than_answering_free_floating() -> None:
    """The two-branch pick reads as "stations, otherwise vehicles", so an unknown
    shape would be handed the dockless file set instead of a refusal."""
    with pytest.raises(SerializationError, match="shape 'docks'"):
        member_files("docks", "2.3")
    with pytest.raises(SerializationError, match="version '9.9'"):
        member_files("vehicles", "9.9")


def test_a_shape_this_serializer_does_not_write_is_refused() -> None:
    with pytest.raises(SerializationError, match="shape 'docks'"):
        serialize_gbfs(
            "docks", [ROW], COLUMN_MAP, SYSTEM_23, "2.3", slug="s", origin="https://x", feed_timestamp=1755400100
        )


def test_a_clean_vehicles_feed_is_serializable_as_real_json() -> None:
    assert "NaN" not in json.dumps(_serialize(version="3.0"))


def test_the_required_fields_are_the_ones_the_frontend_marks_required() -> None:
    assert sorted(REQUIRED_FIELDS["vehicles"]) == sorted(VOCABULARY["vehicles"]["required"])


def test_the_supported_fields_are_the_ones_the_frontend_offers() -> None:
    offered = VOCABULARY["vehicles"]["required"] + VOCABULARY["vehicles"]["optional"]
    assert sorted(SUPPORTED_FIELDS["vehicles"]) == sorted(offered)

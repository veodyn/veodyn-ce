"""The GBFS station serializer, per version, plus the field vocabulary ratchet.

The vocabulary tests read `gbfs_field_vocabulary.json` the way
`test_gtfs_field_vocabulary.py` reads its own fixture: the frontend mapping
editor is the second copy, and a failure here means it needs the same change.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from veodyn_api.services.gbfs_serializer import (
    REQUIRED_FIELDS,
    SUPPORTED_FIELDS,
    SUPPORTED_VERSIONS,
    serialize_gbfs_stations,
)
from veodyn_api.services.gtfs_rt_serializer import SerializationError

VOCABULARY = json.loads((Path(__file__).parent / "gbfs_field_vocabulary.json").read_text())

COLUMN_MAP = {
    "station_id": "sid",
    "name": "label",
    "lat": "lat",
    "lon": "lon",
    "num_vehicles_available": "bikes",
    "is_installed": "inst",
    "is_renting": "rent",
    "is_returning": "ret",
    "last_reported": "seen",
    "capacity": "cap",
}
SYSTEM_23 = {"system_id": "city", "language": "en", "name": "City Bikes", "timezone": "America/New_York"}
ROW = {
    "sid": "s1",
    "label": "Main St",
    "lat": 34.05,
    "lon": -118.24,
    "bikes": 4,
    "inst": 1,
    "rent": True,
    "ret": 1,
    "seen": 1755400000,
    "cap": 12,
}


def _serialize(
    version: str = "2.3",
    system: dict[str, str] = SYSTEM_23,
    rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return serialize_gbfs_stations(
        rows if rows is not None else [ROW],
        COLUMN_MAP,
        system,
        version,
        slug="bikes-live",
        origin="https://veodyn.example",
        feed_timestamp=1755400100,
    )


def test_versions_are_the_two_this_serializer_writes() -> None:
    assert SUPPORTED_VERSIONS == ("2.3", "3.0")


def test_23_shapes() -> None:
    files = _serialize()
    assert set(files) == {
        "gbfs.json",
        "system_information.json",
        "station_information.json",
        "station_status.json",
    }
    disco = files["gbfs.json"]
    assert disco["version"] == "2.3"
    assert disco["last_updated"] == 1755400100
    feeds = {f["name"]: f["url"] for f in disco["data"]["en"]["feeds"]}
    assert feeds["station_status"] == "https://veodyn.example/api/public/feeds/bikes-live/station_status.json"
    status = files["station_status.json"]["data"]["stations"][0]
    assert status["num_bikes_available"] == 4
    assert status["is_renting"] is True
    assert status["last_reported"] == 1755400000
    info = files["station_information.json"]["data"]["stations"][0]
    assert info["name"] == "Main St"
    assert info["capacity"] == 12
    assert files["system_information.json"]["data"]["language"] == "en"


def test_30_shapes() -> None:
    system = dict(SYSTEM_23, opening_hours="24/7", feed_contact_email="ops@city.example")
    files = _serialize(version="3.0", system=system)
    disco = files["gbfs.json"]
    assert disco["last_updated"] == "2025-08-17T03:08:20Z"
    assert {f["name"] for f in disco["data"]["feeds"]} == {
        "system_information",
        "station_information",
        "station_status",
    }
    status = files["station_status.json"]["data"]["stations"][0]
    assert status["num_vehicles_available"] == 4
    assert status["last_reported"] == "2025-08-17T03:06:40Z"
    info = files["station_information.json"]["data"]["stations"][0]
    assert info["name"] == [{"text": "Main St", "language": "en"}]
    sysinfo = files["system_information.json"]["data"]
    assert sysinfo["languages"] == ["en"]
    assert sysinfo["name"] == [{"text": "City Bikes", "language": "en"}]


def test_refusals_name_row_and_field() -> None:
    with pytest.raises(SerializationError, match="row 0.*lat"):
        _serialize(rows=[dict(ROW, lat="north")])
    with pytest.raises(SerializationError, match="is_renting"):
        _serialize(rows=[dict(ROW, rent="open")])
    with pytest.raises(SerializationError, match="station_id"):
        _serialize(rows=[ROW, dict(ROW)])
    with pytest.raises(SerializationError, match="required"):
        serialize_gbfs_stations(
            [ROW], {"station_id": "sid"}, SYSTEM_23, "2.3", slug="s", origin="https://x", feed_timestamp=1
        )


def test_a_value_that_cannot_honestly_become_its_field_is_refused() -> None:
    """Each of these produced a published artifact before: nan and inf serialize
    as bare NaN/Infinity, which are not JSON, and the rest are simply false."""
    for value in (float("nan"), float("inf"), True):
        with pytest.raises(SerializationError, match="lat"):
            _serialize(rows=[dict(ROW, lat=value)])
    with pytest.raises(SerializationError, match="outside"):
        _serialize(rows=[dict(ROW, lat=91)])
    with pytest.raises(SerializationError, match="outside"):
        _serialize(rows=[dict(ROW, lon=181)])
    with pytest.raises(SerializationError, match="negative"):
        _serialize(rows=[dict(ROW, bikes=-5)])
    with pytest.raises(SerializationError, match="POSIX"):
        _serialize(rows=[dict(ROW, seen=0)])


def test_a_feed_timestamp_out_of_range_is_refused_not_crashed() -> None:
    """10**18 reached datetime.fromtimestamp on the 3.0 path and raised
    OverflowError, which is not a SerializationError and names no field."""
    with pytest.raises(SerializationError, match="feed_timestamp"):
        serialize_gbfs_stations(
            [ROW], COLUMN_MAP, SYSTEM_23, "2.3", slug="s", origin="https://x", feed_timestamp=10**18
        )


def test_a_clean_feed_is_serializable_as_real_json() -> None:
    assert "NaN" not in json.dumps(_serialize())


def test_the_required_fields_are_the_ones_the_frontend_marks_required() -> None:
    assert sorted(REQUIRED_FIELDS["stations"]) == sorted(VOCABULARY["stations"]["required"])


def test_the_supported_fields_are_the_ones_the_frontend_offers() -> None:
    offered = VOCABULARY["stations"]["required"] + VOCABULARY["stations"]["optional"]
    assert sorted(SUPPORTED_FIELDS["stations"]) == sorted(offered)

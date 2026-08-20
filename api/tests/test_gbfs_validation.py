import copy
import tempfile
from typing import Any

import pytest

from veodyn_api.services import gbfs_validation
from veodyn_api.services.gbfs_serializer import serialize_gbfs, serialize_gbfs_stations
from veodyn_api.services.gbfs_validation import discovery_for_validation, validate_gbfs_files
from veodyn_api.services.published_feed_validator import ValidatorUnavailable

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
}
SYSTEM_23 = {"system_id": "city", "language": "en", "name": "City Bikes", "timezone": "America/New_York"}
SYSTEM_30 = dict(SYSTEM_23, opening_hours="24/7", feed_contact_email="ops@city.example")
ROW = {
    "sid": "s1",
    "label": "Main St",
    "lat": 34.05,
    "lon": -118.24,
    "bikes": 4,
    "inst": 1,
    "rent": 1,
    "ret": 1,
    "seen": 1755400000,
}

VEHICLE_MAP = {
    "vehicle_id": "vid",
    "lat": "y",
    "lon": "x",
    "is_reserved": "res",
    "is_disabled": "dis",
    "last_reported": "seen",
    "current_range_meters": "range",
}
VEHICLE_ROW = {"vid": "v1", "y": 34.05, "x": -118.24, "res": 0, "dis": 0, "seen": 1755400000, "range": 12000}


def _files(version: str = "2.3", system: dict[str, str] = SYSTEM_23) -> dict[str, Any]:
    return serialize_gbfs_stations(
        [ROW],
        COLUMN_MAP,
        system,
        version,
        slug="bikes-live",
        origin="https://veodyn.example",
        feed_timestamp=1755400100,
    )


def _vehicle_files(version: str = "2.3", system: dict[str, str] = SYSTEM_23) -> dict[str, Any]:
    return serialize_gbfs(
        "vehicles",
        [VEHICLE_ROW],
        VEHICLE_MAP,
        system,
        version,
        slug="scooters-live",
        origin="https://veodyn.example",
        feed_timestamp=1755400100,
    )


def _blank_urls(discovery: dict[str, Any]) -> dict[str, Any]:
    """The discovery document with every member url replaced, so two can be compared."""
    data = discovery["data"]
    groups = [data] if isinstance(data.get("feeds"), list) else list(data.values())
    for group in groups:
        for entry in group["feeds"]:
            entry["url"] = "X"
    return discovery


@pytest.mark.parametrize("version,system", [("2.3", SYSTEM_23), ("3.0", SYSTEM_30)])
def test_a_clean_serialized_feed_validates_clean(version: str, system: dict[str, str]) -> None:
    outcome = validate_gbfs_files(_files(version=version, system=system), version, "stations")
    assert not outcome.has_error
    assert outcome.findings == ()
    assert "station_status.json" in outcome.enabled_rules
    assert "gbfs.json" in outcome.enabled_rules


@pytest.mark.parametrize(
    "version,system,name",
    [("2.3", SYSTEM_23, "free_bike_status.json"), ("3.0", SYSTEM_30, "vehicle_status.json")],
)
def test_a_clean_vehicles_feed_validates_clean(version: str, system: dict[str, str], name: str) -> None:
    outcome = validate_gbfs_files(_vehicle_files(version=version, system=system), version, "vehicles")
    assert outcome.findings == ()
    assert not outcome.has_error
    assert name in outcome.enabled_rules


def test_the_shape_decides_which_member_files_are_required() -> None:
    """The same file set, judged as a docked system: the two station files it does
    not carry are then required, and every dockless publish would block on them."""
    outcome = validate_gbfs_files(_vehicle_files(), "2.3", "stations")
    missing = {finding.rule_id for finding in outcome.errors}
    assert {"station_information.json:missing", "station_status.json:missing"} <= missing


@pytest.mark.parametrize(
    "version,system,field",
    [("2.3", SYSTEM_23, "num_bikes_available"), ("3.0", SYSTEM_30, "num_vehicles_available")],
)
def test_a_broken_feed_blocks_with_a_named_pointer(version: str, system: dict[str, str], field: str) -> None:
    files = _files(version=version, system=system)
    del files["station_status.json"]["data"]["stations"][0][field]
    outcome = validate_gbfs_files(files, version, "stations")
    assert outcome.has_error
    finding = outcome.errors[0]
    assert finding.rule_id.startswith("station_status.json#")
    assert field in finding.title
    assert finding.locator == "/data/stations/0"
    assert finding.severity == "ERROR"
    assert finding.occurrence_count == 1


@pytest.mark.parametrize(
    "version,system,name",
    [("2.3", SYSTEM_23, "free_bike_status.json"), ("3.0", SYSTEM_30, "vehicle_status.json")],
)
def test_a_dockless_feed_owes_its_status_file(version: str, system: dict[str, str], name: str) -> None:
    """Not merely validated when present: REQUIRED. Without the free-floating flag
    the package treats this file as optional, so a set that lost it would publish
    a system declaring no vehicles at all."""
    files = _vehicle_files(version=version, system=system)
    del files[name]

    outcome = validate_gbfs_files(files, version, "vehicles")

    assert outcome.has_error
    missing = [finding for finding in outcome.errors if finding.rule_id == f"{name}:missing"]
    assert len(missing) == 1
    assert missing[0].title == "required file is not published"


def test_a_shape_this_adapter_cannot_name_a_file_table_for_is_refused() -> None:
    """Not judged as free-floating by falling through: a shape outside the two is
    a shape whose required files nobody has stated."""
    with pytest.raises(ValidatorUnavailable, match="docks"):
        validate_gbfs_files(_vehicle_files(), "2.3", "docks")


def test_a_missing_required_member_file_blocks() -> None:
    files = _files()
    del files["station_status.json"]
    outcome = validate_gbfs_files(files, "2.3", "stations")
    assert outcome.has_error
    missing = [finding for finding in outcome.errors if finding.rule_id == "station_status.json:missing"]
    assert len(missing) == 1
    assert missing[0].title == "required file is not published"


@pytest.mark.parametrize("version,system", [("2.3", SYSTEM_23), ("3.0", SYSTEM_30)])
def test_stored_and_validated_discovery_differ_only_in_urls(version: str, system: dict[str, str]) -> None:
    files = _files(version=version, system=system)
    with tempfile.TemporaryDirectory() as directory:
        rewritten = discovery_for_validation(files, directory)
        assert "file://" in str(rewritten)
    assert _blank_urls(rewritten) == _blank_urls(copy.deepcopy(files["gbfs.json"]))


def test_rewriting_the_discovery_does_not_touch_the_stored_one() -> None:
    files = _files()
    stored = copy.deepcopy(files["gbfs.json"])
    with tempfile.TemporaryDirectory() as directory:
        discovery_for_validation(files, directory)
    assert files["gbfs.json"] == stored


def test_an_unreadable_report_is_refused_not_empty() -> None:
    with pytest.raises(ValidatorUnavailable):
        validate_gbfs_files({"gbfs.json": {"nonsense": True}}, "2.3", "stations")


def test_a_version_the_package_does_not_implement_is_refused() -> None:
    with pytest.raises(ValidatorUnavailable):
        validate_gbfs_files(_files(), "9.9", "stations")


def test_a_report_that_names_no_version_is_refused() -> None:
    """With no discovery document the package answers a summary and no files."""
    files = _files()
    del files["gbfs.json"]
    with pytest.raises(ValidatorUnavailable, match="does not implement"):
        validate_gbfs_files(files, "2.3", "stations")


def test_a_discovery_that_is_not_an_object_is_refused() -> None:
    with pytest.raises(ValidatorUnavailable):
        validate_gbfs_files({"gbfs.json": []}, "2.3", "stations")


def test_a_report_with_results_but_no_summary_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """The summary is the verdict. `report.get("summary") or {}` turned an absent
    one into a clean pass carrying a non-empty enabled_rules, which is exactly
    the shape publish_engine reads as validated with no findings."""
    report = {"files": [{"file": "gbfs.json", "required": True, "exists": True, "errors": False}]}
    monkeypatch.setattr(gbfs_validation, "_run", lambda files, version, shape: report)
    with pytest.raises(ValidatorUnavailable, match="summary"):
        validate_gbfs_files({"gbfs.json": {}}, "2.3", "stations")


def test_a_summary_that_does_not_say_whether_there_are_errors_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    report = {
        "summary": {"validatorVersion": "0.1.0"},
        "files": [{"file": "gbfs.json", "required": True, "exists": True, "errors": False}],
    }
    monkeypatch.setattr(gbfs_validation, "_run", lambda files, version, shape: report)
    with pytest.raises(ValidatorUnavailable, match="has errors"):
        validate_gbfs_files({"gbfs.json": {}}, "2.3", "stations")

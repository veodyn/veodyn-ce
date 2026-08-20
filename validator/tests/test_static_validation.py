"""Wiring tests against the REAL gtfs_validator package: `validate_static_archive`
runs the actual pipeline against a real archive on disk, so these prove the
report/summary/system_errors plumbing works against the package rather than
against this project's own mental model of it.

`test_routes.py` covers the HTTP layer with the package boundary faked; this
covers the one piece that must not be faked.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

from gtfs_validator.report import dumps_json

from tests.fixtures import archive_with_decimal_price_bytes, minimal_static_archive_bytes
from validator_service.static_validation import validate_static_archive


def _write_archive(tmp_path: Path, content: bytes | None = None) -> Path:
    archive_path = tmp_path / "gtfs.zip"
    archive_path.write_bytes(content if content is not None else minimal_static_archive_bytes())
    return archive_path


def test_valid_archive_returns_a_report_carrying_a_summary(tmp_path: Path) -> None:
    archive_path = _write_archive(tmp_path)

    result = validate_static_archive(archive_path, gtfs_input="test-fixture://minimal")

    assert set(result.keys()) == {"report", "systemErrors"}
    report = cast(dict[str, Any], result["report"])
    assert "summary" in report
    assert "notices" in report
    assert report["summary"]["gtfsInput"] == "test-fixture://minimal"


def test_valid_archive_opens_with_no_system_errors(tmp_path: Path) -> None:
    archive_path = _write_archive(tmp_path)

    result = validate_static_archive(archive_path, gtfs_input="test-fixture://minimal")

    system_errors = cast(dict[str, Any], result["systemErrors"])
    assert system_errors == {"notices": []}
    report = cast(dict[str, Any], result["report"])
    assert "feedInfo" in report["summary"], "an archive that opened must carry feed facts"


def test_valid_archive_summary_carries_the_run_metrics(tmp_path: Path) -> None:
    """The successful summary must match what the package's own CLI produces:
    a populated memory register and a real elapsed time, not the `None`s a
    caller that supplies no register gets (see README.md's parity claim)."""
    archive_path = _write_archive(tmp_path)

    result = validate_static_archive(archive_path, gtfs_input="test-fixture://minimal")

    summary = cast(dict[str, Any], cast(dict[str, Any], result["report"])["summary"])
    assert isinstance(summary["validationTimeSeconds"], float)
    assert summary["validationTimeSeconds"] >= 0
    assert summary["memoryUsageRecords"], "the register must have taken at least one reading"


def test_corrupt_archive_is_reported_in_system_errors_not_raised(tmp_path: Path) -> None:
    """The package's own semantics: an archive that will not open is recorded
    in system_errors rather than raised, so the endpoint answers 200 with the
    failure inside `systemErrors` (see README.md for the reasoning)."""
    archive_path = _write_archive(tmp_path, content=b"not a zip file at all")

    result = validate_static_archive(archive_path, gtfs_input="test-fixture://corrupt")

    system_errors = cast(dict[str, Any], result["systemErrors"])
    assert system_errors["notices"], "a corrupt archive must be recorded, not silently dropped"
    report = cast(dict[str, Any], result["report"])
    assert "feedInfo" not in report["summary"], "an archive that never opened has no feed facts"


def test_report_containing_decimal_context_serializes_via_dumps_json(tmp_path: Path) -> None:
    """Notices can carry a raw Decimal in their context (see the reference
    package's `typing_checks.check_number`). The response layer must route
    through the package's own `dumps_json` rather than stdlib `json.dumps`,
    which cannot serialize a Decimal at all and 500s instead of returning the
    report."""
    archive_path = _write_archive(tmp_path, content=archive_with_decimal_price_bytes())

    result = validate_static_archive(archive_path, gtfs_input="test-fixture://decimal-price")

    notices = cast(list[dict[str, Any]], cast(dict[str, Any], result["report"])["notices"])
    assert any(n["code"] == "number_out_of_range" for n in notices)
    dumps_json(result)  # must not raise TypeError: Object of type Decimal is not JSON serializable

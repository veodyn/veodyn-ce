"""HTTP contract tests for `POST /validate-static`.

The heavy call (`validate_static_archive`, which runs the real gtfs_validator
pipeline) is faked in most of these, per the brief: `test_static_validation.py`
covers it against the real package. Three tests below run the real package
end to end through the route regardless (`test_real_pipeline_...`,
`test_unopenable_zip_with_invalid_utf8_filename_still_returns_200`, and
`test_temp_directory_is_removed_after_the_response`), so the router's own
serialization and cleanup are covered by something other than a mock that
only proves the mock agrees with itself. The URL path is exercised against
the real `download` function with respx mocking the transport, matching
`test_fetch.py`'s convention. Resource-bound cases (oversized upload/download,
the body-size middleware, the zip-bomb check) are in
`test_static_routes_limits.py`, split out by the file-size hook.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.fixtures import archive_with_decimal_price_bytes, zip_with_invalid_utf8_filename_bytes
from validator_service import routes
from validator_service.dependencies import StaticLimits, get_static_limits
from validator_service.main import create_app
from validator_service.settings import Settings

GTFS_URL = "https://example.org/gtfs.zip"


def _client(
    *,
    timeout: float = 5.0,
    max_compressed_bytes: int = 200_000_000,
    max_uncompressed_bytes: int = 4_000_000_000,
) -> TestClient:
    # Not run through the app's own lifespan (TestClient only triggers it as a
    # context manager), so the limits dependency is overridden directly,
    # mirroring how test_routes.py overrides get_cache instead of touching
    # app.state through a real startup. static_archive_max_compressed_bytes is
    # still passed to Settings itself (not just the override below) since
    # that value also drives MaxBodySizeMiddleware, which reads app.state
    # indirectly through create_app's own closure, not the StaticLimits
    # dependency.
    app = create_app(
        Settings(cache_size=1, cache_ttl_seconds=60.0, static_archive_max_compressed_bytes=max_compressed_bytes)
    )
    app.dependency_overrides[get_static_limits] = lambda: StaticLimits(
        fetch_timeout_seconds=timeout,
        max_compressed_bytes=max_compressed_bytes,
        max_uncompressed_bytes=max_uncompressed_bytes,
    )
    return TestClient(app)


def test_upload_happy_path_returns_the_report(monkeypatch: pytest.MonkeyPatch) -> None:
    canned = {"report": {"summary": {"mode": "modern"}, "notices": []}, "systemErrors": {"notices": []}}
    captured: dict[str, Any] = {}

    def fake_validate(archive_path: Path, *, gtfs_input: str) -> dict[str, Any]:
        captured["bytes"] = archive_path.read_bytes()
        captured["gtfs_input"] = gtfs_input
        return canned

    monkeypatch.setattr(routes, "validate_static_archive", fake_validate)
    client = _client()

    response = client.post(
        "/validate-static",
        files={"archive": ("gtfs.zip", b"pretend-zip-bytes", "application/zip")},
    )

    assert response.status_code == 200
    assert response.json() == canned
    assert captured["bytes"] == b"pretend-zip-bytes"
    assert captured["gtfs_input"] == "gtfs.zip"


@respx.mock
def test_url_happy_path_downloads_then_validates(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real `download` runs, against a respx-mocked transport; only the
    pipeline call underneath `validate_static_archive` is faked."""
    respx.get(GTFS_URL).mock(return_value=httpx.Response(200, content=b"downloaded-zip-bytes"))
    canned = {"report": {"summary": {}, "notices": []}, "systemErrors": {"notices": []}}
    captured: dict[str, Any] = {}

    def fake_validate(archive_path: Path, *, gtfs_input: str) -> dict[str, Any]:
        captured["bytes"] = archive_path.read_bytes()
        captured["gtfs_input"] = gtfs_input
        return canned

    monkeypatch.setattr(routes, "validate_static_archive", fake_validate)
    client = _client()

    response = client.post("/validate-static", data={"gtfs": GTFS_URL})

    assert response.status_code == 200
    assert response.json() == canned
    assert captured["bytes"] == b"downloaded-zip-bytes"
    assert captured["gtfs_input"] == GTFS_URL


def test_both_archive_and_gtfs_returns_400() -> None:
    client = _client()

    response = client.post(
        "/validate-static",
        data={"gtfs": GTFS_URL},
        files={"archive": ("gtfs.zip", b"bytes", "application/zip")},
    )

    assert response.status_code == 400
    assert "exactly one" in response.json()["error"]


def test_neither_archive_nor_gtfs_returns_400() -> None:
    client = _client()

    response = client.post("/validate-static")

    assert response.status_code == 400
    assert "exactly one" in response.json()["error"]


def test_blank_gtfs_field_is_treated_as_absent_and_returns_400() -> None:
    client = _client()

    response = client.post("/validate-static", data={"gtfs": "   "})

    assert response.status_code == 400
    assert "exactly one" in response.json()["error"]


def test_empty_upload_returns_400() -> None:
    client = _client()

    response = client.post(
        "/validate-static",
        files={"archive": ("gtfs.zip", b"", "application/zip")},
    )

    assert response.status_code == 400
    assert "archive" in response.json()["error"]


def test_empty_upload_with_a_gtfs_url_falls_back_to_the_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """README.md documents an empty upload as equivalent to an absent one, so
    it must not trip the both-inputs 400 when a valid gtfs URL is also given;
    the URL must be used instead."""
    canned = {"report": {"summary": {}, "notices": []}, "systemErrors": {"notices": []}}
    captured: dict[str, Any] = {}

    def fake_download(url: str, destination: Path, *, timeout: float, max_bytes: int) -> None:
        captured["url"] = url
        destination.write_bytes(b"downloaded-zip-bytes")

    def fake_validate(archive_path: Path, *, gtfs_input: str) -> dict[str, Any]:
        captured["gtfs_input"] = gtfs_input
        return canned

    monkeypatch.setattr(routes, "download", fake_download)
    monkeypatch.setattr(routes, "validate_static_archive", fake_validate)
    client = _client()

    response = client.post(
        "/validate-static",
        data={"gtfs": GTFS_URL},
        files={"archive": ("gtfs.zip", b"", "application/zip")},
    )

    assert response.status_code == 200
    assert captured["url"] == GTFS_URL
    assert captured["gtfs_input"] == GTFS_URL


@respx.mock
def test_fetch_failure_returns_502() -> None:
    respx.get(GTFS_URL).mock(side_effect=httpx.ConnectError("connection refused"))
    client = _client()

    response = client.post("/validate-static", data={"gtfs": GTFS_URL})

    assert response.status_code == 502
    assert GTFS_URL in response.json()["error"]


def test_malformed_gtfs_url_returns_502() -> None:
    """`httpx.InvalidURL` must be mapped the same as any other fetch failure,
    not escape as an unhandled 500."""
    client = _client()

    response = client.post("/validate-static", data={"gtfs": "http://[::1"})

    assert response.status_code == 502


def test_corrupt_archive_still_returns_200_with_system_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    """Per the package's own semantics (documented in README.md): an archive
    that never opens is a 200 with the failure recorded in `systemErrors`, not
    a 400. This fakes `validate_static_archive` to return exactly that shape
    and checks the router passes it through untouched."""
    canned = {
        "report": {"summary": {"validatorVersion": "0.1.2"}, "notices": []},
        "systemErrors": {"notices": [{"code": "runtime_exception", "totalNotices": 1, "sampleNotices": []}]},
    }
    monkeypatch.setattr(routes, "validate_static_archive", lambda archive_path, *, gtfs_input: canned)
    client = _client()

    response = client.post(
        "/validate-static",
        files={"archive": ("gtfs.zip", b"not a real zip", "application/zip")},
    )

    assert response.status_code == 200
    assert response.json() == canned
    assert response.json()["systemErrors"]["notices"]


def test_unopenable_zip_with_invalid_utf8_filename_still_returns_200() -> None:
    """Regression: a structurally valid zip whose central directory
    `zipfile` cannot decode (`UnicodeDecodeError`, not `BadZipFile`) must not
    500 out of the uncompressed-size precheck. Real pipeline, nothing
    monkeypatched: the package's own `open_feed` catches this too and it
    still reaches the documented 200-with-systemErrors path."""
    client = _client()

    response = client.post(
        "/validate-static",
        files={"archive": ("gtfs.zip", zip_with_invalid_utf8_filename_bytes(), "application/zip")},
    )

    assert response.status_code == 200
    assert response.json()["systemErrors"]["notices"]


def test_real_pipeline_response_serializes_with_decimal_notices() -> None:
    """End to end through the REAL package, nothing monkeypatched: a
    fare_attributes.txt with a negative price produces a number_out_of_range
    notice carrying a raw Decimal in its context. Before dumps_json was wired
    in, this 500'd, because JSONResponse's stdlib json.dumps cannot serialize
    a Decimal."""
    client = _client()

    response = client.post(
        "/validate-static",
        files={"archive": ("gtfs.zip", archive_with_decimal_price_bytes(), "application/zip")},
    )

    assert response.status_code == 200
    notices = response.json()["report"]["notices"]
    assert any(n["code"] == "number_out_of_range" for n in notices)


def test_temp_directory_is_removed_after_the_response(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_validate(archive_path: Path, *, gtfs_input: str) -> dict[str, Any]:
        captured["archive_path"] = archive_path
        return {"report": {"summary": {}, "notices": []}, "systemErrors": {"notices": []}}

    monkeypatch.setattr(routes, "validate_static_archive", fake_validate)
    client = _client()

    response = client.post(
        "/validate-static",
        files={"archive": ("gtfs.zip", b"pretend-zip-bytes", "application/zip")},
    )

    assert response.status_code == 200
    archive_path = captured["archive_path"]
    assert not archive_path.exists(), "the archive file must be gone once the response is built"
    assert not archive_path.parent.exists(), "the temporary directory itself must be removed"

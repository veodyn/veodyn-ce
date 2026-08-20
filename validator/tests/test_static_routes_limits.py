"""Resource-bound HTTP tests for `POST /validate-static`, split out of
`test_static_routes.py` by the file-size hook: the oversized-upload,
oversized-download, zip-bomb and request-body-cap cases, all exercising
`archive_limits.py` / `body_size_limit.py` through the real route.
"""

from __future__ import annotations

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.fixtures import minimal_static_archive_bytes
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
    # See test_static_routes.py's _client for why static_archive_max_compressed_bytes
    # is passed to Settings itself as well as overridden below: it also drives
    # MaxBodySizeMiddleware, wired from Settings in create_app, not from the
    # StaticLimits dependency.
    app = create_app(
        Settings(cache_size=1, cache_ttl_seconds=60.0, static_archive_max_compressed_bytes=max_compressed_bytes)
    )
    app.dependency_overrides[get_static_limits] = lambda: StaticLimits(
        fetch_timeout_seconds=timeout,
        max_compressed_bytes=max_compressed_bytes,
        max_uncompressed_bytes=max_uncompressed_bytes,
    )
    return TestClient(app)


@respx.mock
def test_oversized_download_returns_502() -> None:
    respx.get(GTFS_URL).mock(return_value=httpx.Response(200, content=b"x" * 100))
    client = _client(max_compressed_bytes=10)

    response = client.post("/validate-static", data={"gtfs": GTFS_URL})

    assert response.status_code == 502


def test_oversized_upload_returns_400() -> None:
    client = _client(max_compressed_bytes=10)

    response = client.post(
        "/validate-static",
        files={"archive": ("gtfs.zip", b"x" * 100, "application/zip")},
    )

    assert response.status_code == 400
    assert "size limit" in response.json()["error"]


def test_oversized_request_body_is_rejected_with_413_before_the_route_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    """`MaxBodySizeMiddleware` sits ahead of multipart parsing: a body big
    enough to also clear its overhead slack must be rejected with 413 before
    `validate_static_archive` (and even `write_capped`) ever run."""
    called = False

    def fail_if_called(*args: object, **kwargs: object) -> dict[str, object]:
        nonlocal called
        called = True
        return {"report": {"summary": {}, "notices": []}, "systemErrors": {"notices": []}}

    monkeypatch.setattr(routes, "validate_static_archive", fail_if_called)
    client = _client(max_compressed_bytes=10)

    response = client.post(
        "/validate-static",
        files={"archive": ("gtfs.zip", b"x" * 100_000, "application/zip")},
    )

    assert response.status_code == 413
    assert not called, "the route must never run for a request this oversized"


def test_absurd_uncompressed_expansion_returns_400() -> None:
    """A real, valid zip whose declared uncompressed total exceeds the
    configured ceiling must be rejected before validation runs: the zip-bomb
    check. A tiny ceiling stands in for a genuinely tiny compressed payload
    that expands far past it."""
    client = _client(max_uncompressed_bytes=10)

    response = client.post(
        "/validate-static",
        files={"archive": ("gtfs.zip", minimal_static_archive_bytes(), "application/zip")},
    )

    assert response.status_code == 400
    assert "uncompressed" in response.json()["error"]


def test_oversized_upload_never_reaches_check_uncompressed_size(monkeypatch: pytest.MonkeyPatch) -> None:
    """The size cap must reject before the shared post-write uncompressed
    check runs at all, not merely before validation."""
    called = False

    def fail_if_called(*args: object, **kwargs: object) -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(routes, "check_uncompressed_size", fail_if_called)
    client = _client(max_compressed_bytes=10)

    response = client.post(
        "/validate-static",
        files={"archive": ("gtfs.zip", b"x" * 100, "application/zip")},
    )

    assert response.status_code == 400
    assert not called

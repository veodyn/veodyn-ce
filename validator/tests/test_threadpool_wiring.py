"""Locks the property `routes.py`'s own module docstring promises: every
blocking call on both endpoints goes through `run_in_threadpool`, not an
inline `await`. The wrapper here still executes the real call (so the
response stays genuine, and a test elsewhere that already exercises the
route is not duplicated) and only records which function it was asked to
run. A test that merely checks the final response could not tell this apart
from the blocking call having been inlined; that gap is what this closes.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.fixtures import minimal_static_archive_bytes
from validator_service import routes
from validator_service.dependencies import StaticLimits, get_cache, get_static_limits
from validator_service.main import create_app
from validator_service.settings import Settings

GTFS_URL = "https://example.org/gtfs.zip"
T = TypeVar("T")


class _FakeCache:
    """Just enough of `PreparedFeedCache` for `get_prepared` to be a real,
    recordable blocking call without touching the network or the package."""

    def get_prepared(self, key: str) -> str:
        return "prepared-feed"


def _client() -> TestClient:
    # Not run through the app's own lifespan, so both app.state-backed
    # dependencies are overridden directly; see test_routes.py / test_static_routes.py.
    app = create_app(Settings(cache_size=1, cache_ttl_seconds=60.0))
    app.dependency_overrides[get_cache] = lambda: _FakeCache()
    app.dependency_overrides[get_static_limits] = lambda: StaticLimits(
        fetch_timeout_seconds=5.0, max_compressed_bytes=200_000_000, max_uncompressed_bytes=4_000_000_000
    )
    return TestClient(app)


def _recording_run_in_threadpool(calls: list[str]) -> Callable[..., Awaitable[Any]]:
    """Wraps the real `run_in_threadpool`, recording each `func`'s name
    before delegating to it, so the call still actually happens."""
    real = routes.run_in_threadpool

    async def wrapper(func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        calls.append(getattr(func, "__name__", repr(func)))
        return await real(func, *args, **kwargs)

    return wrapper


def test_validate_blocking_stages_go_through_run_in_threadpool(monkeypatch: pytest.MonkeyPatch) -> None:
    """`run_validation` is faked here (the cache's `prepared-feed` sentinel is
    not a real `PreparedFeed`, per `test_routes.py`'s own convention), so this
    proves the threadpool wiring, not the real package; `test_validation_wiring.py`
    covers the real package."""
    calls: list[str] = []

    def fake_run_validation(prepared: object, feed_bytes: bytes, previous_bytes: bytes | None) -> dict[str, Any]:
        return {"notices": []}

    monkeypatch.setattr(routes, "run_in_threadpool", _recording_run_in_threadpool(calls))
    monkeypatch.setattr(routes, "run_validation", fake_run_validation)
    client = _client()

    response = client.post(
        "/validate",
        data={"gtfs": GTFS_URL},
        files={"feed": ("feed.pb", b"current-bytes", "application/octet-stream")},
    )

    assert response.status_code == 200
    assert "get_prepared" in calls
    assert "fake_run_validation" in calls


def test_validate_static_upload_blocking_stages_go_through_run_in_threadpool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(routes, "run_in_threadpool", _recording_run_in_threadpool(calls))
    client = _client()

    response = client.post(
        "/validate-static",
        files={"archive": ("gtfs.zip", minimal_static_archive_bytes(), "application/zip")},
    )

    assert response.status_code == 200
    assert "write_capped" in calls
    assert "check_uncompressed_size" in calls
    assert "_validate_and_serialize" in calls


@respx.mock
def test_validate_static_url_blocking_stages_go_through_run_in_threadpool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    respx.get(GTFS_URL).mock(return_value=httpx.Response(200, content=minimal_static_archive_bytes()))
    calls: list[str] = []
    monkeypatch.setattr(routes, "run_in_threadpool", _recording_run_in_threadpool(calls))
    client = _client()

    response = client.post("/validate-static", data={"gtfs": GTFS_URL})

    assert response.status_code == 200
    assert "download" in calls
    assert "check_uncompressed_size" in calls
    assert "_validate_and_serialize" in calls

"""HTTP contract tests, with the package boundary faked per the brief: no real
`prepare_feed` or `validate` call happens here. `test_validation_wiring.py`
covers the real package; this covers status codes, request parsing and how
`routes.py` reacts to each failure the cache and `run_validation` can raise.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from validator_service import routes
from validator_service.cache import PrepareInProgress
from validator_service.dependencies import get_cache
from validator_service.fetch import StaticFetchError
from validator_service.main import create_app
from validator_service.settings import Settings
from validator_service.validation import FeedDecodeError

GTFS_URL = "https://example.org/gtfs.zip"


class _FakeCache:
    """Stands in for `PreparedFeedCache`: returns a sentinel, or raises what
    the test tells it to, without touching the network or the package."""

    def __init__(self, *, raises: Exception | None = None) -> None:
        self.raises = raises
        self.calls: list[str] = []

    def get_prepared(self, key: str) -> str:
        self.calls.append(key)
        if self.raises is not None:
            raise self.raises
        return "prepared-feed"


def _client(cache: _FakeCache, *, max_compressed_bytes: int = 200_000_000) -> TestClient:
    app = create_app(
        Settings(cache_size=1, cache_ttl_seconds=60.0, static_archive_max_compressed_bytes=max_compressed_bytes)
    )
    app.dependency_overrides[get_cache] = lambda: cache
    return TestClient(app)


def test_health_returns_200() -> None:
    client = _client(_FakeCache())
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_successful_validation_returns_the_enriched_report(monkeypatch: pytest.MonkeyPatch) -> None:
    canned_report = {"summary": {"mode": "modern"}, "notices": [{"code": "E003", "title": "..."}]}
    captured: dict[str, Any] = {}

    def fake_run_validation(prepared: object, feed_bytes: bytes, previous_bytes: bytes | None) -> dict[str, Any]:
        captured["prepared"] = prepared
        captured["feed_bytes"] = feed_bytes
        captured["previous_bytes"] = previous_bytes
        return canned_report

    monkeypatch.setattr(routes, "run_validation", fake_run_validation)
    cache = _FakeCache()
    client = _client(cache)

    response = client.post(
        "/validate",
        data={"gtfs": GTFS_URL},
        files={"feed": ("feed.pb", b"current-bytes", "application/octet-stream")},
    )

    assert response.status_code == 200
    assert response.json() == canned_report
    assert cache.calls == [GTFS_URL]
    assert captured["prepared"] == "prepared-feed"
    assert captured["feed_bytes"] == b"current-bytes"
    assert captured["previous_bytes"] is None


def test_previous_bytes_are_forwarded_when_present(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_run_validation(prepared: object, feed_bytes: bytes, previous_bytes: bytes | None) -> dict[str, Any]:
        captured["previous_bytes"] = previous_bytes
        return {"summary": {}, "notices": []}

    monkeypatch.setattr(routes, "run_validation", fake_run_validation)
    client = _client(_FakeCache())

    response = client.post(
        "/validate",
        data={"gtfs": GTFS_URL},
        files={
            "feed": ("feed.pb", b"current-bytes", "application/octet-stream"),
            "previous": ("previous.pb", b"previous-bytes", "application/octet-stream"),
        },
    )

    assert response.status_code == 200
    assert captured["previous_bytes"] == b"previous-bytes"


def test_empty_previous_upload_is_treated_as_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_run_validation(prepared: object, feed_bytes: bytes, previous_bytes: bytes | None) -> dict[str, Any]:
        captured["previous_bytes"] = previous_bytes
        return {"summary": {}, "notices": []}

    monkeypatch.setattr(routes, "run_validation", fake_run_validation)
    client = _client(_FakeCache())

    response = client.post(
        "/validate",
        data={"gtfs": GTFS_URL},
        files={
            "feed": ("feed.pb", b"current-bytes", "application/octet-stream"),
            "previous": ("previous.pb", b"", "application/octet-stream"),
        },
    )

    assert response.status_code == 200
    assert captured["previous_bytes"] is None


def test_blank_gtfs_field_returns_400() -> None:
    client = _client(_FakeCache())

    response = client.post(
        "/validate",
        data={"gtfs": "   "},
        files={"feed": ("feed.pb", b"current-bytes", "application/octet-stream")},
    )

    assert response.status_code == 400
    assert "gtfs" in response.json()["error"]


def test_empty_feed_upload_returns_400() -> None:
    client = _client(_FakeCache())

    response = client.post(
        "/validate",
        data={"gtfs": GTFS_URL},
        files={"feed": ("feed.pb", b"", "application/octet-stream")},
    )

    assert response.status_code == 400
    assert "feed" in response.json()["error"]


def test_prepare_in_progress_returns_503() -> None:
    cache = _FakeCache(raises=PrepareInProgress(GTFS_URL))
    client = _client(cache)

    response = client.post(
        "/validate",
        data={"gtfs": GTFS_URL},
        files={"feed": ("feed.pb", b"current-bytes", "application/octet-stream")},
    )

    assert response.status_code == 503


def test_static_fetch_error_returns_502() -> None:
    cache = _FakeCache(raises=StaticFetchError("could not fetch archive"))
    client = _client(cache)

    response = client.post(
        "/validate",
        data={"gtfs": GTFS_URL},
        files={"feed": ("feed.pb", b"current-bytes", "application/octet-stream")},
    )

    assert response.status_code == 502
    assert response.json()["error"] == "could not fetch archive"


def test_oversized_request_body_returns_413() -> None:
    """`MaxBodySizeMiddleware` is app-wide: `/validate`'s own realtime upload
    has the same unbounded-read exposure `/validate-static` did, since it
    reads `feed` fully with `feed.read()` and has no per-route cap of its
    own."""
    client = _client(_FakeCache(), max_compressed_bytes=10)

    response = client.post(
        "/validate",
        data={"gtfs": GTFS_URL},
        files={"feed": ("feed.pb", b"x" * 100_000, "application/octet-stream")},
    )

    assert response.status_code == 413


def test_feed_decode_error_returns_400(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_validation(prepared: object, feed_bytes: bytes, previous_bytes: bytes | None) -> dict[str, Any]:
        raise FeedDecodeError("feed could not be decoded as a GTFS-Realtime FeedMessage")

    monkeypatch.setattr(routes, "run_validation", fake_run_validation)
    client = _client(_FakeCache())

    response = client.post(
        "/validate",
        data={"gtfs": GTFS_URL},
        files={"feed": ("feed.pb", b"not-a-real-message", "application/octet-stream")},
    )

    assert response.status_code == 400

"""Unit tests for `fetch_and_prepare` and `download`. Network is mocked with
respx; nothing here makes a real HTTP call, and `prepare_feed` is faked so no
real archive is parsed.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from gtfs_rt_validator.api import Mode, StaticLoadError

from validator_service import fetch
from validator_service.fetch import StaticFetchError, download, fetch_and_prepare

URL = "https://example.org/gtfs.zip"
MAX_BYTES = 10_000_000


@respx.mock
def test_fetch_and_prepare_downloads_then_calls_prepare_feed(monkeypatch: pytest.MonkeyPatch) -> None:
    """The downloaded bytes must reach `prepare_feed` as a real file, in MODERN
    mode, and the temporary file must be gone once this returns."""
    respx.get(URL).mock(return_value=httpx.Response(200, content=b"pretend-zip-bytes"))

    captured: dict[str, Any] = {}

    def fake_prepare_feed(path: Path, *, mode: Mode, ignore_shapes: bool = False) -> str:
        captured["path"] = path
        captured["mode"] = mode
        captured["bytes"] = path.read_bytes()
        return "prepared-feed"

    monkeypatch.setattr(fetch, "prepare_feed", fake_prepare_feed)

    result = fetch_and_prepare(URL, timeout=5.0, max_bytes=MAX_BYTES)

    assert result == "prepared-feed"
    assert captured["mode"] is Mode.MODERN
    assert captured["bytes"] == b"pretend-zip-bytes"
    assert not captured["path"].exists(), "the temporary archive must be cleaned up"


@respx.mock
def test_fetch_failure_raises_static_fetch_error() -> None:
    """A transport failure must surface as `StaticFetchError`, which the router
    maps to 502."""
    respx.get(URL).mock(side_effect=httpx.ConnectError("connection refused"))

    with pytest.raises(StaticFetchError):
        fetch_and_prepare(URL, timeout=5.0, max_bytes=MAX_BYTES)


@respx.mock
def test_http_error_status_raises_static_fetch_error() -> None:
    """A non-2xx response is a fetch failure too, not a successful download of
    an error page."""
    respx.get(URL).mock(return_value=httpx.Response(404))

    with pytest.raises(StaticFetchError):
        fetch_and_prepare(URL, timeout=5.0, max_bytes=MAX_BYTES)


@respx.mock
def test_unloadable_archive_raises_static_fetch_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """A download that succeeds but does not parse as GTFS is also a
    `StaticFetchError`: the router does not distinguish `502`-for-fetch from
    `502`-for-load, per the README's documented interpretation of the brief."""
    respx.get(URL).mock(return_value=httpx.Response(200, content=b"not-a-real-zip"))

    def fake_prepare_feed(path: Path, *, mode: Mode, ignore_shapes: bool = False) -> str:
        raise StaticLoadError("not a zip")

    monkeypatch.setattr(fetch, "prepare_feed", fake_prepare_feed)

    with pytest.raises(StaticFetchError):
        fetch_and_prepare(URL, timeout=5.0, max_bytes=MAX_BYTES)


def test_malformed_url_raises_static_fetch_error(tmp_path: Path) -> None:
    """`httpx.InvalidURL` (raised while parsing a URL like `http://[::1`) is
    not part of the `httpx.HTTPError` hierarchy, so it must be caught
    explicitly or it escapes as an unhandled 500 at the router."""
    with pytest.raises(StaticFetchError):
        download("http://[::1", tmp_path / "gtfs.zip", timeout=5.0, max_bytes=MAX_BYTES)


@respx.mock
def test_download_stops_once_max_bytes_is_exceeded(tmp_path: Path) -> None:
    """A response larger than `max_bytes` must raise `StaticFetchError`,
    checked with a running counter rather than trusted from Content-Length
    (which respx does not even set here)."""
    respx.get(URL).mock(return_value=httpx.Response(200, content=b"x" * 100))

    with pytest.raises(StaticFetchError):
        download(URL, tmp_path / "gtfs.zip", timeout=5.0, max_bytes=10)


@respx.mock
def test_download_within_max_bytes_succeeds(tmp_path: Path) -> None:
    respx.get(URL).mock(return_value=httpx.Response(200, content=b"pretend-zip-bytes"))
    destination = tmp_path / "gtfs.zip"

    download(URL, destination, timeout=5.0, max_bytes=MAX_BYTES)

    assert destination.read_bytes() == b"pretend-zip-bytes"

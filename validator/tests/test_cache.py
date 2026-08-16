"""Unit tests for `PreparedFeedCache`.

`prepare` is a plain counting stub throughout: the cache does not know or care
what it is caching, so nothing here downloads an archive or calls into
gtfs_rt_validator. Each test's docstring says what breaks it, and the report
records the revert-and-watch-it-fail evidence for every one of these.
"""

from __future__ import annotations

import threading

import pytest

from validator_service.cache import PreparedFeedCache, PrepareInProgress


class _CountingPrepare:
    """Records every key it was asked to build and returns an incrementing id."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self._next_id = 0

    def __call__(self, key: str) -> str:
        self._next_id += 1
        self.calls.append(key)
        return f"{key}#{self._next_id}"


class _MutableClock:
    """A `time.monotonic`-shaped callable the test can advance by hand."""

    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now


def test_second_request_is_served_from_cache_without_re_preparing() -> None:
    """Two calls for the same fresh key must invoke `prepare` once, not twice."""
    prepare = _CountingPrepare()
    cache = PreparedFeedCache(prepare, max_size=1, ttl_seconds=60.0)

    first = cache.get_prepared("https://example.org/gtfs.zip")
    second = cache.get_prepared("https://example.org/gtfs.zip")

    assert first == second
    assert prepare.calls == ["https://example.org/gtfs.zip"]


def test_expired_entry_forces_a_rebuild() -> None:
    """A request after the TTL elapses must invoke `prepare` again."""
    prepare = _CountingPrepare()
    clock = _MutableClock(start=0.0)
    cache = PreparedFeedCache(prepare, max_size=1, ttl_seconds=60.0, clock=clock)

    first = cache.get_prepared("https://example.org/gtfs.zip")
    clock.now = 61.0  # one second past the TTL
    second = cache.get_prepared("https://example.org/gtfs.zip")

    assert prepare.calls == ["https://example.org/gtfs.zip", "https://example.org/gtfs.zip"]
    assert first != second  # the counting stub proves it was rebuilt, not replayed


def test_entry_within_ttl_is_not_rebuilt() -> None:
    """The mirror of the TTL test: a request before the TTL must NOT rebuild."""
    prepare = _CountingPrepare()
    clock = _MutableClock(start=0.0)
    cache = PreparedFeedCache(prepare, max_size=1, ttl_seconds=60.0, clock=clock)

    cache.get_prepared("https://example.org/gtfs.zip")
    clock.now = 59.0  # one second short of the TTL
    cache.get_prepared("https://example.org/gtfs.zip")

    assert prepare.calls == ["https://example.org/gtfs.zip"]


def test_concurrent_requests_for_one_url_cause_one_prepare() -> None:
    """A second caller for a key already being prepared must not start a second
    prepare; it must be refused with `PrepareInProgress` while the first is in
    flight."""
    started = threading.Event()
    release = threading.Event()
    calls: list[str] = []

    def blocking_prepare(key: str) -> str:
        calls.append(key)
        started.set()
        release.wait(timeout=5)
        return f"{key}#prepared"

    cache = PreparedFeedCache(blocking_prepare, max_size=1, ttl_seconds=60.0)

    result: dict[str, object] = {}

    def run_first() -> None:
        result["value"] = cache.get_prepared("https://example.org/gtfs.zip")

    first_thread = threading.Thread(target=run_first)
    first_thread.start()
    assert started.wait(timeout=5), "the first prepare never started"

    with pytest.raises(PrepareInProgress):
        cache.get_prepared("https://example.org/gtfs.zip")

    release.set()
    first_thread.join(timeout=5)

    assert calls == ["https://example.org/gtfs.zip"]
    assert result["value"] == "https://example.org/gtfs.zip#prepared"


def test_a_different_key_prepares_independently_while_one_is_in_flight() -> None:
    """`PrepareInProgress` is per key: a second URL must not be blocked by the
    first one's in-flight prepare."""
    started = threading.Event()
    release = threading.Event()

    def blocking_prepare(key: str) -> str:
        if key == "https://a.example.org/gtfs.zip":
            started.set()
            release.wait(timeout=5)
        return f"{key}#prepared"

    cache = PreparedFeedCache(blocking_prepare, max_size=2, ttl_seconds=60.0)

    first_thread = threading.Thread(target=cache.get_prepared, args=("https://a.example.org/gtfs.zip",))
    first_thread.start()
    assert started.wait(timeout=5)

    second = cache.get_prepared("https://b.example.org/gtfs.zip")

    release.set()
    first_thread.join(timeout=5)

    assert second == "https://b.example.org/gtfs.zip#prepared"


def test_failed_prepare_does_not_leave_the_key_stuck_preparing() -> None:
    """A prepare that raises must still release the key, or every later call
    would wrongly see `PrepareInProgress` forever."""
    attempts = {"count": 0}

    def flaky_prepare(key: str) -> str:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise RuntimeError("static archive fetch failed")
        return f"{key}#ok"

    cache = PreparedFeedCache(flaky_prepare, max_size=1, ttl_seconds=60.0)

    with pytest.raises(RuntimeError):
        cache.get_prepared("https://example.org/gtfs.zip")

    # The failed attempt must not have left the key marked as preparing.
    assert cache.get_prepared("https://example.org/gtfs.zip") == "https://example.org/gtfs.zip#ok"


def test_cache_at_capacity_evicts_the_oldest_entry_for_a_new_key() -> None:
    """`max_size` bounds the cache: a size-1 cache must hold only the most
    recently prepared URL, dropping the previous one rather than growing."""
    prepare = _CountingPrepare()
    cache = PreparedFeedCache(prepare, max_size=1, ttl_seconds=60.0)

    cache.get_prepared("https://a.example.org/gtfs.zip")
    cache.get_prepared("https://b.example.org/gtfs.zip")

    # The first URL was evicted, so asking for it again must re-prepare it.
    cache.get_prepared("https://a.example.org/gtfs.zip")

    assert prepare.calls == [
        "https://a.example.org/gtfs.zip",
        "https://b.example.org/gtfs.zip",
        "https://a.example.org/gtfs.zip",
    ]

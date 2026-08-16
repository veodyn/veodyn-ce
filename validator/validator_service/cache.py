"""A bounded, TTL'd, single-flight cache over one blocking `prepare` call.

`gtfs_rt_validator.api.prepare_feed` reads a whole static archive: about 48
seconds and roughly 1.9 GB resident for an MBTA-sized feed (the 2026-08-13
spike behind
docs/superpowers/specs/2026-08-13-validated-feed-publishing-design.md section
6.6). A validation request is not the place to pay that on every call, so this
cache holds prepared feeds keyed by the URL they were built from, refreshed on
a TTL, so repeat validations against the same static reference cost only the
sub-second rule pass.

**No headroom for two copies.** A stale entry is dropped the moment it is
found stale, before its replacement starts building. The alternative, keeping
the old entry alive until the new one finishes, would let the default
size-1 cache (a node serves one agency and carries one `static_gtfs_ref`, so 1
is the normal case) spike to two archives resident at once: roughly 3.8 GB
against the 1.9 GB the default promises, which is exactly the surprise
`.env.example` says the default must not be. Dropping first keeps the memory
budget honest at the cost of a gap: the request that finds the entry gone pays
the full rebuild.

**Concurrent requests for the same key do not queue.** They fail with
`PrepareInProgress`, which the router turns into a 503. The alternative, a
second caller awaiting the first's in-flight prepare, was rejected because
holding an HTTP request open for a ~48 second rebuild risks the wrong timeout
firing somewhere upstream of this service; 503 is a state a caller can already
retry on cheaply. This is also exactly the choice
`docs/superpowers/specs/2026-08-13-validated-feed-publishing-design.md`
lists as a valid non-200 outcome ("503 while a prepare is in flight").
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Generic, TypeVar

FeedT = TypeVar("FeedT")


class PrepareInProgress(Exception):
    """A prepare for this key is already running; the caller should back off."""

    def __init__(self, key: str) -> None:
        self.key = key
        super().__init__(f"a prepare for {key!r} is already in flight")


@dataclass(frozen=True, slots=True)
class _Entry(Generic[FeedT]):
    value: FeedT
    expires_at: float


class PreparedFeedCache(Generic[FeedT]):
    """Cache one blocking, expensive `prepare(key) -> FeedT` call's results.

    `prepare` is injected rather than imported here, so a test can fake the
    package boundary with a counting stub instead of downloading and parsing a
    real archive. See the module docstring for the eviction and concurrency
    choices this makes.
    """

    def __init__(
        self,
        prepare: Callable[[str], FeedT],
        *,
        max_size: int,
        ttl_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if max_size < 1:
            raise ValueError(f"max_size must be at least 1, got {max_size}")
        self._prepare = prepare
        self._max_size = max_size
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._entries: OrderedDict[str, _Entry[FeedT]] = OrderedDict()
        self._preparing: set[str] = set()

    def get_prepared(self, key: str) -> FeedT:
        """The cached value for `key`, preparing it if none is fresh.

        Raises `PrepareInProgress` rather than blocking when another call is
        already building this key's value.
        """
        cached = self._fresh(key)
        if cached is not None:
            return cached
        self._start(key)
        try:
            value = self._prepare(key)
        except BaseException:
            self._finish(key)
            raise
        self._store(key, value)
        self._finish(key)
        return value

    def _fresh(self, key: str) -> FeedT | None:
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if entry.expires_at <= self._clock():
                # Stale: drop it now rather than holding it while a rebuild
                # runs. See the module docstring's "no headroom for two".
                del self._entries[key]
                return None
            self._entries.move_to_end(key)
            return entry.value

    def _start(self, key: str) -> None:
        with self._lock:
            if key in self._preparing:
                raise PrepareInProgress(key)
            self._preparing.add(key)

    def _finish(self, key: str) -> None:
        with self._lock:
            self._preparing.discard(key)

    def _store(self, key: str, value: FeedT) -> None:
        with self._lock:
            if key not in self._entries and len(self._entries) >= self._max_size:
                self._entries.popitem(last=False)
            self._entries[key] = _Entry(value, self._clock() + self._ttl_seconds)
            self._entries.move_to_end(key)

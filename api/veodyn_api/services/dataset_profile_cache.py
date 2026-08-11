"""One profile per table per TTL, shared by every caller.

Split from dataset_profile.py on the same reasoning that split
ai_converse_grounding.py from ai_grounding.py: that module is the stateless
read, and this is the only part with process state and a lock in it. The read
can be tested by handing it a fake warehouse; this can only be tested by asking
twice.
"""

import threading
import time
from typing import Any

from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.dataset_profile import DatasetProfile, profile_dataset

# Same TTL as the grounding it travels with, for the same reason: one
# conversation reuses a single build, and a table profiled while someone is
# chatting is fresh in the next conversation.
PROFILE_TTL_SECONDS = 300

# A bound, not a policy. Without it a long-lived pod accumulates one profile per
# table it has ever been asked about and never gives one back.
MAX_CACHED_PROFILES = 32

_cache: dict[str, tuple[float, DatasetProfile]] = {}

# A dashboard turn writes up to four queries in a thread pool
# (ai_converse_outline.written_in_parallel), so four threads reach this cache at
# once. Without the lock, the eviction below iterates the dict with min() while
# another thread inserts into it, which raises "dictionary changed size during
# iteration". That is not hypothetical once 32 tables are cached.
_cache_lock = threading.Lock()


def clear_profile_cache() -> None:
    """Test seam, like clear_grounding_cache."""
    with _cache_lock:
        _cache.clear()


def cached_profile(client: Any, dataset: DatasetOut) -> DatasetProfile | None:
    """The table's profile, built at most once per TTL.

    The warehouse read happens OUTSIDE the lock on purpose. Holding it across
    two ClickHouse round trips would serialize the very widgets the thread pool
    exists to overlap. The cost is that two threads asking about the same table
    at the same moment both profile it, which is a duplicated read rather than a
    wrong answer, and cheaper than the serialization it replaces.
    """
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(dataset.id)
    if hit is not None and now - hit[0] < PROFILE_TTL_SECONDS:
        return hit[1]

    profile = profile_dataset(client, dataset)
    if profile is None:
        return None

    with _cache_lock:
        # Evict only to make room for a key that is not already here. Two threads
        # that both missed the same table would otherwise evict twice for one
        # insertion: the first stores it, the second sees a full cache, throws
        # out an unrelated entry, and overwrites the row the first just wrote.
        # The duplicated warehouse read is the price of not holding the lock; a
        # second table falling out of the cache is not.
        if dataset.id not in _cache and len(_cache) >= MAX_CACHED_PROFILES:
            _cache.pop(min(_cache, key=lambda key: _cache[key][0]), None)
        _cache[dataset.id] = (now, profile)
    return profile

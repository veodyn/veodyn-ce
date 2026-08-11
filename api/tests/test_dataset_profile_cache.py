"""The profile cache: its TTL, its cap, and who gets evicted.

Split from test_dataset_profile.py alongside the module split. That file tests
one warehouse read; this one can only be tested by asking twice, and it is the
half with process state and a lock in it.

The fixtures come from its neighbour rather than being rebuilt: a second
FakeClickHouse would be a second thing to keep in step with the statements.
"""

from tests.test_dataset_profile import TABLE_FACTS, FakeClickHouse, dataset
from veodyn_api.services.dataset_profile_cache import cached_profile, clear_profile_cache


def test_the_cache_answers_the_second_ask_without_a_statement():
    clear_profile_cache()
    client = FakeClickHouse([TABLE_FACTS, [{"n": 1}]])
    one = dataset([("bikes", "Nullable(Int64)")])

    first = cached_profile(client, one)
    second = cached_profile(client, one)

    assert first is second
    assert len(client.statements) == 2


def test_the_cache_evicts_the_oldest_entry_rather_than_growing(monkeypatch):
    """The cap is what stops a long-lived pod holding one profile per table it
    was ever asked about. Untested until the eviction gained a concurrent caller
    and a pop that has to tolerate losing the race for the same victim.

    Asserted through the warehouse rather than by reading the cache dict: what
    matters is that the evicted table is read again and the kept one is not.
    """
    clear_profile_cache()
    monkeypatch.setattr("veodyn_api.services.dataset_profile_cache.MAX_CACHED_PROFILES", 2)
    one = dataset([("bikes", "Nullable(Int64)")])

    def profile(table: str) -> FakeClickHouse:
        client = FakeClickHouse([TABLE_FACTS, [{"n": 1}]])
        cached_profile(client, one.model_copy(update={"id": table}))
        return client

    profile("first")
    profile("second")
    profile("third")

    # "first" was the oldest when "third" arrived, so it is gone and reading it
    # costs two statements again. "third" is still held and costs none.
    assert len(profile("first").statements) == 2
    assert len(profile("third").statements) == 0


def test_refreshing_a_cached_table_evicts_nobody(monkeypatch):
    """Eviction makes room for a NEW key. Refreshing one already held would
    otherwise throw out an unrelated entry to store something that needs no room,
    which is how two concurrent misses on the same table cost two other tables
    their place.
    """
    clear_profile_cache()
    monkeypatch.setattr("veodyn_api.services.dataset_profile_cache.MAX_CACHED_PROFILES", 2)
    # Every lookup misses, so a second ask for a cached table reaches the insert.
    monkeypatch.setattr("veodyn_api.services.dataset_profile_cache.PROFILE_TTL_SECONDS", 0)
    one = dataset([("bikes", "Nullable(Int64)")])

    def profile(table: str) -> FakeClickHouse:
        client = FakeClickHouse([TABLE_FACTS, [{"n": 1}]])
        cached_profile(client, one.model_copy(update={"id": table}))
        return client

    profile("first")
    profile("second")
    # The NEWEST key, deliberately. Refreshing the oldest would evict itself and
    # cost nobody anything, so a test that refreshed "first" would pass whether
    # or not the guard is there.
    profile("second")

    # "first" is still held: refreshing "second" needed no room. Read back with
    # the TTL restored, so a hit is observable as a statement that never runs.
    monkeypatch.setattr("veodyn_api.services.dataset_profile_cache.PROFILE_TTL_SECONDS", 300)
    assert len(profile("first").statements) == 0

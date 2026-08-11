from contextlib import contextmanager

from redash import redis_connection

SHAPE_KEY_PREFIX = "historical:shape:"
LOCK_KEY_PREFIX = "historical:lock:"

# Cached shape is just an optimization (system.columns is the source of truth on a
# cache miss/expiry), so an expiry just costs one extra diff, never correctness.
SHAPE_TTL_SECONDS = 7 * 24 * 60 * 60


def _shape_key(query_id):
    return f"{SHAPE_KEY_PREFIX}{query_id}"


def get_cached_shape(query_id):
    """Returns a frozenset of column names, or None on a cache miss."""
    raw = redis_connection.get(_shape_key(query_id))
    if raw is None:
        return None
    text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
    return frozenset(text.split(",")) if text else frozenset()


def set_cached_shape(query_id, column_names):
    redis_connection.set(_shape_key(query_id), ",".join(sorted(column_names)), ex=SHAPE_TTL_SECONDS)


@contextmanager
def table_lock(table_name, timeout=30, blocking_timeout=10):
    lock = redis_connection.lock(f"{LOCK_KEY_PREFIX}{table_name}", timeout=timeout, blocking_timeout=blocking_timeout)
    acquired = lock.acquire(blocking=True)
    if not acquired:
        raise TimeoutError(f"Could not acquire historical capture lock for {table_name}")
    try:
        yield
    finally:
        lock.release()

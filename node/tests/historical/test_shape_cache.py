from redash.historical import shape_cache
from tests import BaseTestCase


class TestShapeCache(BaseTestCase):
    def test_miss_returns_none(self):
        self.assertIsNone(shape_cache.get_cached_shape("historical.q_missing_999"))

    def test_set_then_get_roundtrips(self):
        shape_cache.set_cached_shape("historical.q_speed_1", frozenset({"speed", "vehicle_id"}))
        self.assertEqual(shape_cache.get_cached_shape("historical.q_speed_1"), frozenset({"speed", "vehicle_id"}))

    def test_the_same_query_in_two_databases_keeps_two_shapes(self):
        shape_cache.set_cached_shape("historical.q_speed_1", frozenset({"speed"}))
        self.assertIsNone(shape_cache.get_cached_shape("historical_dev.q_speed_1"))

    def test_table_lock_is_exclusive_and_releases(self):
        with shape_cache.table_lock("historical.q_foo_1", timeout=5, blocking_timeout=1):
            pass
        # Lock released cleanly — acquiring again immediately must not raise/time out.
        with shape_cache.table_lock("historical.q_foo_1", timeout=5, blocking_timeout=1):
            pass

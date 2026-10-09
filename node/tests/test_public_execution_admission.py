import threading
import time
import uuid

from redash import redis_connection
from redash.public_execution import admit
from tests import BaseTestCase

LEASE = "public-exec:1:abc"
WINDOW = "public-exec-window:7"


def run_threads(calls):
    results = [None] * len(calls)
    barrier = threading.Barrier(len(calls))

    def worker(i, call):
        barrier.wait()
        results[i] = call()

    threads = [threading.Thread(target=worker, args=(i, c)) for i, c in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def attempt(lease, window=WINDOW, cap=100, seconds=30):
    return lambda: admit(redis_connection, lease, window, time.time(), seconds, cap, uuid.uuid4().hex)


class TestAdmission(BaseTestCase):
    def setUp(self):
        super().setUp()
        redis_connection.delete(LEASE, WINDOW)

    def test_one_admission_per_key_per_lease_under_concurrency(self):
        results = run_threads([attempt(LEASE) for _ in range(24)])
        self.assertEqual(results.count("admitted"), 1)
        self.assertEqual(results.count("held"), 23)

    def test_the_window_cap_holds_under_concurrency_for_different_keys(self):
        results = run_threads([attempt("public-exec:1:k{}".format(i), cap=5) for i in range(30)])
        self.assertEqual(results.count("admitted"), 5)
        self.assertEqual(results.count("capacity"), 25)
        self.assertEqual(redis_connection.zcard(WINDOW), 5)

    def test_a_held_key_is_refused_inside_the_lease(self):
        self.assertEqual(attempt(LEASE)(), "admitted")
        self.assertEqual(attempt(LEASE)(), "held")

    def test_readmission_after_the_lease_expires(self):
        self.assertEqual(attempt(LEASE, seconds=1)(), "admitted")
        time.sleep(1.2)
        self.assertEqual(attempt(LEASE, seconds=1)(), "admitted")

    def test_expired_windows_free_capacity(self):
        self.assertEqual(attempt(LEASE, cap=1, seconds=1)(), "admitted")
        self.assertEqual(attempt("public-exec:1:other", cap=1, seconds=1)(), "capacity")
        time.sleep(1.2)
        self.assertEqual(attempt("public-exec:1:other", cap=1, seconds=1)(), "admitted")

    def test_the_lease_expires_in_redis(self):
        attempt(LEASE, seconds=30)()
        self.assertGreater(redis_connection.ttl(LEASE), 0)
        self.assertLessEqual(redis_connection.ttl(LEASE), 30)

    def test_a_held_key_at_full_capacity_answers_capacity(self):
        self.assertEqual(attempt(LEASE, cap=1)(), "admitted")
        self.assertEqual(attempt(LEASE, cap=1)(), "capacity")

    def test_the_window_prunes_only_expired_entries(self):
        self.assertEqual(attempt("public-exec:1:short", cap=2, seconds=1)(), "admitted")
        self.assertEqual(attempt("public-exec:1:long", cap=2, seconds=30)(), "admitted")
        self.assertEqual(attempt("public-exec:1:third", cap=2, seconds=30)(), "capacity")
        time.sleep(1.2)
        self.assertEqual(attempt("public-exec:1:third", cap=2, seconds=30)(), "admitted")
        members = {m.decode() if isinstance(m, bytes) else m for m in redis_connection.zrange(WINDOW, 0, -1)}
        self.assertEqual(members, {"public-exec:1:long", "public-exec:1:third"})

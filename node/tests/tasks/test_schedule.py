from unittest import TestCase

from mock import patch

from redash import rq_redis_connection
from redash.tasks.schedule import (
    REREGISTER_SECONDS,
    rq_scheduler,
    schedule_periodic_jobs,
)


class TestSchedule(TestCase):
    def setUp(self):
        for job in rq_scheduler.get_jobs():
            rq_scheduler.cancel(job)
            job.delete()

    def test_schedules_a_new_job(self):
        def foo():
            pass

        schedule_periodic_jobs([{"func": foo, "interval": 60}])

        jobs = [job for job in rq_scheduler.get_jobs()]

        self.assertEqual(len(jobs), 1)
        self.assertTrue(jobs[0].func_name.endswith("foo"))
        self.assertEqual(jobs[0].meta["interval"], 60)

    def test_doesnt_reschedule_an_existing_job(self):
        def foo():
            pass

        schedule_periodic_jobs([{"func": foo, "interval": 60}])
        with patch("redash.tasks.rq_scheduler.schedule") as schedule:
            schedule_periodic_jobs([{"func": foo, "interval": 60}])
            schedule.assert_not_called()

    def test_reschedules_a_modified_job(self):
        def foo():
            pass

        schedule_periodic_jobs([{"func": foo, "interval": 60}])
        schedule_periodic_jobs([{"func": foo, "interval": 120}])

        jobs = [job for job in rq_scheduler.get_jobs()]

        self.assertEqual(len(jobs), 1)
        self.assertTrue(jobs[0].func_name.endswith("foo"))
        self.assertEqual(jobs[0].meta["interval"], 120)

    def test_removes_jobs_that_are_no_longer_defined(self):
        def foo():
            pass

        def bar():
            pass

        schedule_periodic_jobs([{"func": foo, "interval": 60}, {"func": bar, "interval": 90}])
        schedule_periodic_jobs([{"func": foo, "interval": 60}])

        jobs = [job for job in rq_scheduler.get_jobs()]

        self.assertEqual(len(jobs), 1)
        self.assertTrue(jobs[0].func_name.endswith("foo"))
        self.assertEqual(jobs[0].meta["interval"], 60)


class TestSchedulerMetrics(TestCase):
    def setUp(self):
        for job in rq_scheduler.get_jobs():
            rq_scheduler.cancel(job)
            job.delete()

    def test_scheduler_enqueue_job_metric(self):
        def foo():
            pass

        schedule_periodic_jobs([{"func": foo, "interval": 60}])

        with patch("statsd.StatsClient.incr") as incr:
            rq_scheduler.enqueue_jobs()
            incr.assert_called_once_with("rq.jobs.created.periodic")


class TestSchedulerKeepsPeriodicJobsRegistered(TestCase):
    def setUp(self):
        for job in rq_scheduler.get_jobs():
            rq_scheduler.cancel(job)
            job.delete()

    def tearDown(self):
        rq_scheduler.keep_scheduled([])

    def test_reregisters_a_job_whose_hash_expired(self):
        def foo():
            pass

        jobs = [{"func": foo, "interval": 300}]
        schedule_periodic_jobs(jobs)
        rq_scheduler.keep_scheduled(jobs)
        rq_redis_connection.delete(list(rq_scheduler.get_jobs())[0].key)

        rq_scheduler.enqueue_jobs()

        registered = list(rq_scheduler.get_jobs())
        self.assertEqual(len(registered), 1)
        self.assertTrue(registered[0].func_name.endswith("foo"))

    def test_rechecks_registration_at_most_once_per_interval(self):
        def foo():
            pass

        rq_scheduler.keep_scheduled([{"func": foo, "interval": 300}])
        with patch("redash.tasks.schedule.schedule_periodic_jobs") as reregister:
            rq_scheduler.enqueue_jobs()
            rq_scheduler.enqueue_jobs()
            self.assertEqual(reregister.call_count, 1)

    def test_rechecks_again_once_the_interval_has_passed(self):
        def foo():
            pass

        rq_scheduler.keep_scheduled([{"func": foo, "interval": 300}])
        with patch("redash.tasks.schedule.schedule_periodic_jobs") as reregister:
            with patch.object(rq_scheduler, "clock", side_effect=[1000.0, 1000.0 + REREGISTER_SECONDS]):
                rq_scheduler.enqueue_jobs()
                rq_scheduler.enqueue_jobs()
            self.assertEqual(reregister.call_count, 2)

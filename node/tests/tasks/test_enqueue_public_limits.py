from unittest.mock import patch

from rq import Connection

from redash import rq_redis_connection
from redash.tasks.queries.execution import enqueue_query
from tests import BaseTestCase
from tests.tasks.queries_test_helpers import create_job, fetch_job


@patch("redash.tasks.queries.execution.Job.fetch", side_effect=fetch_job)
@patch("redash.tasks.queries.execution.Queue.enqueue", side_effect=create_job)
class TestEnqueueLimits(BaseTestCase):
    def call(self, **extra):
        query = self.factory.create_query()
        with Connection(rq_redis_connection):
            enqueue_query(
                query.query_text,
                query.data_source,
                query.user_id,
                False,
                None,
                {"Username": "Arik", "query_id": query.id},
                **extra,
            )

    def test_defaults_pass_the_same_kwargs_as_before(self, enqueue, _):
        from redash import settings

        self.call()
        kwargs = enqueue.call_args.kwargs
        self.assertNotIn("ttl", kwargs)
        self.assertEqual(
            set(kwargs),
            {"user_id", "scheduled_query_id", "is_api_key", "job_timeout", "failure_ttl", "meta", "result_ttl"},
        )
        self.assertEqual(kwargs["failure_ttl"], settings.JOB_DEFAULT_FAILURE_TTL)
        self.assertEqual(kwargs["result_ttl"], settings.JOB_EXPIRY_TIME)

    def test_the_two_arguments_reach_the_queue(self, enqueue, _):
        self.call(job_timeout=40, queued_ttl=20)
        kwargs = enqueue.call_args.kwargs
        self.assertEqual(kwargs["job_timeout"], 40)
        self.assertEqual(kwargs["ttl"], 20)

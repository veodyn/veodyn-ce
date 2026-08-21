from unittest.mock import patch

from rq import Connection
from rq.exceptions import NoSuchJobError

from redash import rq_redis_connection
from redash.tasks.queries.execution import enqueue_query
from tests import BaseTestCase
from tests.tasks.queries_test_helpers import create_job, fetch_job


@patch("redash.tasks.queries.execution.Job.fetch", side_effect=fetch_job)
@patch("redash.tasks.queries.execution.Queue.enqueue", side_effect=create_job)
class TestEnqueueTask(BaseTestCase):
    def test_multiple_enqueue_of_same_query(self, enqueue, _):
        query = self.factory.create_query()

        with Connection(rq_redis_connection):
            enqueue_query(
                query.query_text,
                query.data_source,
                query.user_id,
                False,
                query,
                {"Username": "Arik", "query_id": query.id},
            )
            enqueue_query(
                query.query_text,
                query.data_source,
                query.user_id,
                False,
                query,
                {"Username": "Arik", "query_id": query.id},
            )
            enqueue_query(
                query.query_text,
                query.data_source,
                query.user_id,
                False,
                query,
                {"Username": "Arik", "query_id": query.id},
            )

        self.assertEqual(1, enqueue.call_count)

    def test_multiple_enqueue_of_expired_job(self, enqueue, fetch_job):
        query = self.factory.create_query()

        with Connection(rq_redis_connection):
            enqueue_query(
                query.query_text,
                query.data_source,
                query.user_id,
                False,
                query,
                {"Username": "Arik", "query_id": query.id},
            )

            # "expire" the previous job
            fetch_job.side_effect = NoSuchJobError

            enqueue_query(
                query.query_text,
                query.data_source,
                query.user_id,
                False,
                query,
                {"Username": "Arik", "query_id": query.id},
            )

        self.assertEqual(2, enqueue.call_count)

    def test_reenqueue_during_job_cancellation(self, enqueue, my_fetch_job):
        query = self.factory.create_query()

        with Connection(rq_redis_connection):
            enqueue_query(
                query.query_text,
                query.data_source,
                query.user_id,
                False,
                query,
                {"Username": "Arik", "query_id": query.id},
            )

            # "cancel" the previous job
            def cancel_job(*args, **kwargs):
                job = fetch_job(*args, **kwargs)
                job.is_cancelled = True
                return job

            my_fetch_job.side_effect = cancel_job

            enqueue_query(
                query.query_text,
                query.data_source,
                query.user_id,
                False,
                query,
                {"Username": "Arik", "query_id": query.id},
            )

        self.assertEqual(2, enqueue.call_count)

    @patch("redash.settings.dynamic_settings.query_time_limit", return_value=60)
    def test_limits_query_time(self, _, enqueue, __):
        query = self.factory.create_query()

        with Connection(rq_redis_connection):
            enqueue_query(
                query.query_text,
                query.data_source,
                query.user_id,
                False,
                query,
                {"Username": "Arik", "query_id": query.id},
            )

        _, kwargs = enqueue.call_args
        self.assertEqual(60, kwargs.get("job_timeout"))

    def test_multiple_enqueue_of_different_query(self, enqueue, _):
        query = self.factory.create_query()

        with Connection(rq_redis_connection):
            enqueue_query(
                query.query_text,
                query.data_source,
                query.user_id,
                False,
                None,
                {"Username": "Arik", "query_id": query.id},
            )
            enqueue_query(
                query.query_text + "2",
                query.data_source,
                query.user_id,
                False,
                None,
                {"Username": "Arik", "query_id": query.id},
            )
            enqueue_query(
                query.query_text + "3",
                query.data_source,
                query.user_id,
                False,
                None,
                {"Username": "Arik", "query_id": query.id},
            )

        self.assertEqual(3, enqueue.call_count)

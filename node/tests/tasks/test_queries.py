from unittest.mock import patch

from redash import models
from redash.query_runner.pg import PostgreSQL
from redash.tasks.queries.execution import (
    QueryExecutionError,
    execute_query,
)
from tests import BaseTestCase
from tests.tasks.queries_test_helpers import fetch_job


@patch("redash.tasks.queries.execution.get_current_job", side_effect=fetch_job)
class QueryExecutorTests(BaseTestCase):
    def test_success(self, _):
        """
        ``execute_query`` invokes the query runner and stores a query result.
        """
        with patch.object(PostgreSQL, "run_query") as qr:
            query_result_data = {"columns": [], "rows": []}
            qr.return_value = (query_result_data, None)
            result_id = execute_query("SELECT 1, 2", self.factory.data_source.id, {})
            self.assertEqual(1, qr.call_count)
            result = models.QueryResult.query.get(result_id)
            self.assertEqual(result.data, query_result_data)

    def test_success_scheduled(self, _):
        """
        Scheduled queries remember their latest results.
        """
        q = self.factory.create_query(query_text="SELECT 1, 2", schedule={"interval": 300})
        with patch.object(PostgreSQL, "run_query") as qr:
            qr.return_value = (
                {
                    "columns": [
                        {"name": "_col0", "friendly_name": "_col0", "type": "integer"},
                        {"name": "_col1", "friendly_name": "_col1", "type": "integer"},
                    ],
                    "rows": [{"_col0": 1, "_col1": 2}],
                },
                None,
            )
            result_id = execute_query(
                "SELECT 1, 2",
                self.factory.data_source.id,
                {"query_id": q.id},
                scheduled_query_id=q.id,
            )
            q = models.Query.get_by_id(q.id)
            self.assertEqual(q.schedule_failures, 0)
            result = models.QueryResult.query.get(result_id)
            self.assertEqual(q.latest_query_data, result)

    def test_failure_scheduled(self, _):
        """
        Scheduled queries that fail have their failure recorded.
        """
        q = self.factory.create_query(query_text="SELECT 1, 2", schedule={"interval": 300})
        with patch.object(PostgreSQL, "run_query") as qr:
            qr.side_effect = ValueError("broken")

            result = execute_query(
                "SELECT 1, 2",
                self.factory.data_source.id,
                {"query_id": q.id},
                scheduled_query_id=q.id,
            )
            self.assertTrue(isinstance(result, QueryExecutionError))
            q = models.Query.get_by_id(q.id)
            self.assertEqual(q.schedule_failures, 1)

            result = execute_query(
                "SELECT 1, 2",
                self.factory.data_source.id,
                {"query_id": q.id},
                scheduled_query_id=q.id,
            )
            self.assertTrue(isinstance(result, QueryExecutionError))
            q = models.Query.get_by_id(q.id)
            self.assertEqual(q.schedule_failures, 2)

    def test_success_after_failure(self, _):
        """
        Query execution success resets the failure counter.
        """
        q = self.factory.create_query(query_text="SELECT 1, 2", schedule={"interval": 300})
        with patch.object(PostgreSQL, "run_query") as qr:
            qr.side_effect = ValueError("broken")
            result = execute_query(
                "SELECT 1, 2",
                self.factory.data_source.id,
                {"query_id": q.id},
                scheduled_query_id=q.id,
            )
            self.assertTrue(isinstance(result, QueryExecutionError))
            q = models.Query.get_by_id(q.id)
            self.assertEqual(q.schedule_failures, 1)

        with patch.object(PostgreSQL, "run_query") as qr:
            qr.return_value = (
                {
                    "columns": [
                        {"name": "_col0", "friendly_name": "_col0", "type": "integer"},
                        {"name": "_col1", "friendly_name": "_col1", "type": "integer"},
                    ],
                    "rows": [{"_col0": 1, "_col1": 2}],
                },
                None,
            )
            execute_query(
                "SELECT 1, 2",
                self.factory.data_source.id,
                {"query_id": q.id},
                scheduled_query_id=q.id,
            )
            q = models.Query.get_by_id(q.id)
            self.assertEqual(q.schedule_failures, 0)

    def test_adhoc_success_after_scheduled_failure(self, _):
        """
        Query execution success resets the failure counter, even if it runs as an adhoc query.
        """
        q = self.factory.create_query(query_text="SELECT 1, 2", schedule={"interval": 300})
        with patch.object(PostgreSQL, "run_query") as qr:
            qr.side_effect = ValueError("broken")
            result = execute_query(
                "SELECT 1, 2",
                self.factory.data_source.id,
                {"query_id": q.id},
                scheduled_query_id=q.id,
                user_id=self.factory.user.id,
            )
            self.assertTrue(isinstance(result, QueryExecutionError))
            q = models.Query.get_by_id(q.id)
            self.assertEqual(q.schedule_failures, 1)

        with patch.object(PostgreSQL, "run_query") as qr:
            qr.return_value = (
                {
                    "columns": [
                        {"name": "_col0", "friendly_name": "_col0", "type": "integer"},
                        {"name": "_col1", "friendly_name": "_col1", "type": "integer"},
                    ],
                    "rows": [{"_col0": 1, "_col1": 2}],
                },
                None,
            )
            execute_query(
                "SELECT 1, 2",
                self.factory.data_source.id,
                {"query_id": q.id},
                user_id=self.factory.user.id,
            )
            q = models.Query.get_by_id(q.id)
            self.assertEqual(q.schedule_failures, 0)

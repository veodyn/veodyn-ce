import json
from unittest.mock import patch

from redash.query_runner.pg import PostgreSQL
from redash.tasks.queries.execution import execute_query
from redash.utils.configuration import ConfigurationContainer
from tests import BaseTestCase
from tests.tasks.queries_test_helpers import fetch_job

_UNSET = object()


@patch("redash.tasks.queries.execution.get_current_job", side_effect=fetch_job)
@patch("redash.tasks.queries.execution.capture_query_result.delay")
class HistoricalCaptureHookTests(BaseTestCase):
    def _query_with_capture_enabled(self, capture_manual_runs=False):
        options = {"dbname": "test", "enable_historical_capture": True}
        if capture_manual_runs:
            options["capture_manual_runs"] = True
        data_source = self.factory.create_data_source(options=ConfigurationContainer.from_json(json.dumps(options)))
        return self.factory.create_query(data_source=data_source, query_text="SELECT 1, 2")

    def _run_success(self, query, capture, scheduled_query_id=None, user_id=None, query_id=_UNSET):
        metadata_query_id = query.id if query_id is _UNSET else query_id
        with patch.object(PostgreSQL, "run_query") as qr:
            qr.return_value = ({"columns": [], "rows": []}, None)
            execute_query(
                query.query_text,
                query.data_source.id,
                {"query_id": metadata_query_id},
                scheduled_query_id=scheduled_query_id,
                user_id=user_id,
            )

    def test_fires_for_scheduled_run_with_flag_enabled(self, capture, _):
        query = self._query_with_capture_enabled()
        self._run_success(query, capture, scheduled_query_id=query.id)
        self.assertTrue(capture.called)
        args = capture.call_args.args
        self.assertEqual(args[1], query.data_source.id)
        self.assertEqual(args[2], query.id)

    def test_does_not_fire_when_flag_is_off(self, capture, _):
        query = self.factory.create_query(query_text="SELECT 1, 2")
        self._run_success(query, capture, scheduled_query_id=query.id)
        self.assertFalse(capture.called)

    def test_does_not_fire_for_manual_run_with_manual_flag_off(self, capture, _):
        query = self._query_with_capture_enabled()
        self._run_success(query, capture, scheduled_query_id=None, user_id=self.factory.user.id)
        self.assertFalse(capture.called)

    def test_fires_for_manual_run_with_both_flags_enabled(self, capture, _):
        query = self._query_with_capture_enabled(capture_manual_runs=True)
        self._run_success(query, capture, scheduled_query_id=None, user_id=self.factory.user.id)
        self.assertTrue(capture.called)
        args = capture.call_args.args
        self.assertEqual(args[1], query.data_source.id)
        self.assertEqual(args[2], query.id)

    def test_does_not_fire_for_manual_run_with_manual_flag_on_but_capture_off(self, capture, _):
        data_source = self.factory.create_data_source(
            options=ConfigurationContainer.from_json('{"dbname": "test", "capture_manual_runs": true}')
        )
        query = self.factory.create_query(data_source=data_source, query_text="SELECT 1, 2")
        self._run_success(query, capture, scheduled_query_id=None, user_id=self.factory.user.id)
        self.assertFalse(capture.called)

    def test_does_not_fire_for_manual_run_with_no_query_id(self, capture, _):
        query = self._query_with_capture_enabled(capture_manual_runs=True)
        self._run_success(query, capture, scheduled_query_id=None, user_id=self.factory.user.id, query_id=None)
        self.assertFalse(capture.called)

    def test_does_not_fire_for_manual_run_with_adhoc_query_id(self, capture, _):
        # An unsaved editor run sends the literal sentinel "adhoc" as its
        # query_id (redash/handlers/query_results.py), not None. It is
        # truthy, so a plain "is query_id set" check would let it through
        # and downstream capture can't resolve "adhoc" to a query row.
        query = self._query_with_capture_enabled(capture_manual_runs=True)
        self._run_success(query, capture, scheduled_query_id=None, user_id=self.factory.user.id, query_id="adhoc")
        self.assertFalse(capture.called)

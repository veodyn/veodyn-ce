from unittest.mock import patch

from redash import models
from redash.tasks.queries.execution import QueryExecutionError, execute_query
from redash.utils.configuration import ConfigurationContainer
from tests import BaseTestCase
from tests.tasks.queries_test_helpers import fetch_job

TOKEN = "public-token-for-the-visualization"


@patch("redash.tasks.queries.execution.get_current_job", side_effect=fetch_job)
class TestPublicExecutionAuthority(BaseTestCase):
    def setup_queries(self, share_group):
        upstream_group = self.factory.create_group(name="upstream")
        public_group = self.factory.create_group(name="public")
        models.db.session.add_all([upstream_group, public_group])
        models.db.session.flush()
        upstream_ds = self.factory.create_data_source(group=share_group and public_group or upstream_group)
        public_ds = self.factory.create_data_source(
            group=public_group, type="results", options=ConfigurationContainer.from_json("{}")
        )
        stored = self.factory.create_query_result(
            data_source=upstream_ds,
            data={"columns": [{"name": "route_code", "type": "string"}], "rows": [{"route_code": "MT020"}]},
        )
        upstream = self.factory.create_query(data_source=upstream_ds, latest_query_data=stored)
        text = "SELECT route_code FROM cached_query_{}".format(upstream.id)
        public = self.factory.create_query(data_source=public_ds, query_text=text)
        models.db.session.commit()
        return text, public_ds, public

    def run_as_public(self, text, ds, query):
        return execute_query(text, ds.id, {"query_id": query.id}, user_id=TOKEN, is_api_key=True)

    def test_overlapping_groups_produce_a_result(self, _):
        text, ds, query = self.setup_queries(share_group=True)
        result = self.run_as_public(text, ds, query)
        self.assertNotIsInstance(result, QueryExecutionError)
        stored = models.QueryResult.query.get(result)
        self.assertEqual(stored.data["rows"], [{"route_code": "MT020"}])

    def test_disjoint_groups_fail_with_no_owner_fallback(self, _):
        text, ds, query = self.setup_queries(share_group=False)
        result = self.run_as_public(text, ds, query)
        self.assertIsInstance(result, QueryExecutionError)
        self.assertEqual(models.QueryResult.query.filter_by(data_source_id=ds.id).count(), 0)

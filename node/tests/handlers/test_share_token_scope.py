from unittest.mock import patch

from redash import models
from redash.handlers.base import record_event
from tests import BaseTestCase


def recorded(task):
    return [call[0][0] for call in task.delay.call_args_list]


class ShareTokenCase(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.vis = self.factory.create_visualization()
        self.query = self.vis.query_rel
        self.dashboard = self.factory.create_dashboard()
        self.factory.create_widget(dashboard=self.dashboard, visualization=self.vis)
        self.share_key = self.factory.create_api_key(object=self.dashboard)
        models.db.session.commit()
        self.token = self.share_key.api_key

    def with_token(self, method, path, data=None):
        separator = "&" if "?" in path else "?"
        return self.make_request(method, "{}{}api_key={}".format(path, separator, self.token), data=data, user=False)

    def execute_widget_query(self):
        return self.with_token("post", "/api/queries/{}/results".format(self.query.id), data={"parameters": {}})

    def disable_public_urls(self):
        self.factory.org.set_setting("disable_public_urls", True)
        models.db.session.commit()


class TestShareTokenIsConfinedToItsRoutes(ShareTokenCase):
    def test_share_token_cannot_read_the_query_definition(self):
        res = self.with_token("get", "/api/queries/{}".format(self.query.id))

        self.assertEqual(res.status_code, 404)
        self.assertNotIn("query", res.json or {})

    def test_share_token_cannot_read_the_query_definition_through_the_authorization_header(self):
        res = self.client.get(
            "/{}/api/queries/{}".format(self.factory.org.slug, self.query.id),
            headers={"Authorization": "Key {}".format(self.token)},
        )

        self.assertEqual(res.status_code, 404)

    def test_share_token_cannot_list_query_snippets(self):
        self.factory.create_query_snippet()
        models.db.session.commit()

        res = self.with_token("get", "/api/query_snippets")

        self.assertEqual(res.status_code, 404)

    def test_share_token_cannot_read_one_query_snippet(self):
        snippet = self.factory.create_query_snippet()
        models.db.session.commit()

        res = self.with_token("get", "/api/query_snippets/{}".format(snippet.id))

        self.assertEqual(res.status_code, 404)

    def test_share_token_cannot_post_events(self):
        admin = self.factory.create_admin()
        models.db.session.commit()

        with patch("redash.handlers.base.record_event_task") as task:
            res = self.with_token(
                "post",
                "/api/events",
                data=[{"action": "view", "object_type": "page", "user_id": admin.id, "user_name": admin.name}],
            )

        self.assertEqual(res.status_code, 404)
        self.assertEqual(recorded(task), [])

    def test_share_token_still_executes_its_dashboards_widget_query(self):
        res = self.execute_widget_query()

        self.assertEqual(res.status_code, 200)
        self.assertIn("job", res.json)

    def test_share_token_still_polls_the_job_its_execution_queued(self):
        job_id = self.execute_widget_query().json["job"]["id"]

        res = self.with_token("get", "/api/jobs/{}".format(job_id))

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["job"]["id"], job_id)

    def test_public_dashboard_read_is_still_attributed_to_the_share_key(self):
        with patch("redash.handlers.base.record_event_task") as task:
            res = self.make_request("get", "/api/dashboards/public/{}".format(self.token), user=False)

        self.assertEqual(res.status_code, 200)
        event = recorded(task)[0]
        self.assertEqual(event["outcome"], "ok")
        self.assertEqual(event["api_key"], "ApiKey: {}".format(self.share_key.id))


class TestShareTokenHonoursDisablePublicUrls(ShareTokenCase):
    def test_share_token_cannot_execute_its_widget_query_while_public_urls_are_disabled(self):
        self.disable_public_urls()

        res = self.execute_widget_query()

        self.assertEqual(res.status_code, 404)
        self.assertNotIn("job", res.json or {})

    def test_share_token_cannot_read_a_cached_result_while_public_urls_are_disabled(self):
        self.factory.create_query_result(
            data_source=self.query.data_source,
            query_text=self.query.query_text,
            query_hash=self.query.query_hash,
        )
        self.disable_public_urls()

        res = self.execute_widget_query()

        self.assertEqual(res.status_code, 404)
        self.assertNotIn("query_result", res.json or {})

    def test_share_token_reads_a_cached_result_while_public_urls_are_enabled(self):
        self.factory.create_query_result(
            data_source=self.query.data_source,
            query_text=self.query.query_text,
            query_hash=self.query.query_hash,
        )
        models.db.session.commit()

        res = self.execute_widget_query()

        self.assertEqual(res.status_code, 200)
        self.assertIn("query_result", res.json)
        self.assertNotIn("job", res.json)

    def test_public_dashboard_still_records_the_disabled_outcome(self):
        self.disable_public_urls()

        with patch("redash.handlers.base.record_event_task") as task:
            res = self.make_request("get", "/api/dashboards/public/{}".format(self.token), user=False)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(recorded(task)[0]["outcome"], "disabled")


class TestApiPrincipalEventAttributionIsServerOwned(BaseTestCase):
    def test_api_principal_event_ignores_a_client_supplied_user(self):
        admin = self.factory.create_admin()
        share_key = self.factory.create_api_key(object=self.factory.create_dashboard())
        models.db.session.commit()
        principal = models.ApiUser(share_key, share_key.org, [])

        with self.app.test_request_context("/"):
            with patch("redash.handlers.base.record_event_task") as task:
                record_event(
                    self.factory.org,
                    principal,
                    {"action": "view", "object_type": "page", "user_id": admin.id, "user_name": admin.name},
                )

        event = recorded(task)[0]
        self.assertIsNone(event["user_id"])
        self.assertNotIn("user_name", event)
        self.assertEqual(event["api_key"], principal.name)

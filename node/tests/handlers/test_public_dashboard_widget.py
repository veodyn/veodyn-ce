import datetime
from unittest.mock import patch

from redash import models, redis_connection
from redash.utils import gen_query_hash, utcnow
from tests import BaseTestCase

ROUTES = "MT020\nMT030"
STOPS = [
    {"name": "Central Station", "value": "80214"},
    {"name": "Central Ave / 5th", "value": "1201"},
    {"name": "Elm St / Market Center", "value": "80211"},
    {"name": "Unlisted Depot", "value": "XX01"},
]


class PublicWidgetCase(BaseTestCase):
    def build(self, parameters=None, text="SELECT '{{ route }}'", vis_options=None):
        self.factory.grant_permission("publish_dashboard")
        if parameters is None:
            parameters = [{"name": "route", "type": "enum", "enumOptions": ROUTES, "value": "MT020"}]
        self.query = self.factory.create_query(query_text=text, options={"parameters": parameters})
        if vis_options is None:
            vis_options = {"publicParameters": {"route": "^MT[0-9A-Z]{3,5}$"}}
        self.vis = self.factory.create_visualization(query_rel=self.query, name="Departures", options=vis_options)
        self.dashboard = self.factory.create_dashboard()
        self.widget = self.factory.create_widget(dashboard=self.dashboard, visualization=self.vis)
        models.db.session.commit()
        self.token = self.share(self.dashboard)

    def share(self, dashboard):
        shared = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))
        return shared.json["api_key"]

    def get(self, qs="", token=None, widget_id=None):
        return self.make_request(
            "get",
            "/api/dashboards/public/{}/widgets/{}{}".format(
                token or self.token, self.widget.id if widget_id is None else widget_id, qs
            ),
            user=False,
            is_json=False,
        )

    def values(self, name="route", qs="", token=None, widget_id=None):
        return self.make_request(
            "get",
            "/api/dashboards/public/{}/widgets/{}/parameters/{}/values{}".format(
                token or self.token, self.widget.id if widget_id is None else widget_id, name, qs
            ),
            user=False,
            is_json=False,
        )

    def store(self, text, age=0):
        result = self.factory.create_query_result(
            data_source=self.query.data_source,
            query_text=text,
            query_hash=gen_query_hash(text),
            data={"columns": [{"name": "x"}], "rows": [{"x": text}]},
            retrieved_at=utcnow() - datetime.timedelta(seconds=age),
        )
        models.db.session.commit()
        return result


class TestWidgetRead(PublicWidgetCase):
    def test_serves_the_widget_visualization_with_its_latest_result(self):
        self.build()
        self.query.latest_query_data = self.store("SELECT 'MT020'")
        models.db.session.commit()
        res = self.get()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["name"], "Departures")
        self.assertEqual(res.json["query"]["id"], self.query.id)
        self.assertEqual(res.json["query_result"]["data"]["rows"], [{"x": "SELECT 'MT020'"}])
        self.assertNotIn("query", res.json["query"])
        self.assertNotIn("api_key", res.json)

    def test_records_a_dashboard_widget_read(self):
        self.build()
        with patch("redash.handlers.base.record_event_task") as task:
            self.get()
        event = task.delay.call_args[0][0]
        self.assertEqual(event["object_type"], "dashboard_widget")
        self.assertEqual(event["object_id"], self.widget.id)
        self.assertEqual(event["outcome"], "ok")

    def test_a_widget_of_another_dashboard_404s(self):
        self.build()
        other = self.factory.create_widget()
        models.db.session.commit()
        with patch("redash.handlers.base.record_event_task") as task:
            res = self.get(widget_id=other.id)
        self.assertEqual(res.status_code, 404)
        self.assertEqual(task.delay.call_args[0][0]["outcome"], "not_found")

    def test_an_unknown_widget_404s(self):
        self.build()
        self.assertEqual(self.get(widget_id=999999).status_code, 404)

    def test_an_unknown_token_404s(self):
        self.build()
        self.assertEqual(self.get(token="not-a-token").status_code, 404)

    def test_a_visualization_token_does_not_open_a_widget(self):
        self.build()
        self.factory.grant_permission("publish_visualization")
        vis_token = self.make_request("post", "/api/visualizations/{}/share".format(self.vis.id)).json["api_key"]
        self.assertEqual(self.get(token=vis_token).status_code, 404)

    def test_a_revoked_share_404s(self):
        self.build()
        self.assertEqual(self.get().status_code, 200)
        self.make_request("delete", "/api/dashboards/{}/share".format(self.dashboard.id))
        with patch("redash.handlers.base.record_event_task") as task:
            res = self.get()
        self.assertEqual(res.status_code, 404)
        self.assertEqual(task.delay.call_args[0][0]["outcome"], "revoked")

    def test_an_archived_query_404s(self):
        self.build()
        self.query.is_archived = True
        models.db.session.commit()
        self.assertEqual(self.get().status_code, 404)

    def test_a_text_widget_404s(self):
        self.build()
        text = self.factory.create_widget(dashboard=self.dashboard, visualization=None, text="# Hello")
        models.db.session.commit()
        self.assertEqual(self.get(widget_id=text.id).status_code, 404)

    def test_disable_public_urls_404s(self):
        self.build()
        self.factory.org.set_setting("disable_public_urls", True)
        models.db.session.commit()
        with patch("redash.handlers.base.record_event_task") as task:
            res = self.get()
        self.assertEqual(res.status_code, 404)
        self.assertEqual(task.delay.call_args[0][0]["outcome"], "disabled")

    def test_the_dashboard_payload_and_the_widget_read_agree_on_ids(self):
        self.build()
        payload = self.make_request(
            "get", "/api/dashboards/public/{}".format(self.token), user=False, is_json=False
        ).json
        ids = [w["id"] for w in payload["widgets"] if "visualization" in w]
        self.assertEqual(ids, [self.widget.id])


class TestWidgetParameters(PublicWidgetCase):
    def assert_rejected(self, qs):
        with patch("redash.public_execution.enqueue_query") as enqueue:
            res = self.get(qs)
        self.assertEqual(res.status_code, 404)
        enqueue.assert_not_called()
        self.assertEqual(redis_connection.keys("public-exec*"), [])

    def test_an_accepted_parameter_answers_fresh(self):
        self.build()
        self.store("SELECT 'MT030'", age=5)
        with patch("redash.public_execution.enqueue_query") as enqueue:
            res = self.get("?p_route=MT030")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["status"], "fresh")
        self.assertEqual(res.json["parameters"], {"route": "MT030"})
        enqueue.assert_not_called()

    def test_a_value_outside_the_enum_is_rejected(self):
        self.build()
        self.assert_rejected("?p_route=MT999")

    def test_a_parameter_not_listed_as_public_is_rejected(self):
        self.build(vis_options={"publicParameters": {"other": "^x$"}})
        self.assert_rejected("?p_route=MT020")

    def test_a_miss_enqueues_under_the_dashboard_token_and_answers_202(self):
        self.build()
        with patch("redash.public_execution.enqueue_query") as enqueue:
            res = self.get("?p_route=MT020")
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.headers["Retry-After"], "2")
        self.assertEqual(res.json["status"], "pending")
        args, kwargs = enqueue.call_args
        self.assertEqual(args[0], "SELECT 'MT020'")
        self.assertEqual(args[2], self.token)
        self.assertTrue(kwargs["is_api_key"])
        self.assertEqual(kwargs["metadata"]["query_id"], self.query.id)

    def test_a_stale_result_is_served_when_capacity_is_full(self):
        self.build(vis_options={"publicParameters": {"route": "^MT[0-9A-Z]{3,5}$"}, "publicMaxRunsPerWindow": 1})
        self.store("SELECT 'MT030'", age=3000)
        with patch("redash.public_execution.enqueue_query"):
            self.assertEqual(self.get("?p_route=MT020").status_code, 202)
            res = self.get("?p_route=MT030")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["status"], "stale")

    def test_disable_public_urls_rejects_a_parameterised_read(self):
        self.build()
        self.factory.org.set_setting("disable_public_urls", True)
        models.db.session.commit()
        self.assert_rejected("?p_route=MT020")


class TestParameterValues(PublicWidgetCase):
    def build_dropdown(self, rows=STOPS, pattern="^[0-9]{3,6}$"):
        stored = self.factory.create_query_result(
            data={"columns": [{"name": "name"}, {"name": "value"}], "rows": rows}
        )
        self.dropdown = self.factory.create_query(latest_query_data=stored)
        models.db.session.commit()
        self.build(
            parameters=[{"name": "stop", "type": "query", "queryId": self.dropdown.id, "value": "80214"}],
            text="SELECT '{{ stop }}'",
            vis_options={"publicParameters": {"stop": pattern}},
        )

    def test_serves_enum_options_that_match_the_public_pattern(self):
        self.build(
            parameters=[{"name": "route", "type": "enum", "enumOptions": "MT020\nXX020\nMT030", "value": "MT020"}]
        )
        res = self.values()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res.json["values"], [{"name": "MT020", "value": "MT020"}, {"name": "MT030", "value": "MT030"}]
        )
        self.assertFalse(res.json["truncated"])

    def test_serves_dropdown_rows_filtered_by_pattern(self):
        self.build_dropdown()
        res = self.values("stop")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([v["value"] for v in res.json["values"]], ["80214", "1201", "80211"])

    def test_filters_by_a_case_insensitive_prefix_of_name_or_value(self):
        self.build_dropdown()
        self.assertEqual([v["value"] for v in self.values("stop", "?q=central").json["values"]], ["80214", "1201"])
        self.assertEqual([v["value"] for v in self.values("stop", "?q=8021").json["values"]], ["80214", "80211"])

    def test_caps_the_list_and_says_so(self):
        rows = [{"name": "Stop {}".format(i), "value": str(1000 + i)} for i in range(120)]
        self.build_dropdown(rows=rows)
        res = self.values("stop")
        self.assertEqual(len(res.json["values"]), 50)
        self.assertTrue(res.json["truncated"])

    def test_a_parameter_that_is_not_public_404s(self):
        self.build_dropdown()
        self.assertEqual(self.values("route").status_code, 404)

    def test_a_declared_parameter_left_out_of_public_parameters_404s(self):
        self.build(vis_options={"publicParameters": {"other": "^x$"}})
        self.assertEqual(self.values("route").status_code, 404)

    def test_a_text_parameter_404s_even_if_listed(self):
        self.build(parameters=[{"name": "route", "type": "text", "value": "MT020"}])
        self.assertEqual(self.values("route").status_code, 404)

    def test_a_dropdown_without_a_result_answers_unavailable(self):
        self.dropdown = self.factory.create_query()
        models.db.session.commit()
        self.build(
            parameters=[{"name": "stop", "type": "query", "queryId": self.dropdown.id, "value": "1"}],
            text="SELECT '{{ stop }}'",
            vis_options={"publicParameters": {"stop": "^[0-9]+$"}},
        )
        res = self.values("stop")
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.headers["Retry-After"], "30")

    def test_a_dropdown_in_another_org_404s(self):
        other = self.factory.create_org()
        foreign = self.factory.create_query(org=other, data_source=self.factory.create_data_source(org=other))
        models.db.session.commit()
        self.build(
            parameters=[{"name": "stop", "type": "query", "queryId": foreign.id, "value": "1"}],
            text="SELECT '{{ stop }}'",
            vis_options={"publicParameters": {"stop": "^[0-9]+$"}},
        )
        self.assertEqual(self.values("stop").status_code, 404)

    def test_a_widget_of_another_dashboard_404s(self):
        self.build_dropdown()
        other = self.factory.create_widget()
        models.db.session.commit()
        self.assertEqual(self.values("stop", widget_id=other.id).status_code, 404)

    def test_a_revoked_share_404s(self):
        self.build_dropdown()
        self.make_request("delete", "/api/dashboards/{}/share".format(self.dashboard.id))
        self.assertEqual(self.values("stop").status_code, 404)

    def test_disable_public_urls_404s(self):
        self.build_dropdown()
        self.factory.org.set_setting("disable_public_urls", True)
        models.db.session.commit()
        self.assertEqual(self.values("stop").status_code, 404)

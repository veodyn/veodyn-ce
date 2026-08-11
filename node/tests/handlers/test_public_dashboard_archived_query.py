import json
from unittest.mock import patch

from redash.models import Widget, db
from tests import BaseTestCase


class TestPublicDashboardWithAnArchivedQuery(BaseTestCase):
    """A dashboard's share token must not keep serving an archived query.

    Archiving a query withdraws the embed tokens on its own visualizations, but
    that same query is usually also a widget on a dashboard, and the dashboard
    carries a token of its own that nothing about the query's archive touches.

    The two archive paths differ. DELETE /api/queries/<id> runs Query.archive,
    which deletes the widgets outright, so a public dashboard is left with
    nothing to serve. POST /api/queries/<id> copies is_archived onto the model
    like any other field, the widgets stay, and the read side is the only thing
    left that can refuse them.
    """

    ARCHIVED_QUERY_NAME = "Headcount by department"
    ARCHIVED_QUERY_DESCRIPTION = "Who reports to whom, and how many of them"
    ARCHIVED_VISUALIZATION_NAME = "Headcount pie"

    def read(self, token):
        with patch("redash.handlers.base.record_event_task"):
            return self.make_request(
                "get",
                "/api/dashboards/public/{}".format(token),
                user=False,
                is_json=False,
            )

    def share(self, dashboard):
        self.factory.grant_permission("publish_dashboard")
        shared = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))
        return shared.json["api_key"]

    def create_dashboard_with_two_widgets(self):
        dashboard = self.factory.create_dashboard()
        doomed = self.factory.create_visualization(
            name=self.ARCHIVED_VISUALIZATION_NAME,
            query_rel=self.factory.create_query(
                name=self.ARCHIVED_QUERY_NAME,
                description=self.ARCHIVED_QUERY_DESCRIPTION,
            ),
        )
        live = self.factory.create_visualization(name="Revenue line")
        self.factory.create_widget(dashboard=dashboard, visualization=doomed)
        self.factory.create_widget(dashboard=dashboard, visualization=live)
        db.session.commit()
        return dashboard, doomed, live

    def served_query_ids(self, res):
        return [w["visualization"]["query"]["id"] for w in res.json["widgets"] if "visualization" in w]

    def archive_through_the_update_path(self, query):
        updated = self.make_request(
            "post",
            "/api/queries/{}".format(query.id),
            data={"is_archived": True},
        )
        self.assertEqual(updated.status_code, 200)

    def test_serves_no_trace_of_a_query_archived_through_the_update_path(self):
        dashboard, doomed, _ = self.create_dashboard_with_two_widgets()
        archived_query_id = doomed.query_rel.id
        token = self.share(dashboard)

        self.archive_through_the_update_path(doomed.query_rel)

        res = self.read(token)

        self.assertEqual(res.status_code, 200)
        self.assertNotIn(archived_query_id, self.served_query_ids(res))
        body = json.dumps(res.json)
        self.assertNotIn(self.ARCHIVED_QUERY_NAME, body)
        self.assertNotIn(self.ARCHIVED_QUERY_DESCRIPTION, body)
        self.assertNotIn(self.ARCHIVED_VISUALIZATION_NAME, body)

    def test_still_serves_the_sibling_widget_whose_query_is_live(self):
        dashboard, doomed, live = self.create_dashboard_with_two_widgets()
        live_query_id = live.query_rel.id
        token = self.share(dashboard)

        self.archive_through_the_update_path(doomed.query_rel)

        res = self.read(token)

        self.assertEqual(res.status_code, 200)
        self.assertEqual(1, len(res.json["widgets"]))
        self.assertEqual([live_query_id], self.served_query_ids(res))

    def test_still_serves_a_textbox_widget_that_has_no_query_at_all(self):
        # The archived widget is found by joining widgets to queries, and a
        # textbox joins to nothing. A filter written on the query column alone
        # answers unknown for that row and drops it.
        dashboard, doomed, _ = self.create_dashboard_with_two_widgets()
        self.factory.create_widget(dashboard=dashboard, visualization=None, text="Read me first")
        db.session.commit()
        token = self.share(dashboard)

        self.archive_through_the_update_path(doomed.query_rel)

        res = self.read(token)

        self.assertEqual(res.status_code, 200)
        self.assertIn("Read me first", [w["text"] for w in res.json["widgets"]])

    def test_the_delete_path_takes_the_widget_with_it(self):
        # Query.archive deletes the widgets, so this path never reaches the
        # serializer's filter at all. Asserted so that an archive() which stops
        # deleting them shows up here rather than as a live leak.
        dashboard, doomed, live = self.create_dashboard_with_two_widgets()
        archived_query_id = doomed.query_rel.id
        live_query_id = live.query_rel.id
        token = self.share(dashboard)

        deleted = self.make_request("delete", "/api/queries/{}".format(archived_query_id))
        self.assertEqual(deleted.status_code, 200)

        self.assertEqual(1, Widget.query.filter(Widget.dashboard_id == dashboard.id).count())

        res = self.read(token)

        self.assertEqual(res.status_code, 200)
        self.assertEqual([live_query_id], self.served_query_ids(res))
        self.assertNotIn(self.ARCHIVED_QUERY_NAME, json.dumps(res.json))

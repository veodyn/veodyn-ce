from sqlalchemy import text

from redash.handlers.query_results import error_messages
from redash.models import db
from tests import BaseTestCase


class TestExecutingAQueryWithADashboardToken(BaseTestCase):
    """A dashboard share token is an execute credential, not only a read one.

    POST /api/queries/<id>/results asks has_access and nothing else for a query
    with no unsafe parameters, and for an api user that resolves to
    Query.dashboard_api_keys: is this token one of the dashboards this query
    appears on. No data source group check runs behind it, so that list is the
    whole authorization decision and everything in it can be run on demand,
    with fresh results, by whoever holds the link.

    Which makes it the place archived has to be enforced. Taking the widget out
    of the public dashboard payload hides the query from the page and leaves
    this endpoint answering for anyone who kept the query id.
    """

    def execute(self, query_id, token):
        return self.make_request(
            "post",
            "/api/queries/{}/results?api_key={}".format(query_id, token),
            data={"parameters": {}},
            user=False,
        )

    def share(self, dashboard):
        self.factory.grant_permission("publish_dashboard")
        shared = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))
        self.assertEqual(shared.status_code, 200)
        return shared.json["api_key"]

    def archive_through_the_update_path(self, query):
        # Not DELETE /api/queries/<id>. That runs Query.archive, which deletes
        # the widgets, and a query with no widget left is out of reach here for
        # a reason that has nothing to do with access control. The generic
        # update path sets the column and leaves the dashboard as it was, which
        # is the arrangement this endpoint has to refuse on its own.
        updated = self.make_request("post", "/api/queries/{}".format(query.id), data={"is_archived": True})
        self.assertEqual(updated.status_code, 200)

    def create_dashboard_with_two_widgets(self):
        dashboard = self.factory.create_dashboard()
        doomed = self.factory.create_visualization()
        live = self.factory.create_visualization()
        self.factory.create_widget(dashboard=dashboard, visualization=doomed)
        self.factory.create_widget(dashboard=dashboard, visualization=live)
        db.session.commit()
        return dashboard, doomed.query_rel, live.query_rel

    def test_refuses_to_execute_a_query_archived_through_the_update_path(self):
        dashboard, doomed, _ = self.create_dashboard_with_two_widgets()
        token = self.share(dashboard)
        doomed_id = doomed.id

        self.archive_through_the_update_path(doomed)

        res = self.execute(doomed_id, token)

        self.assertEqual(res.status_code, 403)
        self.assertEqual(error_messages["no_permission"][0], res.json)

    def test_still_executes_a_live_query_on_the_same_dashboard(self):
        # The other half of the fix. A dashboard token that stopped running the
        # dashboard's own queries would pass the test above by turning the
        # feature off.
        dashboard, doomed, live = self.create_dashboard_with_two_widgets()
        token = self.share(dashboard)
        live_id = live.id

        self.archive_through_the_update_path(doomed)

        res = self.execute(live_id, token)

        self.assertEqual(res.status_code, 200)
        self.assertIn("job", res.json)

    def test_executes_both_queries_while_neither_is_archived(self):
        dashboard, first, second = self.create_dashboard_with_two_widgets()
        token = self.share(dashboard)

        for query in (first, second):
            res = self.execute(query.id, token)
            self.assertEqual(res.status_code, 200)
            self.assertIn("job", res.json)

    def test_refuses_when_the_dashboard_itself_is_archived_behind_the_revoke(self):
        # Archiving a dashboard revokes its tokens on the way out, so this
        # cannot normally be reached. Written against the column directly, the
        # way a restore or a hand run UPDATE reaches it, because the read side
        # is supposed to hold whatever the write path did or failed to do.
        dashboard, doomed, _ = self.create_dashboard_with_two_widgets()
        token = self.share(dashboard)
        doomed_id = doomed.id

        db.session.execute(
            text("UPDATE dashboards SET is_archived = true WHERE id = :id"),
            {"id": dashboard.id},
        )
        db.session.commit()

        res = self.execute(doomed_id, token)

        self.assertEqual(res.status_code, 403)
        self.assertEqual(error_messages["no_permission"][0], res.json)

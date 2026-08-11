import datetime

from redash import models
from redash.utils import utcnow
from tests import BaseTestCase


class TestSharedLinks(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.admin = self.factory.create_admin()

    def read(self, user=None):
        return self.make_request("get", "/api/admin/shared_links", user=user or self.admin)

    def rows(self, user=None):
        response = self.read(user)
        # Asserted rather than assumed: every refusal in this handler comes back
        # as JSON too, so indexing straight into the body turns a 403 into a
        # KeyError that says nothing about what went wrong.
        self.assertEqual(response.status_code, 200, response.data)
        return response.json["shared_links"]

    def share_dashboard(self):
        dashboard = self.factory.create_dashboard()
        models.db.session.commit()
        shared = self.make_request(
            "post",
            "/api/dashboards/{}/share".format(dashboard.id),
            user=self.admin,
        )
        return dashboard, shared.json["api_key"]

    def share_visualization(self):
        visualization = self.factory.create_visualization()
        models.db.session.commit()
        shared = self.make_request(
            "post",
            "/api/visualizations/{}/share".format(visualization.id),
            user=self.admin,
        )
        return visualization, shared.json["api_key"]

    def record_read(
        self,
        object_type,
        object_id,
        outcome="ok",
        ago=datetime.timedelta(0),
        client_submitted=False,
        at=None,
    ):
        """An anonymous read, shaped the way record_public_read writes one.

        client_submitted defaults to False because handlers.base.record_event
        stamps every server write that way, so that is the shape of a real row.
        Pass None for outcome to get the shape handlers/embed.public_dashboard
        writes for a page shell load, and True for client_submitted to get the
        shape POST /api/events produces. `at` pins an absolute moment, for the
        tests where what decides the assertion is which side of a boundary the
        read falls on rather than how long ago it was.
        """
        properties = {"public": True, models.CLIENT_SUBMITTED_KEY: client_submitted}
        if outcome is not None:
            properties["outcome"] = outcome

        models.db.session.add(
            models.Event(
                org=self.factory.org,
                user=None,
                action="view",
                object_type=object_type,
                object_id=str(object_id),
                additional_properties=properties,
                created_at=at if at is not None else utcnow() - ago,
            )
        )
        models.db.session.commit()

    def test_a_non_admin_is_refused(self):
        # The response carries live credentials for every published object in
        # the org, so this gate is the whole of what keeps them from anyone with
        # an account.
        self.assertEqual(self.read(user=self.factory.user).status_code, 403)

    def test_lists_a_shared_dashboard_with_its_token(self):
        dashboard, token = self.share_dashboard()

        (row,) = self.rows()

        self.assertEqual(row["type"], "dashboard")
        self.assertEqual(row["object_id"], dashboard.id)
        self.assertEqual(row["name"], dashboard.name)
        self.assertEqual(row["token"], token)
        self.assertEqual(row["created_by"]["id"], self.admin.id)
        self.assertIsNone(row["expires_at"])
        self.assertFalse(row["target_missing"])

    def test_lists_a_shared_visualization_under_its_query_name(self):
        # A visualization's own name is routinely blank or "Table", so the query
        # name is the only part of this row an admin can recognise.
        visualization, token = self.share_visualization()

        (row,) = self.rows()

        self.assertEqual(row["type"], "visualization")
        self.assertEqual(row["object_id"], visualization.id)
        self.assertEqual(row["query_id"], visualization.query_rel.id)
        self.assertIn(visualization.query_rel.name, row["name"])
        self.assertEqual(row["token"], token)

    def test_omits_revoked_links(self):
        dashboard, _ = self.share_dashboard()
        self.make_request(
            "delete",
            "/api/dashboards/{}/share".format(dashboard.id),
            user=self.admin,
        )

        self.assertEqual(self.rows(), [])

    def test_omits_another_organizations_links(self):
        # api_keys is a single table across every tenant, so the org filter is
        # the only thing standing between one tenant's admin console and
        # another tenant's live share tokens.
        # Minted through the factory rather than over HTTP, the way
        # TestPublicDashboardAcrossOrgs does it: sharing as the other org's
        # admin would leave this client authenticated into that org, and the
        # read under test would then be refused for a reason that has nothing
        # to do with what is being asserted.
        other_org = self.factory.create_org()
        other_user = self.factory.create_user(org=other_org)
        other_dashboard = self.factory.create_dashboard(org=other_org, user=other_user)
        self.factory.create_api_key(object=other_dashboard, org=other_org)
        models.db.session.commit()

        self.assertEqual(self.rows(), [])

    def test_keeps_an_expired_link_and_reports_when_it_lapsed(self):
        # Expiry stops the link resolving but leaves the row active, so this is
        # the only screen that can show the credential is still there to clean
        # up.
        dashboard, _ = self.share_dashboard()
        key = models.ApiKey.get_by_object(dashboard)
        key.expires_at = utcnow() - datetime.timedelta(days=1)
        models.db.session.commit()

        (row,) = self.rows()

        self.assertIsNotNone(row["expires_at"])

    def test_counts_only_successful_public_reads(self):
        # A refused read means somebody is holding a token that no longer works.
        # Worth knowing, but not evidence that revoking would take anything away
        # from anyone, which is the question this figure answers.
        dashboard, _ = self.share_dashboard()
        self.record_read("dashboard", dashboard.id)
        self.record_read("dashboard", dashboard.id)
        self.record_read("dashboard", dashboard.id, outcome="expired")

        (row,) = self.rows()

        self.assertEqual(row["reads_last_30_days"], 2)
        self.assertIsNotNone(row["last_accessed_at"])

    def test_excludes_reads_older_than_the_window_from_the_count(self):
        # A link minted a year ago and last opened 90 days ago. The key is
        # backdated because reads are counted only from the moment the current
        # token was minted, so a read older than the key it is meant to belong
        # to is not a read of that link at all.
        dashboard, _ = self.share_dashboard()
        key = models.ApiKey.get_by_object(dashboard)
        key.created_at = utcnow() - datetime.timedelta(days=365)
        models.db.session.commit()
        self.record_read("dashboard", dashboard.id, ago=datetime.timedelta(days=90))

        (row,) = self.rows()

        self.assertEqual(row["reads_last_30_days"], 0)
        # Still reported, because "last used a year ago" is the answer that
        # makes a link safe to revoke, and a null there reads as "never used".
        self.assertIsNotNone(row["last_accessed_at"])

    def test_does_not_count_a_dashboard_read_against_a_visualization(self):
        # events.object_id is not unique across object types, so a query that
        # forgets the type reports one object's traffic on another's row.
        dashboard, _ = self.share_dashboard()
        visualization, _ = self.share_visualization()
        self.record_read("visualization", dashboard.id)

        rows = {row["type"]: row for row in self.rows()}

        self.assertEqual(rows["dashboard"]["reads_last_30_days"], 0)
        self.assertIsNone(rows["dashboard"]["last_accessed_at"])

    def test_reports_a_link_whose_target_is_gone(self):
        # ApiKey's generic foreign key has no cascade, so deleting the target
        # leaves the credential behind. It resolves to a 404 and is therefore
        # not exposure, but it is still a live row and the console says so
        # rather than dropping it and under-reporting.
        dashboard, _ = self.share_dashboard()
        key = models.ApiKey.get_by_object(dashboard)
        key.active = True
        models.db.session.delete(dashboard)
        models.db.session.commit()

        (row,) = self.rows()

        self.assertTrue(row["target_missing"])
        self.assertIsNone(row["name"])

    def test_ignores_reads_a_user_posted_to_the_events_api(self):
        # POST /api/events takes an arbitrary action, object_type, object_id and
        # properties from any signed-in user. Without the provenance filter,
        # anyone with an account can make a link they do not want revoked look
        # busy on the one screen where that decision gets made.
        dashboard, _ = self.share_dashboard()
        self.record_read("dashboard", dashboard.id, client_submitted=True)

        (row,) = self.rows()

        self.assertEqual(row["reads_last_30_days"], 0)
        self.assertIsNone(row["last_accessed_at"])

    def test_does_not_count_the_public_page_shell_as_a_second_read(self):
        # Opening /public/dashboards/<token> writes two events: the shell load
        # from handlers/embed.public_dashboard, which carries no outcome, and
        # then the fetch PublicDashboardPage makes to
        # /api/dashboards/public/<token>, which is the request that serves the
        # dashboard and carries one. Counting both doubles every open.
        dashboard, _ = self.share_dashboard()
        self.record_read("dashboard", dashboard.id, outcome=None)
        self.record_read("dashboard", dashboard.id)

        (row,) = self.rows()

        self.assertEqual(row["reads_last_30_days"], 1)

    def test_counts_a_read_taken_in_the_same_second_the_link_was_minted(self):
        # Event.record rebuilds created_at from int(time.time()) while
        # ApiKey.created_at keeps database microseconds, so a read moments after
        # a mint is stored as earlier than the key it belongs to. Reporting
        # "never opened" for a link somebody is using right now is what gets it
        # revoked.
        dashboard, _ = self.share_dashboard()
        key = models.ApiKey.get_by_object(dashboard)
        minted = key.created_at.replace(microsecond=700000)
        key.created_at = minted
        models.db.session.commit()
        self.record_read("dashboard", dashboard.id, at=minted.replace(microsecond=0))

        (row,) = self.rows()

        self.assertEqual(row["reads_last_30_days"], 1)

    def test_a_reshared_link_does_not_inherit_the_previous_token_s_reads(self):
        # api_keys rows accumulate, so the replacement key has the same org,
        # type and object id as the one it replaced. A link minted a minute ago
        # reporting last year's traffic is the reading that stops an admin
        # revoking it.
        dashboard, first = self.share_dashboard()
        self.record_read("dashboard", dashboard.id, ago=datetime.timedelta(days=2))
        self.make_request(
            "delete", "/api/dashboards/{}/share".format(dashboard.id), user=self.admin
        )
        reshared = self.make_request(
            "post", "/api/dashboards/{}/share".format(dashboard.id), user=self.admin
        )

        self.assertNotEqual(reshared.json["api_key"], first)

        (row,) = self.rows()

        self.assertEqual(row["reads_last_30_days"], 0)
        self.assertIsNone(row["last_accessed_at"])

    def test_reports_whether_public_urls_are_switched_off_for_the_org(self):
        # An org-level setting, not anything readable off a key, and while it is
        # on every link listed here is refused whatever its own row says.
        self.share_dashboard()

        self.assertFalse(self.read().json["public_urls_disabled"])

        self.factory.org.set_setting("disable_public_urls", True)
        models.db.session.commit()

        self.assertTrue(self.read().json["public_urls_disabled"])

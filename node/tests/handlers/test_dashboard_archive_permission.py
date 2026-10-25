from redash import models
from redash.permissions import ACCESS_TYPE_MODIFY
from tests import BaseTestCase


class TestDashboardArchivePermission(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.factory.user
        self.grantee = self.factory.create_user()
        self.dashboard = self.factory.create_dashboard(user=self.owner)
        models.AccessPermission.grant(self.dashboard, ACCESS_TYPE_MODIFY, self.grantee, self.owner)
        models.db.session.commit()
        self.url = "/api/dashboards/{}".format(self.dashboard.id)

    def is_archived(self):
        models.db.session.expire_all()
        return models.Dashboard.query.get(self.dashboard.id).is_archived

    def test_delete_refused_for_non_owner(self):
        rv = self.make_request("delete", self.url, user=self.grantee)

        self.assertEqual(rv.status_code, 403)
        self.assertFalse(self.is_archived())

    def test_post_is_archived_refused_for_non_owner(self):
        rv = self.make_request("post", self.url, user=self.grantee, data={"is_archived": True})

        self.assertEqual(rv.status_code, 403)
        self.assertFalse(self.is_archived())

    def test_post_other_fields_still_allowed_for_grantee(self):
        rv = self.make_request("post", self.url, user=self.grantee, data={"name": "renamed by grantee"})

        self.assertEqual(rv.status_code, 200)
        self.assertEqual(rv.json["name"], "renamed by grantee")

    def test_post_is_archived_false_on_live_dashboard_allowed_for_grantee(self):
        rv = self.make_request("post", self.url, user=self.grantee, data={"is_archived": False})

        self.assertEqual(rv.status_code, 200)
        self.assertFalse(self.is_archived())

    def test_owner_can_archive_both_ways(self):
        rv = self.make_request("delete", self.url, user=self.owner)
        self.assertEqual(rv.status_code, 200)
        self.assertTrue(self.is_archived())

        self.make_request("post", self.url, user=self.owner, data={"is_archived": False})
        self.assertFalse(self.is_archived())

        rv = self.make_request("post", self.url, user=self.owner, data={"is_archived": True})
        self.assertEqual(rv.status_code, 200)
        self.assertTrue(self.is_archived())

    def test_admin_can_archive_both_ways(self):
        admin = self.factory.create_admin()

        rv = self.make_request("delete", self.url, user=admin)
        self.assertEqual(rv.status_code, 200)
        self.assertTrue(self.is_archived())

        self.make_request("post", self.url, user=admin, data={"is_archived": False})
        self.assertFalse(self.is_archived())

        rv = self.make_request("post", self.url, user=admin, data={"is_archived": True})
        self.assertEqual(rv.status_code, 200)
        self.assertTrue(self.is_archived())

    def test_restore_keeps_todays_rule(self):
        self.make_request("delete", self.url, user=self.owner)
        self.assertTrue(self.is_archived())

        rv = self.make_request("post", self.url, user=self.grantee, data={"is_archived": False})

        self.assertEqual(rv.status_code, 200)
        self.assertFalse(self.is_archived())

    def test_already_archived_resent_as_archived_is_allowed_for_grantee(self):
        self.make_request("delete", self.url, user=self.owner)

        rv = self.make_request("post", self.url, user=self.grantee, data={"is_archived": True})

        self.assertEqual(rv.status_code, 200)
        self.assertTrue(self.is_archived())

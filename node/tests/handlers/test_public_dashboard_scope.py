from unittest.mock import patch

from redash.models import ApiKey, db
from tests import BaseTestCase


class TestPublicDashboardAcrossOrgs(BaseTestCase):
    """A share token is a credential for one object in one organization.

    The organization is the slug in the route, which the reader picks, so
    nothing about the request itself keeps a link minted in one tenant from
    being redeemed under another. That is the whole attack: mint where you are
    allowed to, redeem under an org whose settings suit you better.
    """

    def read(self, token):
        with patch("redash.handlers.base.record_event_task") as task:
            res = self.make_request(
                "get",
                "/api/dashboards/public/{}".format(token),
                user=False,
                is_json=False,
            )
        return res, task.delay.call_args[0][0]

    def create_shared_dashboard_in_another_org(self):
        org = self.factory.create_org()
        user = self.factory.create_user(org=org)
        dashboard = self.factory.create_dashboard(org=org, user=user)
        api_key = self.factory.create_api_key(object=dashboard, org=org)
        db.session.commit()
        return org, dashboard, api_key

    def test_404s_a_token_minted_in_another_org(self):
        _, _, api_key = self.create_shared_dashboard_in_another_org()

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "not_found")
        self.assertIsNone(event["object_id"])

    def test_records_the_refusal_against_the_org_that_owns_the_key(self):
        org, _, api_key = self.create_shared_dashboard_in_another_org()

        _, event = self.read(api_key.api_key)

        self.assertEqual(event["org_id"], org.id)
        self.assertNotEqual(event["org_id"], self.factory.org.id)

    def test_another_orgs_settings_cannot_re_enable_a_disabled_link(self):
        org, _, api_key = self.create_shared_dashboard_in_another_org()
        org.set_setting("disable_public_urls", True)
        db.session.commit()

        res, _ = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)

    def test_404s_a_key_whose_org_disagrees_with_its_dashboard(self):
        # Nothing ties api_keys.org_id to the org of the object it points at.
        # The dashboard is readable under this route and the key is not, and
        # the key is the credential, so the answer is the same 404.
        other_org = self.factory.create_org()
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard, org=other_org)
        db.session.commit()

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "not_found")
        self.assertEqual(event["org_id"], other_org.id)

    def test_still_serves_the_token_under_the_org_that_minted_it(self):
        org, dashboard, api_key = self.create_shared_dashboard_in_another_org()

        with patch("redash.handlers.base.record_event_task"):
            res = self.make_request(
                "get",
                "/api/dashboards/public/{}".format(api_key.api_key),
                org=org,
                user=False,
                is_json=False,
            )

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["name"], dashboard.name)


class TestPublicDashboardAfterTheObjectIsRemoved(BaseTestCase):
    def read(self, token):
        with patch("redash.handlers.base.record_event_task") as task:
            res = self.make_request(
                "get",
                "/api/dashboards/public/{}".format(token),
                user=False,
                is_json=False,
            )
        return res, task.delay.call_args[0][0]

    def test_archiving_a_dashboard_revokes_its_public_link(self):
        # Archiving is what the product's delete button does. Leaving the token
        # live keeps a dashboard the owner believes is gone readable by anyone
        # holding the link.
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()

        shared = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))
        token = shared.json["api_key"]

        archived = self.make_request("delete", "/api/dashboards/{}".format(dashboard.id))
        self.assertEqual(archived.status_code, 200)

        res, _ = self.read(token)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(0, ApiKey.query.filter_by(api_key=token, active=True).count())

    def test_404s_a_token_left_behind_by_a_deleted_dashboard(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard)
        db.session.commit()

        db.session.delete(dashboard)
        db.session.commit()

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "not_found")
        self.assertIsNone(event["object_id"])

    def test_archiving_through_the_generic_update_path_revokes_the_link(self):
        # DashboardResource.post lists is_archived among the fields it copies
        # straight onto the model, so the delete endpoint is not the only way
        # to archive. A revoke that lives only in that endpoint is a revoke
        # this request walks past.
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()

        shared = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))
        token = shared.json["api_key"]

        archived = self.make_request(
            "post",
            "/api/dashboards/{}".format(dashboard.id),
            data={"is_archived": True},
        )
        self.assertEqual(archived.status_code, 200)

        res, _ = self.read(token)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(0, ApiKey.query.filter_by(api_key=token, active=True).count())

    def test_refuses_to_mint_a_link_for_an_already_archived_dashboard(self):
        # Nothing about archiving stops the share endpoint loading the object,
        # so without a check here a deleted dashboard can be published after
        # the fact and the token resolves against a live row.
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard(is_archived=True)
        db.session.commit()

        res = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))

        self.assertEqual(res.status_code, 404)
        self.assertEqual(0, ApiKey.all_active_for_object(dashboard).count())

    def test_404s_a_live_token_whose_dashboard_was_archived_behind_it(self):
        # The read side has to fail closed on its own, not only because some
        # write path remembered to revoke. This is the token that a mint racing
        # an archive leaves behind.
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard)
        db.session.commit()

        db.session.execute(
            "UPDATE dashboards SET is_archived = true WHERE id = :id",
            {"id": dashboard.id},
        )
        db.session.commit()

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "not_found")
        self.assertTrue(ApiKey.query.filter_by(api_key=api_key.api_key, active=True).count() == 1)

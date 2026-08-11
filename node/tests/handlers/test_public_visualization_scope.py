from unittest.mock import patch

from redash import models
from tests import BaseTestCase


class TestPublicVisualizationAfterTheObjectIsRemoved(BaseTestCase):
    def read(self, token):
        with patch("redash.handlers.base.record_event_task") as task:
            res = self.make_request(
                "get",
                "/api/visualizations/public/{}".format(token),
                user=False,
                is_json=False,
            )
        return res, task.delay.call_args[0][0]

    def test_deleting_a_shared_visualization_revokes_its_token(self):
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        models.db.session.commit()

        shared = self.make_request("post", "/api/visualizations/{}/share".format(vis.id))
        token = shared.json["api_key"]

        deleted = self.make_request("delete", "/api/visualizations/{}".format(vis.id))
        self.assertEqual(deleted.status_code, 200)

        res, event = self.read(token)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "not_found")
        self.assertEqual(0, models.ApiKey.query.filter_by(api_key=token, active=True).count())

    def test_archiving_the_parent_query_revokes_the_embed_token(self):
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        models.db.session.commit()

        shared = self.make_request("post", "/api/visualizations/{}/share".format(vis.id))
        token = shared.json["api_key"]

        archived = self.make_request("delete", "/api/queries/{}".format(vis.query_rel.id))
        self.assertEqual(archived.status_code, 200)

        res, _ = self.read(token)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(0, models.ApiKey.query.filter_by(api_key=token, active=True).count())

    def test_archiving_the_parent_query_through_the_generic_update_path_revokes_it(self):
        # QueryResource.post drops a blocklist of fields and copies the rest
        # onto the model, and is_archived is not on that blocklist. Query.archive
        # is therefore not the only way a query gets archived.
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        models.db.session.commit()

        shared = self.make_request("post", "/api/visualizations/{}/share".format(vis.id))
        token = shared.json["api_key"]

        archived = self.make_request(
            "post",
            "/api/queries/{}".format(vis.query_rel.id),
            data={"is_archived": True},
        )
        self.assertEqual(archived.status_code, 200)

        res, _ = self.read(token)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(0, models.ApiKey.query.filter_by(api_key=token, active=True).count())

    def test_refuses_to_mint_an_embed_token_on_an_archived_query(self):
        self.factory.grant_permission("publish_visualization")
        query = self.factory.create_query(is_archived=True)
        vis = self.factory.create_visualization(query_rel=query)
        models.db.session.commit()

        res = self.make_request("post", "/api/visualizations/{}/share".format(vis.id))

        self.assertEqual(res.status_code, 404)
        self.assertEqual(0, models.ApiKey.all_active_for_object(vis).count())

    def test_404s_a_live_token_whose_query_was_archived_behind_it(self):
        # The read side has to fail closed on its own rather than trusting that
        # some write path revoked, because a mint racing an archive is exactly
        # the case where none did.
        vis = self.factory.create_visualization()
        api_key = self.factory.create_api_key(object=vis)
        models.db.session.commit()

        models.db.session.execute(
            "UPDATE queries SET is_archived = true WHERE id = :id",
            {"id": vis.query_id},
        )
        models.db.session.commit()

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "not_found")


class TestPublicVisualizationAcrossOrgs(BaseTestCase):
    def read(self, token):
        """Redeem the token under the default org, whatever org minted it.

        The org is the slug in the route, which the reader chooses, so this is
        every bit of the attack: mint where you may, redeem where it suits you.
        """
        with patch("redash.handlers.base.record_event_task") as task:
            res = self.make_request(
                "get",
                "/api/visualizations/public/{}".format(token),
                user=False,
                is_json=False,
            )
        return res, task.delay.call_args[0][0]

    def create_shared_visualization_in_another_org(self):
        org = self.factory.create_org()
        user = self.factory.create_user(org=org)
        data_source = self.factory.create_data_source(group=org.default_group)
        query = self.factory.create_query(org=org, user=user, data_source=data_source)
        vis = self.factory.create_visualization(query_rel=query)
        api_key = self.factory.create_api_key(object=vis, org=org)
        models.db.session.commit()
        return org, vis, api_key

    def test_404s_a_token_minted_in_another_org(self):
        _, _, api_key = self.create_shared_visualization_in_another_org()

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "not_found")
        self.assertIsNone(event["object_id"])

    def test_records_the_refusal_against_the_org_that_owns_the_key(self):
        org, _, api_key = self.create_shared_visualization_in_another_org()

        _, event = self.read(api_key.api_key)

        self.assertEqual(event["org_id"], org.id)
        self.assertNotEqual(event["org_id"], self.factory.org.id)

    def test_another_orgs_settings_cannot_re_enable_a_disabled_link(self):
        org, _, api_key = self.create_shared_visualization_in_another_org()
        org.set_setting("disable_public_urls", True)
        models.db.session.commit()

        res, _ = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)

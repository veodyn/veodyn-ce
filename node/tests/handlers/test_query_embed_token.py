"""Reading an existing embed token back through the query resource.

Lives beside the share tests rather than in them because the endpoint under
test is QueryResource.get: the token is attached there, in the handler, and not
by serialize_visualization. It is a credential, so whoever can read it can hand
out anonymous access to the result, and only the people who could mint or
revoke it may see it.
"""

from redash import models
from tests import BaseTestCase


class TestQueryResourceExposesTheEmbedToken(BaseTestCase):
    def share(self, vis):
        api_key = models.ApiKey.create_for_object(vis, self.factory.user)
        models.db.session.commit()
        return api_key

    def visualizations(self, res):
        return {v["id"]: v for v in res.json["visualizations"]}

    def test_owner_sees_the_token(self):
        vis = self.factory.create_visualization()
        api_key = self.share(vis)

        res = self.make_request("get", "/api/queries/{}".format(vis.query_rel.id))

        self.assertEqual(res.status_code, 200)
        self.assertEqual(api_key.api_key, self.visualizations(res)[vis.id]["api_key"])

    def test_admin_sees_the_token(self):
        vis = self.factory.create_visualization()
        api_key = self.share(vis)
        admin = self.factory.create_admin()

        res = self.make_request("get", "/api/queries/{}".format(vis.query_rel.id), user=admin)

        self.assertEqual(res.status_code, 200)
        self.assertEqual(api_key.api_key, self.visualizations(res)[vis.id]["api_key"])

    def test_a_user_who_can_only_view_does_not_see_the_token(self):
        vis = self.factory.create_visualization()
        self.share(vis)
        viewer = self.factory.create_user()

        res = self.make_request("get", "/api/queries/{}".format(vis.query_rel.id), user=viewer)

        self.assertEqual(res.status_code, 200)
        self.assertNotIn("api_key", self.visualizations(res)[vis.id])

    def test_an_unshared_visualization_carries_no_token_field(self):
        vis = self.factory.create_visualization()
        models.db.session.commit()

        res = self.make_request("get", "/api/queries/{}".format(vis.query_rel.id))

        self.assertNotIn("api_key", self.visualizations(res)[vis.id])

    def test_a_revoked_token_stops_being_offered(self):
        vis = self.factory.create_visualization()
        api_key = self.share(vis)
        api_key.active = False
        models.db.session.commit()

        res = self.make_request("get", "/api/queries/{}".format(vis.query_rel.id))

        self.assertNotIn("api_key", self.visualizations(res)[vis.id])

import datetime
import hashlib
from unittest.mock import patch

from redash import models
from redash.utils import json_dumps, utcnow
from tests import BaseTestCase


class TestVisualizationShareResourcePost(BaseTestCase):
    def test_refuses_owner_without_publish_permission(self):
        vis = self.factory.create_visualization()
        models.db.session.commit()

        res = self.make_request("post", "/api/visualizations/{}/share".format(vis.id))
        self.assertEqual(res.status_code, 403)
        self.assertIsNone(models.ApiKey.get_by_object(vis))

    def test_creates_api_key(self):
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        models.db.session.commit()

        res = self.make_request("post", "/api/visualizations/{}/share".format(vis.id))

        self.assertEqual(res.status_code, 200)
        api_key = models.ApiKey.get_by_object(vis)
        self.assertIsNotNone(api_key)
        self.assertEqual(res.json["api_key"], api_key.api_key)
        self.assertIsNone(res.json["expires_at"])

    def test_allows_admin_without_the_product_permission(self):
        vis = self.factory.create_visualization()
        admin = self.factory.create_admin()
        models.db.session.commit()

        res = self.make_request("post", "/api/visualizations/{}/share".format(vis.id), user=admin)
        self.assertEqual(res.status_code, 200)

    def test_requires_admin_or_owner_of_the_parent_query(self):
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        other_user = self.factory.create_user()
        models.db.session.commit()

        res = self.make_request("post", "/api/visualizations/{}/share".format(vis.id), user=other_user)
        self.assertEqual(res.status_code, 403)

    def test_refuses_when_public_urls_are_disabled(self):
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        self.factory.org.set_setting("disable_public_urls", True)
        models.db.session.commit()

        res = self.make_request("post", "/api/visualizations/{}/share".format(vis.id))
        self.assertEqual(res.status_code, 400)
        self.assertIsNone(models.ApiKey.get_by_object(vis))

    def test_stores_expires_at(self):
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        models.db.session.commit()
        expires_at = utcnow() + datetime.timedelta(days=3)

        res = self.make_request(
            "post",
            "/api/visualizations/{}/share".format(vis.id),
            data={"expires_at": expires_at.isoformat()},
        )

        self.assertEqual(res.status_code, 200)
        self.assertEqual(models.ApiKey.get_by_object(vis).expires_at, expires_at)

    def test_refuses_expires_at_in_the_past(self):
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        models.db.session.commit()

        res = self.make_request(
            "post",
            "/api/visualizations/{}/share".format(vis.id),
            data={"expires_at": (utcnow() - datetime.timedelta(days=1)).isoformat()},
        )

        self.assertEqual(res.status_code, 400)
        self.assertIsNone(models.ApiKey.get_by_object(vis))

    def test_sharing_twice_returns_the_same_token_and_leaves_one_key(self):
        # The default path for embeds, not an edge case: nothing the dialog
        # reads carried the token until the query is refetched, so a second
        # click is what a user does. Every extra key it minted would have been
        # a live external link revocation could not reach.
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        models.db.session.commit()

        first = self.make_request("post", "/api/visualizations/{}/share".format(vis.id))
        second = self.make_request("post", "/api/visualizations/{}/share".format(vis.id))

        self.assertEqual(first.json["api_key"], second.json["api_key"])
        self.assertEqual(1, models.ApiKey.all_active_for_object(vis).count())

    def test_sharing_again_restates_the_expiry_of_the_same_token(self):
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        models.db.session.commit()
        expires_at = utcnow() + datetime.timedelta(days=3)

        first = self.make_request("post", "/api/visualizations/{}/share".format(vis.id))
        second = self.make_request(
            "post",
            "/api/visualizations/{}/share".format(vis.id),
            data={"expires_at": expires_at.isoformat()},
        )

        self.assertEqual(first.json["api_key"], second.json["api_key"])
        self.assertEqual(expires_at, models.ApiKey.get_by_object(vis).expires_at)
        self.assertEqual(1, models.ApiKey.all_active_for_object(vis).count())

    def test_sharing_without_an_expiry_clears_the_one_it_had(self):
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        models.db.session.commit()

        self.make_request(
            "post",
            "/api/visualizations/{}/share".format(vis.id),
            data={"expires_at": (utcnow() + datetime.timedelta(days=3)).isoformat()},
        )
        self.make_request("post", "/api/visualizations/{}/share".format(vis.id))

        self.assertIsNone(models.ApiKey.get_by_object(vis).expires_at)


class TestVisualizationShareResourceDelete(BaseTestCase):
    def test_refuses_owner_without_publish_permission(self):
        vis = self.factory.create_visualization()
        models.ApiKey.create_for_object(vis, self.factory.user)
        models.db.session.commit()

        res = self.make_request("delete", "/api/visualizations/{}/share".format(vis.id))
        self.assertEqual(res.status_code, 403)
        self.assertIsNotNone(models.ApiKey.get_by_object(vis))

    def test_disables_api_key(self):
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        models.ApiKey.create_for_object(vis, self.factory.user)
        models.db.session.commit()

        res = self.make_request("delete", "/api/visualizations/{}/share".format(vis.id))
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(models.ApiKey.get_by_object(vis))

    def test_leaves_no_active_key_behind(self):
        # A visualization can only carry one active key now, because the
        # database refuses a second one. The pair a pre-migration database can
        # still be holding is covered where deactivate_for_object lives, in
        # tests/models/test_api_keys.py.
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        stale = self.factory.create_api_key(object=vis, active=False)
        live = self.factory.create_api_key(object=vis)
        models.db.session.commit()

        res = self.make_request("delete", "/api/visualizations/{}/share".format(vis.id))

        self.assertEqual(res.status_code, 200)
        self.assertFalse(stale.active)
        self.assertFalse(live.active)
        self.assertEqual(0, models.ApiKey.all_active_for_object(vis).count())

    def test_ignores_when_no_api_key_exists(self):
        self.factory.grant_permission("publish_visualization")
        vis = self.factory.create_visualization()
        models.db.session.commit()

        res = self.make_request("delete", "/api/visualizations/{}/share".format(vis.id))
        self.assertEqual(res.status_code, 200)


class TestPublicVisualizationResource(BaseTestCase):
    def create_shared_visualization(self, **kwargs):
        vis = self.factory.create_visualization()
        vis.query_rel.latest_query_data = self.factory.create_query_result()
        models.db.session.add(vis.query_rel)
        api_key = self.factory.create_api_key(object=vis, **kwargs)
        models.db.session.commit()
        return vis, api_key

    def read(self, token):
        with patch("redash.handlers.base.record_event_task") as task:
            res = self.make_request(
                "get",
                "/api/visualizations/public/{}".format(token),
                user=False,
                is_json=False,
            )
        return res, task.delay.call_args[0][0]

    def test_serves_a_valid_token(self):
        vis, api_key = self.create_shared_visualization()

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["name"], vis.name)
        self.assertEqual(res.json["type"], vis.type)
        self.assertEqual(res.json["query"]["id"], vis.query_rel.id)
        self.assertIsNotNone(res.json["query_result"])
        self.assertEqual(event["outcome"], "ok")
        self.assertEqual(event["object_id"], vis.id)
        self.assertEqual(event["object_type"], "visualization")

    def test_hides_fields_an_anonymous_reader_must_not_see(self):
        _, api_key = self.create_shared_visualization()

        res, _ = self.read(api_key.api_key)

        self.assertNotIn("id", res.json)
        self.assertNotIn("user", res.json)
        self.assertNotIn("query_text", res.json["query"])
        self.assertNotIn("api_key", res.json["query"])
        self.assertEqual(set(res.json["query_result"].keys()), {"data", "retrieved_at"})

    def test_fingerprints_the_token_instead_of_storing_it(self):
        _, api_key = self.create_shared_visualization()

        _, event = self.read(api_key.api_key)

        expected = hashlib.sha256(api_key.api_key.encode("utf-8")).hexdigest()
        self.assertEqual(event["token_fingerprint"], expected)
        self.assertNotIn(api_key.api_key, json_dumps(event))

    def test_404s_and_records_a_revoked_token(self):
        vis, api_key = self.create_shared_visualization(active=False)

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "revoked")
        self.assertEqual(event["object_id"], vis.id)

    def test_404s_and_records_an_expired_token(self):
        vis, api_key = self.create_shared_visualization(expires_at=utcnow() - datetime.timedelta(seconds=1))

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "expired")
        self.assertEqual(event["object_id"], vis.id)

    def test_404s_and_records_an_unknown_token(self):
        res, event = self.read("no-such-token")

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "not_found")
        self.assertIsNone(event["object_id"])

    def test_404s_and_records_a_dashboard_token(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard)
        models.db.session.commit()

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "not_found")

    def test_404s_and_records_when_public_urls_are_disabled(self):
        vis, api_key = self.create_shared_visualization()
        self.factory.org.set_setting("disable_public_urls", True)
        models.db.session.commit()

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "disabled")
        self.assertEqual(event["object_id"], vis.id)

    def test_404s_a_token_left_behind_by_a_deleted_visualization(self):
        # The generic foreign key has no cascade, so the row is deleted out
        # from under the key. Resolving that as ok would hand the serializer
        # nothing and answer 500, which is both an error page where every other
        # refusal is a 404 and a signal that the token was real.
        vis, api_key = self.create_shared_visualization()
        models.db.session.delete(vis)
        models.db.session.commit()

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "not_found")
        self.assertIsNone(event["object_id"])


class TestQueryReadBackOfShareToken(BaseTestCase):
    """QueryResource.get attaches each visualization's live share token, and
    only for a caller who could mint or revoke it (an admin, or the parent
    query's owner). The embed dialog reads the token back from there; while
    nothing served it, every open offered Create, and the idempotent re-share
    cleared whatever expiry the link carried."""

    def test_the_owner_reads_the_token_back(self):
        vis = self.factory.create_visualization()
        api_key = self.factory.create_api_key(object=vis)
        models.db.session.commit()

        res = self.make_request("get", "/api/queries/{}".format(vis.query_rel.id))

        self.assertEqual(res.status_code, 200)
        serialized = [v for v in res.json["visualizations"] if v["id"] == vis.id]
        self.assertEqual(serialized[0]["api_key"], api_key.api_key)

    def test_a_viewer_who_is_not_the_owner_gets_no_token(self):
        vis = self.factory.create_visualization()
        self.factory.create_api_key(object=vis)
        other = self.factory.create_user()
        models.db.session.commit()

        res = self.make_request("get", "/api/queries/{}".format(vis.query_rel.id), user=other)

        self.assertEqual(res.status_code, 200)
        for serialized in res.json["visualizations"]:
            self.assertNotIn("api_key", serialized)

    def test_an_unshared_visualization_carries_no_token_even_for_the_owner(self):
        vis = self.factory.create_visualization()
        models.db.session.commit()

        res = self.make_request("get", "/api/queries/{}".format(vis.query_rel.id))

        self.assertEqual(res.status_code, 200)
        for serialized in res.json["visualizations"]:
            self.assertNotIn("api_key", serialized)

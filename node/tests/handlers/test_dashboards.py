import datetime
import hashlib
from unittest.mock import patch

from redash.models import AccessPermission, ApiKey, Dashboard, db
from redash.permissions import ACCESS_TYPE_MODIFY
from redash.serializers import serialize_dashboard
from redash.utils import json_dumps, json_loads, utcnow
from tests import BaseTestCase


class TestDashboardListResource(BaseTestCase):
    def test_create_new_dashboard(self):
        dashboard_name = "Test Dashboard"
        rv = self.make_request("post", "/api/dashboards", data={"name": dashboard_name})
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(rv.json["name"], "Test Dashboard")
        self.assertEqual(rv.json["user_id"], self.factory.user.id)
        self.assertEqual(rv.json["layout"], [])


class TestDashboardListGetResource(BaseTestCase):
    def test_returns_dashboards(self):
        d1 = self.factory.create_dashboard()
        d2 = self.factory.create_dashboard()
        d3 = self.factory.create_dashboard()

        rv = self.make_request("get", "/api/dashboards")

        assert len(rv.json["results"]) == 3
        assert set([result["id"] for result in rv.json["results"]]) == set([d1.id, d2.id, d3.id])

    def test_filters_with_tags(self):
        d1 = self.factory.create_dashboard(tags=["test"])
        self.factory.create_dashboard()
        self.factory.create_dashboard()

        rv = self.make_request("get", "/api/dashboards?tags=test")
        assert len(rv.json["results"]) == 1
        assert set([result["id"] for result in rv.json["results"]]) == set([d1.id])

    def test_search_term(self):
        d1 = self.factory.create_dashboard(name="Sales")
        d2 = self.factory.create_dashboard(name="Q1 sales")
        self.factory.create_dashboard(name="Ops")

        rv = self.make_request("get", "/api/dashboards?q=sales")
        assert len(rv.json["results"]) == 2
        assert set([result["id"] for result in rv.json["results"]]) == set([d1.id, d2.id])


class TestDashboardArchiveResourceGet(BaseTestCase):
    def visible_query(self):
        """A query on a data source the requesting user's group can read.

        Dashboard.all only admits a dashboard someone else owns when one of its
        widgets points at a data source the caller's groups have, so a dashboard
        needs a widget built on this to be visible to anyone but its author.
        """
        data_source = self.factory.create_data_source(group=self.factory.default_group)
        return self.factory.create_query(data_source=data_source)

    def test_archiving_removes_a_dashboard_from_the_listing(self):
        live = self.factory.create_dashboard()
        archived = self.factory.create_dashboard()

        rv = self.make_request("delete", "/api/dashboards/{0}".format(archived.id))
        self.assertEqual(rv.status_code, 200)

        rv = self.make_request("get", "/api/dashboards")
        self.assertEqual(rv.status_code, 200)
        ids = [result["id"] for result in rv.json["results"]]
        self.assertIn(live.id, ids)
        self.assertNotIn(archived.id, ids)

    def test_returns_the_archived_dashboard_and_only_it(self):
        live = self.factory.create_dashboard()
        archived = self.factory.create_dashboard()

        self.make_request("delete", "/api/dashboards/{0}".format(archived.id))

        rv = self.make_request("get", "/api/dashboards/archive")
        self.assertEqual(rv.status_code, 200)
        ids = [result["id"] for result in rv.json["results"]]
        self.assertIn(archived.id, ids)
        self.assertNotIn(live.id, ids)

    def test_hides_an_archived_dashboard_on_an_inaccessible_data_source(self):
        other_user = self.factory.create_user()

        restricted = self.factory.create_data_source(group=self.factory.create_group())
        restricted_vis = self.factory.create_visualization(query_rel=self.factory.create_query(data_source=restricted))
        hidden = self.factory.create_dashboard(user=other_user, is_archived=True)
        self.factory.create_widget(visualization=restricted_vis, dashboard=hidden)

        shared_vis = self.factory.create_visualization(query_rel=self.visible_query())
        shown = self.factory.create_dashboard(user=other_user, is_archived=True)
        self.factory.create_widget(visualization=shared_vis, dashboard=shown)

        rv = self.make_request("get", "/api/dashboards/archive")
        self.assertEqual(rv.status_code, 200)
        ids = [result["id"] for result in rv.json["results"]]
        self.assertIn(shown.id, ids)
        self.assertNotIn(hidden.id, ids)

    def test_hides_an_archived_draft_belonging_to_someone_else(self):
        other_user = self.factory.create_user()

        vis = self.factory.create_visualization(query_rel=self.visible_query())
        their_draft = self.factory.create_dashboard(user=other_user, is_archived=True, is_draft=True)
        self.factory.create_widget(visualization=vis, dashboard=their_draft)

        own_draft = self.factory.create_dashboard(is_archived=True, is_draft=True)

        rv = self.make_request("get", "/api/dashboards/archive")
        self.assertEqual(rv.status_code, 200)
        ids = [result["id"] for result in rv.json["results"]]
        self.assertIn(own_draft.id, ids)
        self.assertNotIn(their_draft.id, ids)


class TestDashboardResourceGet(BaseTestCase):
    def test_get_dashboard(self):
        d1 = self.factory.create_dashboard()
        rv = self.make_request("get", "/api/dashboards/{0}".format(d1.id))
        self.assertEqual(rv.status_code, 200)

        expected = serialize_dashboard(d1, with_widgets=True, with_favorite_state=False)
        actual = json_loads(rv.data)

        self.assertResponseEqual(expected, actual)

    def test_get_dashboard_with_slug(self):
        d1 = self.factory.create_dashboard()
        rv = self.make_request("get", "/api/dashboards/{0}?legacy".format(d1.slug))
        self.assertEqual(rv.status_code, 200)

        expected = serialize_dashboard(d1, with_widgets=True, with_favorite_state=False)
        actual = json_loads(rv.data)

        self.assertResponseEqual(expected, actual)

    def test_get_dashboard_filters_unauthorized_widgets(self):
        dashboard = self.factory.create_dashboard()

        restricted_ds = self.factory.create_data_source(group=self.factory.create_group())
        query = self.factory.create_query(data_source=restricted_ds)
        vis = self.factory.create_visualization(query_rel=query)
        restricted_widget = self.factory.create_widget(visualization=vis, dashboard=dashboard)
        widget = self.factory.create_widget(dashboard=dashboard)
        dashboard.layout = [[widget.id, restricted_widget.id]]
        db.session.commit()

        rv = self.make_request("get", "/api/dashboards/{0}".format(dashboard.id))
        self.assertEqual(rv.status_code, 200)
        self.assertTrue(rv.json["widgets"][0]["restricted"])
        self.assertNotIn("restricted", rv.json["widgets"][1])

    def test_get_non_existing_dashboard(self):
        rv = self.make_request("get", "/api/dashboards/-1")
        self.assertEqual(rv.status_code, 404)


class TestDashboardResourcePost(BaseTestCase):
    def test_update_dashboard(self):
        d = self.factory.create_dashboard()
        new_name = "New Name"
        rv = self.make_request(
            "post",
            "/api/dashboards/{0}".format(d.id),
            data={"name": new_name, "layout": []},
        )
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(rv.json["name"], new_name)

    def test_raises_error_in_case_of_conflict(self):
        d = self.factory.create_dashboard()
        d.name = "Updated"
        db.session.commit()
        new_name = "New Name"
        rv = self.make_request(
            "post",
            "/api/dashboards/{0}".format(d.id),
            data={"name": new_name, "layout": [], "version": d.version - 1},
        )

        self.assertEqual(rv.status_code, 409)

    def test_overrides_existing_if_no_version_specified(self):
        d = self.factory.create_dashboard()
        d.name = "Updated"

        new_name = "New Name"
        rv = self.make_request(
            "post",
            "/api/dashboards/{0}".format(d.id),
            data={"name": new_name, "layout": []},
        )

        self.assertEqual(rv.status_code, 200)

    def test_works_for_non_owner_with_permission(self):
        d = self.factory.create_dashboard()
        user = self.factory.create_user()

        new_name = "New Name"
        rv = self.make_request(
            "post",
            "/api/dashboards/{0}".format(d.id),
            data={"name": new_name, "layout": [], "version": d.version},
            user=user,
        )
        self.assertEqual(rv.status_code, 403)

        AccessPermission.grant(obj=d, access_type=ACCESS_TYPE_MODIFY, grantee=user, grantor=d.user)

        rv = self.make_request(
            "post",
            "/api/dashboards/{0}".format(d.id),
            data={"name": new_name, "layout": [], "version": d.version},
            user=user,
        )

        self.assertEqual(rv.status_code, 200)
        self.assertEqual(rv.json["name"], new_name)


class TestDashboardForkResourcePost(BaseTestCase):
    def test_forks_a_dashboard(self):
        dashboard = self.factory.create_dashboard()

        rv = self.make_request("post", "/api/dashboards/{}/fork".format(dashboard.id))

        self.assertEqual(rv.status_code, 200)


class TestDashboardResourceDelete(BaseTestCase):
    def test_delete_dashboard(self):
        d = self.factory.create_dashboard()

        rv = self.make_request("delete", "/api/dashboards/{0}".format(d.id))
        self.assertEqual(rv.status_code, 200)

        d = Dashboard.get_by_id_and_org(d.id, d.org)
        self.assertTrue(d.is_archived)


class TestDashboardShareResourcePost(BaseTestCase):
    def test_refuses_owner_without_publish_permission(self):
        dashboard = self.factory.create_dashboard()

        res = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))
        self.assertEqual(res.status_code, 403)
        self.assertIsNone(ApiKey.get_by_object(dashboard))

    def test_creates_api_key(self):
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()

        res = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["api_key"], ApiKey.get_by_object(dashboard).api_key)
        self.assertIsNone(res.json["expires_at"])

    def test_allows_admin_without_the_product_permission(self):
        dashboard = self.factory.create_dashboard()
        admin = self.factory.create_admin()

        res = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id), user=admin)
        self.assertEqual(res.status_code, 200)

    def test_requires_admin_or_owner(self):
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()
        user = self.factory.create_user()

        res = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id), user=user)
        self.assertEqual(res.status_code, 403)

        user.group_ids.append(self.factory.org.admin_group.id)

        res = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id), user=user)
        self.assertEqual(res.status_code, 200)

    def test_refuses_when_public_urls_are_disabled(self):
        self.factory.grant_permission("publish_dashboard")
        self.factory.org.set_setting("disable_public_urls", True)
        db.session.commit()
        dashboard = self.factory.create_dashboard()

        res = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))
        self.assertEqual(res.status_code, 400)
        self.assertIsNone(ApiKey.get_by_object(dashboard))

    def test_stores_expires_at(self):
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()
        expires_at = utcnow() + datetime.timedelta(days=7)

        res = self.make_request(
            "post",
            "/api/dashboards/{}/share".format(dashboard.id),
            data={"expires_at": expires_at.isoformat()},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(ApiKey.get_by_object(dashboard).expires_at, expires_at)

    def test_refuses_expires_at_in_the_past(self):
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()

        res = self.make_request(
            "post",
            "/api/dashboards/{}/share".format(dashboard.id),
            data={"expires_at": (utcnow() - datetime.timedelta(days=1)).isoformat()},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIsNone(ApiKey.get_by_object(dashboard))

    def test_sharing_twice_returns_the_same_token_and_leaves_one_key(self):
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()

        first = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))
        second = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))

        self.assertEqual(first.json["api_key"], second.json["api_key"])
        self.assertEqual(1, ApiKey.all_active_for_object(dashboard).count())

    def test_sharing_again_restates_the_expiry_of_the_same_token(self):
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()
        expires_at = utcnow() + datetime.timedelta(days=7)

        first = self.make_request("post", "/api/dashboards/{}/share".format(dashboard.id))
        second = self.make_request(
            "post",
            "/api/dashboards/{}/share".format(dashboard.id),
            data={"expires_at": expires_at.isoformat()},
        )

        self.assertEqual(first.json["api_key"], second.json["api_key"])
        self.assertEqual(expires_at, ApiKey.get_by_object(dashboard).expires_at)
        self.assertEqual(1, ApiKey.all_active_for_object(dashboard).count())


class TestDashboardShareResourceDelete(BaseTestCase):
    def test_refuses_owner_without_publish_permission(self):
        dashboard = self.factory.create_dashboard()
        ApiKey.create_for_object(dashboard, self.factory.user)
        db.session.commit()

        res = self.make_request("delete", "/api/dashboards/{}/share".format(dashboard.id))
        self.assertEqual(res.status_code, 403)
        self.assertIsNotNone(ApiKey.get_by_object(dashboard))

    def test_disables_api_key(self):
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()
        ApiKey.create_for_object(dashboard, self.factory.user)

        res = self.make_request("delete", "/api/dashboards/{}/share".format(dashboard.id))
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(ApiKey.get_by_object(dashboard))

    def test_leaves_no_active_key_behind(self):
        # Two live keys was a state the old minting path could produce, and
        # revoking only the first left the second working with nothing in the
        # product able to reach it. The database refuses the pair now, so the
        # legacy case is covered where deactivate_for_object lives, in
        # tests/models/test_api_keys.py.
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()
        stale = self.factory.create_api_key(object=dashboard, active=False)
        live = self.factory.create_api_key(object=dashboard)

        res = self.make_request("delete", "/api/dashboards/{}/share".format(dashboard.id))

        self.assertEqual(res.status_code, 200)
        self.assertFalse(stale.active)
        self.assertFalse(live.active)
        self.assertEqual(0, ApiKey.all_active_for_object(dashboard).count())

    def test_ignores_when_no_api_key_exists(self):
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()

        res = self.make_request("delete", "/api/dashboards/{}/share".format(dashboard.id))
        self.assertEqual(res.status_code, 200)

    def test_requires_admin_or_owner(self):
        self.factory.grant_permission("publish_dashboard")
        dashboard = self.factory.create_dashboard()
        user = self.factory.create_user()

        res = self.make_request("delete", "/api/dashboards/{}/share".format(dashboard.id), user=user)
        self.assertEqual(res.status_code, 403)

        user.group_ids.append(self.factory.org.admin_group.id)

        res = self.make_request("delete", "/api/dashboards/{}/share".format(dashboard.id), user=user)
        self.assertEqual(res.status_code, 200)


class TestPublicDashboardResourceRecordsReads(BaseTestCase):
    def read(self, token):
        with patch("redash.handlers.base.record_event_task") as task:
            res = self.make_request(
                "get",
                "/api/dashboards/public/{}".format(token),
                user=False,
                is_json=False,
            )
        return res, task.delay.call_args[0][0]

    def test_records_a_successful_read(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard)

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 200)
        self.assertEqual(event["action"], "view")
        self.assertEqual(event["object_type"], "dashboard")
        self.assertEqual(event["object_id"], dashboard.id)
        self.assertEqual(event["outcome"], "ok")
        self.assertTrue(event["public"])

    def test_fingerprints_the_token_instead_of_storing_it(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard)

        _, event = self.read(api_key.api_key)

        expected = hashlib.sha256(api_key.api_key.encode("utf-8")).hexdigest()
        self.assertEqual(event["token_fingerprint"], expected)
        self.assertNotIn(api_key.api_key, json_dumps(event))

    def test_records_a_revoked_read(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard, active=False)

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "revoked")
        self.assertEqual(event["object_id"], dashboard.id)

    def test_records_an_expired_read(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard, expires_at=utcnow() - datetime.timedelta(seconds=1))

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "expired")
        self.assertEqual(event["object_id"], dashboard.id)

    def test_records_an_unknown_token(self):
        res, event = self.read("no-such-token")

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "not_found")
        self.assertIsNone(event["object_id"])

    def test_records_a_read_refused_by_the_org_setting(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard)
        self.factory.org.set_setting("disable_public_urls", True)
        db.session.commit()

        res, event = self.read(api_key.api_key)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(event["outcome"], "disabled")
        self.assertEqual(event["object_id"], dashboard.id)

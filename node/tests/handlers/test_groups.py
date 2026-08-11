from unittest.mock import patch

from funcy import project

from redash.models import DataSource, Group, db
from tests import BaseTestCase


class TestGroupDataSourceListResource(BaseTestCase):
    def test_returns_only_groups_for_current_org(self):
        group = self.factory.create_group(org=self.factory.create_org())
        self.factory.create_data_source(group=group)
        db.session.flush()
        response = self.make_request(
            "get",
            "/api/groups/{}/data_sources".format(group.id),
            user=self.factory.create_admin(),
        )
        self.assertEqual(response.status_code, 404)

    def test_list(self):
        group = self.factory.create_group()
        ds = self.factory.create_data_source(group=group)
        db.session.flush()
        response = self.make_request(
            "get",
            "/api/groups/{}/data_sources".format(group.id),
            user=self.factory.create_admin(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json), 1)
        self.assertEqual(response.json[0]["id"], ds.id)


class TestGroupResourceList(BaseTestCase):
    def test_list_admin(self):
        self.factory.create_group(org=self.factory.create_org())
        response = self.make_request("get", "/api/groups", user=self.factory.create_admin())
        g_keys = ["type", "id", "name", "permissions"]

        def filtergroups(gs):
            return [project(g, g_keys) for g in gs]

        self.assertEqual(
            filtergroups(response.json),
            filtergroups(g.to_dict() for g in [self.factory.admin_group, self.factory.default_group]),
        )

    def test_list(self):
        group1 = self.factory.create_group(org=self.factory.create_org(), permissions=["view_dashboard"])
        db.session.flush()
        u = self.factory.create_user(group_ids=[self.factory.default_group.id, group1.id])
        db.session.flush()
        response = self.make_request("get", "/api/groups", user=u)
        g_keys = ["type", "id", "name", "permissions"]

        def filtergroups(gs):
            return [project(g, g_keys) for g in gs]

        self.assertEqual(
            filtergroups(response.json),
            filtergroups(g.to_dict() for g in [self.factory.default_group, group1]),
        )


class TestGroupResourcePost(BaseTestCase):
    def test_doesnt_change_builtin_groups(self):
        current_name = self.factory.default_group.name

        response = self.make_request(
            "post",
            "/api/groups/{}".format(self.factory.default_group.id),
            user=self.factory.create_admin(),
            data={"name": "Another Name"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(current_name, Group.query.get(self.factory.default_group.id).name)


class TestGroupResourcePostPermissions(BaseTestCase):
    def update(self, group, permissions, user=None):
        return self.make_request(
            "post",
            "/api/groups/{}".format(group.id),
            user=user if user is not None else self.factory.create_admin(),
            data={"name": group.name, "permissions": permissions},
        )

    def test_refuses_a_non_admin(self):
        group = self.factory.create_group(permissions=["view_query"])
        db.session.commit()

        response = self.update(group, ["admin"], user=self.factory.user)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Group.query.get(group.id).permissions, ["view_query"])

    def test_sets_the_permission_list(self):
        group = self.factory.create_group(permissions=["view_query"])
        db.session.commit()

        response = self.update(group, ["view_query", "list_dashboards", "publish_dashboard"])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["permissions"], ["view_query", "list_dashboards", "publish_dashboard"])
        self.assertEqual(
            Group.query.get(group.id).permissions,
            ["view_query", "list_dashboards", "publish_dashboard"],
        )

    def test_accepts_every_product_permission(self):
        group = self.factory.create_group(permissions=[])
        db.session.commit()
        product = ["publish_report", "publish_dashboard", "publish_visualization", "no_export_data"]

        response = self.update(group, product)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Group.query.get(group.id).permissions, product)

    def test_rejects_an_unknown_permission(self):
        group = self.factory.create_group(permissions=["view_query"])
        db.session.commit()

        response = self.update(group, ["view_query", "publish_dashboardz"])

        self.assertEqual(response.status_code, 400)
        self.assertIn("publish_dashboardz", response.json["message"])
        self.assertEqual(Group.query.get(group.id).permissions, ["view_query"])

    def test_keeps_a_permission_the_group_already_had(self):
        # A group can predate the catalog. Re-saving it must not 400, or the
        # admin client can never rename it again.
        group = self.factory.create_group(permissions=["view_dashboard"])
        db.session.commit()

        response = self.update(group, ["view_dashboard", "view_query"])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Group.query.get(group.id).permissions, ["view_dashboard", "view_query"])

    def test_leaves_permissions_alone_when_not_sent(self):
        group = self.factory.create_group(permissions=["view_query"])
        db.session.commit()

        response = self.make_request(
            "post",
            "/api/groups/{}".format(group.id),
            user=self.factory.create_admin(),
            data={"name": "Renamed"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Group.query.get(group.id).name, "Renamed")
        self.assertEqual(Group.query.get(group.id).permissions, ["view_query"])

    def test_sets_permissions_on_a_builtin_group(self):
        # Granting a product permission to everyone means granting it on the
        # builtin default group, so this is deliberately allowed while renaming
        # a builtin group stays refused.
        response = self.update(
            self.factory.default_group,
            self.factory.default_group.permissions + ["no_export_data"],
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("no_export_data", Group.query.get(self.factory.default_group.id).permissions)

    def test_refuses_to_strip_admin_from_the_builtin_admin_group(self):
        response = self.update(self.factory.admin_group, ["view_query"])

        self.assertEqual(response.status_code, 400)
        self.assertIn("admin", Group.query.get(self.factory.admin_group.id).permissions)

    def test_refuses_the_builtin_admin_group_even_when_another_group_has_admin(self):
        # The builtin admin group is the one Redash guarantees exists, so it is
        # refused on its own account and not only as the last admin standing.
        self.factory.create_group(permissions=["admin"])
        db.session.commit()

        response = self.update(self.factory.admin_group, ["view_query"])

        self.assertEqual(response.status_code, 400)
        self.assertIn("admin", Group.query.get(self.factory.admin_group.id).permissions)

    def test_refuses_to_strip_admin_from_the_only_group_that_has_it(self):
        # The builtin admin group normally guarantees a route to admin, and it
        # is guarded above. Take "admin" off it directly so the regular group
        # under test is genuinely the last one holding it.
        group = self.factory.create_group(permissions=["admin"])
        db.session.commit()
        admin = self.factory.create_user(group_ids=[group.id])
        self.factory.admin_group.permissions = ["super_admin"]
        db.session.add(self.factory.admin_group)
        db.session.commit()

        response = self.update(group, ["view_query"], user=admin)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Group.query.get(group.id).permissions, ["admin"])

    def test_allows_stripping_admin_while_another_group_still_has_it(self):
        group = self.factory.create_group(permissions=["admin"])
        db.session.commit()

        response = self.update(group, ["view_query"])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Group.query.get(group.id).permissions, ["view_query"])

    def test_records_the_change_with_both_permission_lists(self):
        group = self.factory.create_group(permissions=["view_query"])
        db.session.commit()

        with patch("redash.handlers.base.record_event_task") as task:
            response = self.update(group, ["view_query", "no_export_data"])

        self.assertEqual(response.status_code, 200)
        events = [call[0][0] for call in task.delay.call_args_list]
        changes = [e for e in events if e["action"] == "change_permissions"]
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["object_type"], "group")
        self.assertEqual(changes[0]["object_id"], group.id)
        self.assertEqual(changes[0]["previous_permissions"], ["view_query"])
        self.assertEqual(changes[0]["permissions"], ["view_query", "no_export_data"])

    def test_records_nothing_extra_when_the_permissions_are_unchanged(self):
        group = self.factory.create_group(permissions=["view_query"])
        db.session.commit()

        with patch("redash.handlers.base.record_event_task") as task:
            self.update(group, ["view_query"])

        events = [call[0][0] for call in task.delay.call_args_list]
        self.assertEqual([e for e in events if e["action"] == "change_permissions"], [])


class TestGroupResourceDelete(BaseTestCase):
    def test_allowed_only_to_admin(self):
        group = self.factory.create_group()

        response = self.make_request("delete", "/api/groups/{}".format(group.id))
        self.assertEqual(response.status_code, 403)

        response = self.make_request(
            "delete",
            "/api/groups/{}".format(group.id),
            user=self.factory.create_admin(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(Group.query.get(group.id))

    def test_cant_delete_builtin_group(self):
        for group in [self.factory.default_group, self.factory.admin_group]:
            response = self.make_request(
                "delete",
                "/api/groups/{}".format(group.id),
                user=self.factory.create_admin(),
            )
            self.assertEqual(response.status_code, 400)

    def test_can_delete_group_with_data_sources(self):
        group = self.factory.create_group()
        data_source = self.factory.create_data_source(group=group)

        response = self.make_request(
            "delete",
            "/api/groups/{}".format(group.id),
            user=self.factory.create_admin(),
        )

        self.assertEqual(response.status_code, 200)

        self.assertEqual(data_source, DataSource.query.get(data_source.id))


class TestGroupResourceGet(BaseTestCase):
    def test_returns_group(self):
        rv = self.make_request("get", "/api/groups/{}".format(self.factory.default_group.id))
        self.assertEqual(rv.status_code, 200)

    def test_doesnt_return_if_user_not_member_or_admin(self):
        rv = self.make_request("get", "/api/groups/{}".format(self.factory.admin_group.id))
        self.assertEqual(rv.status_code, 403)

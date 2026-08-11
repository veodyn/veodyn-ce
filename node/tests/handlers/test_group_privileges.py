"""Privilege safety on the endpoints that write group membership and permissions.

Three properties live here, all of them about the write path this fork opened
onto Group.permissions:

- an org admin cannot hand themselves "super_admin"
- no request can leave the organization with nobody able to administer it
- a permission change cannot commit without its audit event

They are kept apart from tests/handlers/test_groups.py, which covers the shape
of the endpoints rather than what they have to refuse.
"""

from unittest.mock import patch

from redis.exceptions import ConnectionError as RedisConnectionError

from redash.models import Group, User, db
from tests import BaseTestCase


class GroupPrivilegeTestCase(BaseTestCase):
    def create_admin_only_user(self):
        """A user holding "admin" but not "super_admin", plus the group granting it.

        factory.create_admin() puts the user in the builtin admin group, whose
        permissions are ADMIN_PERMISSIONS, so it carries "super_admin" as well
        and cannot show what an ordinary org admin is refused.
        """
        group = self.factory.create_group(permissions=Group.DEFAULT_PERMISSIONS + ["admin"])
        db.session.commit()
        user = self.factory.create_user(group_ids=[group.id])
        db.session.commit()

        return user, group

    def update(self, group, permissions, user):
        return self.make_request(
            "post",
            "/api/groups/{}".format(group.id),
            user=user,
            data={"name": group.name, "permissions": permissions},
        )


class TestSuperAdminIsNotAdminAssignable(GroupPrivilegeTestCase):
    def test_refuses_an_admin_granting_super_admin_to_another_group(self):
        admin, _ = self.create_admin_only_user()
        target = self.factory.create_group(permissions=["view_query"])
        db.session.commit()

        response = self.update(target, ["view_query", "super_admin"], user=admin)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Group.query.get(target.id).permissions, ["view_query"])

    def test_refuses_an_admin_granting_super_admin_to_their_own_group(self):
        admin, admin_group = self.create_admin_only_user()
        wanted = list(admin_group.permissions) + ["super_admin"]

        response = self.update(admin_group, wanted, user=admin)

        self.assertEqual(response.status_code, 403)
        self.assertNotIn("super_admin", Group.query.get(admin_group.id).permissions)

    def test_an_admin_cannot_reach_a_super_admin_endpoint_by_granting_it(self):
        # The escalation this closes, end to end: /status.json reports on the
        # whole instance rather than on one organization, and an org admin who
        # could write "super_admin" onto a group of their own would be holding
        # it one request later.
        admin, admin_group = self.create_admin_only_user()
        wanted = list(admin_group.permissions) + ["super_admin"]

        def status():
            return self.make_request("get", "/status.json", org=False, user=admin, is_json=False).status_code

        self.assertEqual(status(), 403)

        self.assertEqual(self.update(admin_group, wanted, user=admin).status_code, 403)

        self.assertEqual(status(), 403)

    def test_refuses_an_admin_revoking_super_admin(self):
        # Revoking is restricted as well as granting: an admin who could strip
        # it would be able to lock the super admins out.
        admin, _ = self.create_admin_only_user()
        target = self.factory.create_group(permissions=["view_query", "super_admin"])
        db.session.commit()

        response = self.update(target, ["view_query"], user=admin)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Group.query.get(target.id).permissions, ["view_query", "super_admin"])

    def test_lets_a_super_admin_grant_super_admin(self):
        target = self.factory.create_group(permissions=["view_query"])
        db.session.commit()

        response = self.update(target, ["view_query", "super_admin"], user=self.factory.create_admin())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Group.query.get(target.id).permissions, ["view_query", "super_admin"])

    def test_lets_a_super_admin_revoke_super_admin(self):
        target = self.factory.create_group(permissions=["view_query", "super_admin"])
        db.session.commit()

        response = self.update(target, ["view_query"], user=self.factory.create_admin())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Group.query.get(target.id).permissions, ["view_query"])


class TestAdminLockoutInvariant(GroupPrivilegeTestCase):
    """The organization must keep at least one enabled user holding "admin".

    Every setup below leaves the builtin admin group in place, carrying "admin"
    and holding no members. That group is what makes counting admin-bearing
    groups a guard that passes while the organization is being locked out.
    """

    def test_refuses_to_strip_admin_when_the_other_admin_groups_have_no_members(self):
        admin, admin_group = self.create_admin_only_user()
        without_admin = [p for p in admin_group.permissions if p != "admin"]

        response = self.update(admin_group, without_admin, user=admin)

        self.assertEqual(response.status_code, 400)
        db.session.rollback()
        self.assertIn("admin", Group.query.get(admin_group.id).permissions)

    def test_refuses_to_delete_the_group_whose_members_are_the_only_admins(self):
        admin, admin_group = self.create_admin_only_user()

        response = self.make_request("delete", "/api/groups/{}".format(admin_group.id), user=admin)

        self.assertEqual(response.status_code, 400)
        db.session.rollback()
        self.assertIsNotNone(Group.query.get(admin_group.id))
        self.assertIn(admin_group.id, User.query.get(admin.id).group_ids)

    def test_allows_deleting_an_admin_group_while_another_admin_remains(self):
        admin, admin_group = self.create_admin_only_user()
        self.factory.create_admin()
        db.session.commit()

        response = self.make_request("delete", "/api/groups/{}".format(admin_group.id), user=admin)

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(Group.query.get(admin_group.id))

    def test_refuses_to_remove_the_last_member_holding_admin(self):
        admin = self.factory.create_admin()
        db.session.commit()
        path = "/api/groups/{}/members/{}".format(self.factory.admin_group.id, admin.id)

        response = self.make_request("delete", path, user=admin)

        self.assertEqual(response.status_code, 400)
        db.session.rollback()
        self.assertIn(self.factory.admin_group.id, User.query.get(admin.id).group_ids)

    def test_allows_removing_a_member_while_another_admin_remains(self):
        admin = self.factory.create_admin()
        other = self.factory.create_admin()
        db.session.commit()
        path = "/api/groups/{}/members/{}".format(self.factory.admin_group.id, other.id)

        response = self.make_request("delete", path, user=admin)

        self.assertEqual(response.status_code, 200)
        self.assertNotIn(self.factory.admin_group.id, User.query.get(other.id).group_ids)

    def test_a_disabled_admin_does_not_keep_the_organization_administered(self):
        admin, admin_group = self.create_admin_only_user()
        disabled = self.factory.create_user(group_ids=[admin_group.id])
        disabled.disable()
        db.session.commit()
        path = "/api/groups/{}/members/{}".format(admin_group.id, admin.id)

        response = self.make_request("delete", path, user=admin)

        self.assertEqual(response.status_code, 400)
        db.session.rollback()
        self.assertIn(admin_group.id, User.query.get(admin.id).group_ids)

    def test_refuses_to_rewrite_the_last_admins_group_membership(self):
        # POST /api/users/<id> is member removal by another name, so it answers
        # to the same invariant as the group members endpoint.
        admin, admin_group = self.create_admin_only_user()

        response = self.make_request(
            "post",
            "/api/users/{}".format(admin.id),
            user=admin,
            data={"group_ids": [self.factory.default_group.id]},
        )

        self.assertEqual(response.status_code, 400)
        db.session.rollback()
        self.assertIn(admin_group.id, User.query.get(admin.id).group_ids)


class TestPermissionChangeIsAudited(GroupPrivilegeTestCase):
    def test_does_not_commit_a_permission_change_whose_event_cannot_be_enqueued(self):
        group = self.factory.create_group(permissions=["view_query"])
        db.session.commit()
        admin = self.factory.create_admin()

        def broker_down(event):
            if event["action"] == "change_permissions":
                raise RedisConnectionError("broker down")

        with patch("redash.handlers.base.record_event_task") as task:
            task.delay.side_effect = broker_down
            with self.assertRaises(RedisConnectionError):
                self.update(group, ["view_query", "no_export_data"], user=admin)

        db.session.rollback()
        self.assertEqual(Group.query.get(group.id).permissions, ["view_query"])

    def test_the_retry_after_a_broker_failure_still_records_the_change(self):
        # The failure has to leave the change replayable. Had it committed, the
        # retry would compare against the already changed list, record nothing,
        # and the change would stay unaudited for good.
        group = self.factory.create_group(permissions=["view_query"])
        db.session.commit()
        admin = self.factory.create_admin()

        with patch("redash.handlers.base.record_event_task") as task:
            task.delay.side_effect = RedisConnectionError("broker down")
            with self.assertRaises(RedisConnectionError):
                self.update(group, ["view_query", "no_export_data"], user=admin)

        db.session.rollback()

        with patch("redash.handlers.base.record_event_task") as task:
            response = self.update(group, ["view_query", "no_export_data"], user=admin)

        self.assertEqual(response.status_code, 200)
        events = [call[0][0] for call in task.delay.call_args_list]
        changes = [e for e in events if e["action"] == "change_permissions"]
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["previous_permissions"], ["view_query"])
        self.assertEqual(changes[0]["permissions"], ["view_query", "no_export_data"])
        self.assertEqual(Group.query.get(group.id).permissions, ["view_query", "no_export_data"])

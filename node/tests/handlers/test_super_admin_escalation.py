"""Routes to super_admin that do not go through a group's permission list.

Refusing the string in POST /api/groups/<id> closed one of them. These cover
the rest:

- group membership, which grants everything the group carries without the
  string ever being written, and the builtin admin group carries "super_admin"
  (Group.ADMIN_PERMISSIONS) in every organization that exists
- the group's NAME, which SAML resolves membership by, so renaming a group is
  choosing who the identity provider is about to put in it
- the account endpoints, where an invite link, a password reset link or another
  user's api_key is the account rather than a report about it

Every test acts as a plain admin, one holding "admin" and not "super_admin".
factory.create_admin() puts its user in the builtin admin group, so a test
written with it is a super admin acting and would pass against code that
refuses nobody. That is the whole reason this file has its own fixture.
"""

from redash.models import Group, User, db
from tests.handlers.test_group_privileges import GroupPrivilegeTestCase


class SuperAdminEscalationTestCase(GroupPrivilegeTestCase):
    def join(self, group_id, user, member_id):
        return self.make_request(
            "post",
            "/api/groups/{}/members".format(group_id),
            user=user,
            data={"user_id": member_id},
        )

    def status_code_for_super_admin_endpoint(self, user):
        return self.make_request("get", "/status.json", org=False, user=user, is_json=False).status_code


class TestSuperAdminIsNotReachableThroughMembership(SuperAdminEscalationTestCase):
    def test_refuses_an_admin_joining_the_builtin_admin_group(self):
        # The escalation that needs no setup at all: init_db gives every
        # organization an admin group carrying ADMIN_PERMISSIONS, so
        # "super_admin" is already sitting there waiting to be joined.
        admin, _ = self.create_admin_only_user()
        self.assertIn("super_admin", self.factory.admin_group.permissions)

        response = self.join(self.factory.admin_group.id, user=admin, member_id=admin.id)

        self.assertEqual(response.status_code, 403)
        db.session.rollback()
        self.assertNotIn(self.factory.admin_group.id, User.query.get(admin.id).group_ids)

    def test_an_admin_cannot_reach_a_super_admin_endpoint_by_joining_the_group(self):
        # Same end-to-end shape as the permission-list test next door, because
        # the permission being refused is worth nothing on its own: what an
        # attacker wants is the endpoint on the far side of it.
        admin, _ = self.create_admin_only_user()

        self.assertEqual(self.status_code_for_super_admin_endpoint(admin), 403)

        self.assertEqual(self.join(self.factory.admin_group.id, user=admin, member_id=admin.id).status_code, 403)

        self.assertEqual(self.status_code_for_super_admin_endpoint(admin), 403)

    def test_refuses_an_admin_joining_a_regular_group_that_carries_super_admin(self):
        admin, _ = self.create_admin_only_user()
        target = self.factory.create_group(permissions=["view_query", "super_admin"])
        db.session.commit()

        response = self.join(target.id, user=admin, member_id=admin.id)

        self.assertEqual(response.status_code, 403)
        db.session.rollback()
        self.assertNotIn(target.id, User.query.get(admin.id).group_ids)

    def test_refuses_an_admin_removing_a_member_from_a_super_admin_group(self):
        # The mirror image, and the reason removal is refused too: an admin who
        # could empty the super admin groups would be able to lock their
        # holders out and then be the only route back in.
        admin, _ = self.create_admin_only_user()
        super_admin = self.factory.create_admin()
        db.session.commit()
        path = "/api/groups/{}/members/{}".format(self.factory.admin_group.id, super_admin.id)

        response = self.make_request("delete", path, user=admin)

        self.assertEqual(response.status_code, 403)
        db.session.rollback()
        self.assertIn(self.factory.admin_group.id, User.query.get(super_admin.id).group_ids)

    def test_refuses_an_admin_deleting_a_group_that_carries_super_admin(self):
        # Deleting a group revokes from every member at once, so it is the
        # third door into the same room.
        admin, _ = self.create_admin_only_user()
        target = self.factory.create_group(permissions=["view_query", "super_admin"])
        db.session.commit()

        response = self.make_request("delete", "/api/groups/{}".format(target.id), user=admin)

        self.assertEqual(response.status_code, 403)
        db.session.rollback()
        self.assertIsNotNone(Group.query.get(target.id))

    def test_refuses_an_admin_adding_a_super_admin_group_by_rewriting_their_own_membership(self):
        # POST /api/users/<id> writes group_ids directly, so it is the members
        # endpoint under another name and answers to the same refusal.
        admin, admin_group = self.create_admin_only_user()

        response = self.make_request(
            "post",
            "/api/users/{}".format(admin.id),
            user=admin,
            data={"group_ids": [admin_group.id, self.factory.admin_group.id]},
        )

        self.assertEqual(response.status_code, 403)
        db.session.rollback()
        self.assertNotIn(self.factory.admin_group.id, User.query.get(admin.id).group_ids)

    def test_lets_an_admin_resend_a_membership_that_includes_no_restricted_group(self):
        # Only the ids that move are checked. An admin re-saving a user has to
        # keep working, or the refusal would read as a bug rather than a policy.
        admin, admin_group = self.create_admin_only_user()
        ordinary = self.factory.create_group(permissions=["view_query"])
        db.session.commit()

        response = self.make_request(
            "post",
            "/api/users/{}".format(admin.id),
            user=admin,
            data={"group_ids": [admin_group.id, ordinary.id]},
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn(ordinary.id, User.query.get(admin.id).group_ids)

    def test_lets_an_admin_change_membership_of_an_ordinary_group(self):
        admin, _ = self.create_admin_only_user()
        ordinary = self.factory.create_group(permissions=["view_query"])
        member = self.factory.create_user()
        db.session.commit()

        response = self.join(ordinary.id, user=admin, member_id=member.id)

        self.assertEqual(response.status_code, 200)
        self.assertIn(ordinary.id, User.query.get(member.id).group_ids)

    def test_lets_a_super_admin_add_a_member_to_a_super_admin_group(self):
        super_admin = self.factory.create_admin()
        member = self.factory.create_user()
        db.session.commit()

        response = self.join(self.factory.admin_group.id, user=super_admin, member_id=member.id)

        self.assertEqual(response.status_code, 200)
        self.assertIn(self.factory.admin_group.id, User.query.get(member.id).group_ids)


class TestSuperAdminAccountsAreNotAdminReachable(SuperAdminEscalationTestCase):
    """An account is reachable without any permission being edited at all."""

    def setUp(self):
        super().setUp()
        self.admin, _ = self.create_admin_only_user()
        self.super_admin = self.factory.create_admin()
        db.session.commit()

    def as_admin(self, method, path, **kwargs):
        return self.make_request(method, path.format(self.super_admin.id), user=self.admin, **kwargs)

    def test_an_api_key_is_a_credential_for_the_whole_account(self):
        # Why the api_key field is gated rather than merely tidy: presented as a
        # key, it authenticates as its owner carrying every permission they
        # hold (authentication.get_user_from_api_key). Handing an admin a super
        # admin's key is handing them super_admin, so the read is the grant.
        key = User.query.get(self.super_admin.id).api_key

        response = self.get_request(
            "/api/session",
            org=self.factory.org,
            headers={"Authorization": "Key {}".format(key)},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.super_admin.id, response.json["user"]["id"])
        self.assertIn("super_admin", response.json["user"]["permissions"])

    def test_does_not_show_an_admin_a_super_admins_api_key(self):
        response = self.as_admin("get", "/api/users/{}")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("api_key", response.json)

    def test_refuses_an_admin_regenerating_a_super_admins_api_key(self):
        before = User.query.get(self.super_admin.id).api_key

        response = self.as_admin("post", "/api/users/{}/regenerate_api_key")

        self.assertEqual(response.status_code, 403)
        db.session.rollback()
        self.assertEqual(before, User.query.get(self.super_admin.id).api_key)

    def test_refuses_an_admin_a_super_admins_password_reset_link(self):
        response = self.as_admin("get", "/api/users/{}/reset_password")

        self.assertEqual(response.status_code, 403)

    def test_refuses_an_admin_sending_a_super_admin_a_password_reset(self):
        response = self.as_admin("post", "/api/users/{}/reset_password")

        self.assertEqual(response.status_code, 403)

    def test_refuses_an_admin_a_super_admins_invite_link(self):
        response = self.as_admin("get", "/api/users/{}/invite")

        self.assertEqual(response.status_code, 403)

    def test_refuses_an_admin_changing_a_super_admins_email(self):
        # The takeover the public password reset flow finishes: point the
        # account at an address you control and ask for a new password.
        response = self.as_admin("post", "/api/users/{}", data={"email": "taken.over@example.com"})

        self.assertEqual(response.status_code, 403)
        db.session.rollback()
        self.assertNotEqual("taken.over@example.com", User.query.get(self.super_admin.id).email)

    def test_refuses_an_admin_disabling_a_super_admin(self):
        response = self.as_admin("post", "/api/users/{}/disable")

        self.assertEqual(response.status_code, 403)
        db.session.rollback()
        self.assertFalse(User.query.get(self.super_admin.id).is_disabled)

    def test_still_shows_an_admin_their_own_api_key(self):
        response = self.make_request("get", "/api/users/{}".format(self.admin.id), user=self.admin)

        self.assertIn("api_key", response.json)

    def test_lets_an_admin_manage_an_ordinary_account(self):
        member = self.factory.create_user()
        db.session.commit()

        response = self.make_request("post", "/api/users/{}/disable".format(member.id), user=self.admin)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(User.query.get(member.id).is_disabled)

    def test_lets_a_super_admin_read_another_super_admins_api_key(self):
        other = self.factory.create_admin()
        db.session.commit()

        response = self.make_request("get", "/api/users/{}".format(other.id), user=self.super_admin)

        self.assertEqual(response.status_code, 200)
        self.assertIn("api_key", response.json)

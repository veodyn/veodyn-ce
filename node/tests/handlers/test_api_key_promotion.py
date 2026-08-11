"""An api_key read before a promotion must not survive the promotion.

GET /api/users/<id> hands another user's raw api_key to an org admin whenever
redash.permissions.can_manage_account allows it, and that check reads the
TARGET'S CURRENT permissions. Nothing about it is wrong at the moment it runs:
the account is ordinary, and the key authenticates as an ordinary account.

The gap is in time rather than in the check. Api-key authentication resolves the
same user row on every request and reads the permissions the user holds THEN
(redash.authentication.get_user_from_api_key), so the moment somebody puts that
account into a group carrying "super_admin", a key captured while it was
ordinary starts authenticating as a super admin. No race is involved; the two
events can be days apart.

There are two ways to cross that line and both are covered here: adding the user
to a group that already carries the permission, and granting the permission to a
group the user is already in. The SAML assignment path is a third way into the
first, since a regular group can carry "super_admin" too.
"""

from redash.models import Group, User, db
from tests import BaseTestCase

SUPER_ADMIN_ENDPOINT = "/api/admin/queries/rq_status"


class ApiKeyPromotionTestCase(BaseTestCase):
    def create_admin_only_user(self):
        """A user holding "admin" but not "super_admin", plus the group granting it.

        factory.create_admin() puts the user in the builtin admin group, whose
        permissions are ADMIN_PERMISSIONS, so it carries "super_admin" as well
        and is not the caller this file is about. Same fixture as
        tests/handlers/test_group_privileges.py.
        """
        group = self.factory.create_group(permissions=Group.DEFAULT_PERMISSIONS + ["admin"])
        db.session.commit()
        user = self.factory.create_user(group_ids=[group.id])
        db.session.commit()

        return user, group

    def harvest_key(self, reader, target):
        """The api_key of `target` as `reader` can read it out of the product."""
        response = self.make_request("get", "/api/users/{}".format(target.id), user=reader)
        self.assertEqual(200, response.status_code)
        key = response.json.get("api_key")
        self.assertTrue(key, "the admin could not read the key this test is about")
        return key

    def key_of(self, user_id):
        db.session.expire_all()
        return User.query.get(user_id).api_key

    def reaches_super_admin_endpoint(self, api_key):
        """Whether `api_key` alone gets past a permission only a super admin has."""
        client = self.app.test_client()
        response = client.get("{}?api_key={}".format(SUPER_ADMIN_ENDPOINT, api_key))
        return response.status_code

    def promote_by_membership(self, actor, target, group):
        return self.make_request(
            "post",
            "/api/groups/{}/members".format(group.id),
            user=actor,
            data={"user_id": target.id},
        )

    def promote_by_user_edit(self, actor, target, group_ids):
        return self.make_request(
            "post",
            "/api/users/{}".format(target.id),
            user=actor,
            data={"group_ids": group_ids},
        )

    def promote_by_permission_grant(self, actor, group, permissions):
        return self.make_request(
            "post",
            "/api/groups/{}".format(group.id),
            user=actor,
            data={"name": group.name, "permissions": permissions},
        )


class TestTheEndpointThisFileMeasuresWith(ApiKeyPromotionTestCase):
    def test_a_super_admins_own_key_reaches_it(self):
        # Without this the regressions below would pass against an endpoint
        # that refuses everybody, which is a test that cannot fail.
        super_admin = self.factory.create_admin()
        db.session.commit()

        self.assertEqual(200, self.reaches_super_admin_endpoint(super_admin.api_key))

    def test_an_ordinary_users_key_does_not(self):
        user = self.factory.create_user()
        db.session.commit()

        self.assertNotEqual(200, self.reaches_super_admin_endpoint(user.api_key))


class TestAHarvestedKeyDoesNotSurvivePromotion(ApiKeyPromotionTestCase):
    def test_adding_the_user_to_a_group_carrying_super_admin_rotates_the_key(self):
        plain_admin, _ = self.create_admin_only_user()
        super_admin = self.factory.create_admin()
        target = self.factory.create_user()
        db.session.commit()

        captured = self.harvest_key(plain_admin, target)
        self.assertNotEqual(200, self.reaches_super_admin_endpoint(captured))

        target_id = target.id
        response = self.promote_by_membership(super_admin, target, self.factory.admin_group)
        self.assertEqual(200, response.status_code)
        self.assertIn("super_admin", User.query.get(target_id).permissions)

        self.assertNotEqual(200, self.reaches_super_admin_endpoint(captured))
        self.assertNotEqual(captured, self.key_of(target_id))
        self.assertEqual(200, self.reaches_super_admin_endpoint(self.key_of(target_id)))

    def test_rewriting_the_users_groups_rotates_the_key_too(self):
        # The same crossing through POST /api/users/<id> rather than the
        # members endpoint. Two doors into one room.
        plain_admin, _ = self.create_admin_only_user()
        super_admin = self.factory.create_admin()
        target = self.factory.create_user()
        db.session.commit()

        captured = self.harvest_key(plain_admin, target)
        target_id = target.id

        response = self.promote_by_user_edit(
            super_admin,
            target,
            [self.factory.default_group.id, self.factory.admin_group.id],
        )
        self.assertEqual(200, response.status_code)
        self.assertIn("super_admin", User.query.get(target_id).permissions)

        self.assertNotEqual(200, self.reaches_super_admin_endpoint(captured))
        self.assertNotEqual(captured, self.key_of(target_id))

    def test_granting_super_admin_to_a_group_the_user_is_in_rotates_the_key(self):
        # The second route across the line. The user's memberships never
        # change here; the group grows the permission underneath them.
        plain_admin, _ = self.create_admin_only_user()
        super_admin = self.factory.create_admin()
        team = self.factory.create_group(name="Team", permissions=["view_query"])
        db.session.commit()
        target = self.factory.create_user(group_ids=[self.factory.default_group.id, team.id])
        db.session.commit()

        captured = self.harvest_key(plain_admin, target)
        self.assertNotEqual(200, self.reaches_super_admin_endpoint(captured))
        target_id = target.id

        response = self.promote_by_permission_grant(super_admin, team, ["view_query", "super_admin"])
        self.assertEqual(200, response.status_code)
        self.assertIn("super_admin", User.query.get(target_id).permissions)

        self.assertNotEqual(200, self.reaches_super_admin_endpoint(captured))
        self.assertNotEqual(captured, self.key_of(target_id))
        self.assertEqual(200, self.reaches_super_admin_endpoint(self.key_of(target_id)))

    def test_every_member_of_the_promoted_group_is_rotated(self):
        # The grant promotes the whole membership at once, so rotating only the
        # user who happened to be looked at would leave the rest captured.
        super_admin = self.factory.create_admin()
        team = self.factory.create_group(name="Team", permissions=["view_query"])
        db.session.commit()
        members = [self.factory.create_user(group_ids=[self.factory.default_group.id, team.id]) for _ in range(3)]
        db.session.commit()
        before = {member.id: member.api_key for member in members}

        response = self.promote_by_permission_grant(super_admin, team, ["view_query", "super_admin"])
        self.assertEqual(200, response.status_code)

        for member_id, captured in before.items():
            self.assertNotEqual(200, self.reaches_super_admin_endpoint(captured))
            self.assertNotEqual(captured, self.key_of(member_id))

    def test_a_saml_assertion_naming_a_group_that_carries_it_rotates_the_key(self):
        # A regular group can carry "super_admin" once a super admin puts it
        # there, and User.update_group_assignments will join a user to a
        # regular group by name. Same crossing, third door.
        self.factory.create_admin()
        self.factory.create_group(name="Team", permissions=["view_query", "super_admin"])
        db.session.commit()
        target = self.factory.create_user()
        db.session.commit()
        target_id, captured = target.id, target.api_key
        self.assertNotEqual(200, self.reaches_super_admin_endpoint(captured))

        User.query.get(target_id).update_group_assignments(["Team"])

        self.assertIn("super_admin", User.query.get(target_id).permissions)
        self.assertNotEqual(200, self.reaches_super_admin_endpoint(captured))
        self.assertNotEqual(captured, self.key_of(target_id))


class TestOrdinaryChangesLeaveTheKeyAlone(ApiKeyPromotionTestCase):
    """Rotation on every membership edit would be its own outage.

    An api_key is a credential people put in scripts and dashboards. Rotating
    one that never crossed the line breaks those for no security gain, so the
    trigger is the crossing and not the write.
    """

    def test_joining_an_ordinary_group_does_not_rotate(self):
        plain_admin, _ = self.create_admin_only_user()
        team = self.factory.create_group(name="Team", permissions=["view_query"])
        db.session.commit()
        target = self.factory.create_user()
        db.session.commit()
        target_id, before = target.id, target.api_key

        response = self.promote_by_membership(plain_admin, target, team)
        self.assertEqual(200, response.status_code)

        self.assertEqual(before, self.key_of(target_id))

    def test_a_user_who_already_held_super_admin_is_not_rotated_again(self):
        # Their key was never readable by anyone who could not already reach
        # everything, so there is nothing to revoke and breaking it is pure cost.
        super_admin = self.factory.create_admin()
        team = self.factory.create_group(name="Team", permissions=["view_query"])
        db.session.commit()
        target = self.factory.create_admin()
        db.session.commit()
        target_id, before = target.id, target.api_key

        response = self.promote_by_membership(super_admin, target, team)
        self.assertEqual(200, response.status_code)

        self.assertEqual(before, self.key_of(target_id))

    def test_a_permission_edit_that_grants_nothing_restricted_does_not_rotate(self):
        super_admin = self.factory.create_admin()
        team = self.factory.create_group(name="Team", permissions=["view_query"])
        db.session.commit()
        target = self.factory.create_user(group_ids=[self.factory.default_group.id, team.id])
        db.session.commit()
        target_id, before = target.id, target.api_key

        response = self.promote_by_permission_grant(super_admin, team, ["view_query", "list_users"])
        self.assertEqual(200, response.status_code)

        self.assertEqual(before, self.key_of(target_id))

"""A group's name is a privilege, because SAML resolves membership by it.

POST /api/groups/<id> refuses a rename of a builtin group and validates the
permission LIST against what the caller may grant. Neither of those looks at the
name of a regular group, and the name is what
User.update_group_assignments hands to Group.find_by_name with every RedashGroups
assertion authentication.saml_auth receives. So a plain org admin could move a
group carrying "super_admin" under a name their own assertion already names, log
in, and be granted it, with no permission list edited and no membership endpoint
touched.

The precondition is a non-builtin group already carrying "super_admin". A plain
admin cannot manufacture one (POST /api/groups creates DEFAULT_PERMISSIONS, and
validated_permissions refuses the string), and the builtin admin group cannot be
renamed at all. It exists whenever a super admin has deliberately put the
permission on a regular group, which the endpoint supports on purpose. So this
is a real door with a setup step rather than a one-request escalation.

Every test acts as a plain admin. factory.create_admin() is in the builtin admin
group and holds "super_admin", so a test written with it refuses nobody. The
fixture comes from tests/handlers/test_group_privileges.py.
"""

from redash.models import Group, User, db
from tests.handlers.test_super_admin_escalation import SuperAdminEscalationTestCase


class TestSuperAdminIsNotReachableThroughRename(SuperAdminEscalationTestCase):
    def rename(self, group, name, user):
        # Whole-group save, the shape client/app/components/groups/GroupName.jsx
        # sends: the permission list rides along unchanged on every rename.
        return self.make_request(
            "post",
            "/api/groups/{}".format(group.id),
            user=user,
            data={"name": name, "permissions": list(group.permissions)},
        )

    def test_refuses_an_admin_renaming_a_group_that_carries_super_admin(self):
        admin, _ = self.create_admin_only_user()
        target = self.factory.create_group(name="SuperOps", permissions=["view_query", "super_admin"])
        db.session.commit()

        response = self.rename(target, "Engineering", user=admin)

        self.assertEqual(response.status_code, 403)
        db.session.rollback()
        self.assertEqual("SuperOps", Group.query.get(target.id).name)

    def test_an_admin_cannot_reach_a_super_admin_endpoint_by_renaming_a_group(self):
        # End to end through the door SAML opens. The assertion is fixed at the
        # identity provider and names the attacker's own groups; the rename is
        # the attacker deciding that one of those names now points at a group
        # carrying "super_admin". The decoy "Engineering" group is the realistic
        # setup, and it also shows that find_by_name matches on the name alone,
        # so a rename into a collision is enough.
        admin, admin_group = self.create_admin_only_user()
        admin_group.name = "Analysts"
        target = self.factory.create_group(name="SuperOps", permissions=["view_query", "super_admin"])
        self.factory.create_group(name="Engineering", permissions=["view_query"])
        db.session.commit()
        assertion = ["Analysts", "Engineering"]

        self.assertEqual(self.status_code_for_super_admin_endpoint(admin), 403)

        rename = self.rename(target, "Engineering", user=admin)
        db.session.rollback()

        # The login half, driven the way saml_auth drives it. Keeping "Analysts"
        # in the assertion is what leaves the attacker their "admin" afterwards,
        # so the endpoint check below is answering the escalation rather than
        # the reassignment.
        User.query.get(admin.id).update_group_assignments(assertion)

        # The escalation is asserted before the refusal that prevents it, so a
        # regression fails on "you are a super admin now" rather than on a
        # status code, and the test cannot pass by refusing for a wrong reason.
        self.assertNotIn("super_admin", User.query.get(admin.id).permissions)
        self.assertEqual(self.status_code_for_super_admin_endpoint(admin), 403)
        self.assertEqual(rename.status_code, 403)

    def test_refuses_an_admin_renaming_the_group_a_super_admin_assertion_resolves(self):
        # The mirror image. Renaming away from a name revokes from everybody
        # whose assertion carries it, which is the lockout every other removal
        # path is refused to prevent.
        admin, _ = self.create_admin_only_user()
        target = self.factory.create_group(name="SuperOps", permissions=["view_query", "super_admin"])
        db.session.commit()

        self.assertEqual(self.rename(target, "Retired", user=admin).status_code, 403)
        db.session.rollback()
        self.assertEqual("SuperOps", Group.query.get(target.id).name)

    def test_lets_an_admin_rename_an_ordinary_group(self):
        admin, _ = self.create_admin_only_user()
        ordinary = self.factory.create_group(name="Engineering", permissions=["view_query"])
        db.session.commit()

        response = self.rename(ordinary, "Platform", user=admin)

        self.assertEqual(response.status_code, 200)
        self.assertEqual("Platform", Group.query.get(ordinary.id).name)

    def test_lets_an_admin_re_save_a_super_admin_group_under_its_own_name(self):
        # The admin client re-sends the whole group on every save, so an
        # unchanged name has to stay an ordinary edit rather than a refusal.
        admin, _ = self.create_admin_only_user()
        target = self.factory.create_group(name="SuperOps", permissions=["view_query", "super_admin"])
        db.session.commit()

        response = self.rename(target, "SuperOps", user=admin)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(["view_query", "super_admin"], Group.query.get(target.id).permissions)

    def test_lets_a_super_admin_rename_a_group_that_carries_super_admin(self):
        target = self.factory.create_group(name="SuperOps", permissions=["view_query", "super_admin"])
        db.session.commit()

        response = self.rename(target, "Engineering", user=self.factory.create_admin())

        self.assertEqual(response.status_code, 200)
        self.assertEqual("Engineering", Group.query.get(target.id).name)

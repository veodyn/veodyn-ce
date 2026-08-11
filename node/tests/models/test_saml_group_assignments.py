"""A SAML assertion may not grant a builtin group, and may not revoke one either.

Group.find_by_name stopped resolving builtin groups by name, which closed the
escalation where an assertion carrying the literal string "admin" joined the
builtin admin group and the "super_admin" it carries.

That refusal alone is a lockout. User.update_group_assignments REPLACES the
whole group list on every SAML callback, so a deployment that legitimately maps
an identity provider group named "admin" onto Redash's own admin group loses one
administrator per login: the assertion can no longer name the group, so the
rewrite drops it and the user lands in the default group. The last administrator
takes the organization with them, because handing the permission back is itself
an administrator's job.

Both properties have to hold at once, which is what this file pins: an assertion
cannot ADD a builtin membership, and it cannot take away one the user already
has.
"""

from redash import permissions
from redash.models import Group, User, db
from tests import BaseTestCase


class SamlAssignmentTestCase(BaseTestCase):
    def login_with(self, user, group_names):
        """The half of authentication.saml_auth.idp_initiated that assigns groups.

        Signing the assertion is pysaml2's job. The group names are the identity
        provider's input either way, so handing them straight to
        update_group_assignments is the same callback arriving.
        """
        user_id = user.id
        User.query.get(user_id).update_group_assignments(group_names)
        return User.query.get(user_id)

    def enabled_admin_count(self):
        return (
            Group.members(self.factory.admin_group.id)
            .filter(User.disabled_at.is_(None), User.org_id == self.factory.org.id)
            .count()
        )


class TestAnAssertionCannotRevokeABuiltinGroup(SamlAssignmentTestCase):
    def test_an_admin_the_assertion_names_keeps_the_builtin_admin_group(self):
        # The deployment the refusal broke: the identity provider has a group
        # called "admin" and it is meant to mean Redash's admin group.
        admin = self.factory.create_admin()
        db.session.commit()
        self.assertIn(self.factory.admin_group.id, admin.group_ids)

        after = self.login_with(admin, ["admin"])

        self.assertIn(self.factory.admin_group.id, after.group_ids)
        self.assertIn("super_admin", after.permissions)

    def test_an_admin_the_assertion_does_not_name_keeps_the_builtin_admin_group(self):
        # Same demotion, reached without the word "admin" appearing anywhere:
        # any assertion at all rewrites the list.
        admin = self.factory.create_admin()
        engineering = self.factory.create_group(name="Engineering")
        db.session.commit()

        after = self.login_with(admin, ["Engineering"])

        self.assertIn(self.factory.admin_group.id, after.group_ids)
        self.assertIn(engineering.id, after.group_ids)
        self.assertIn("super_admin", after.permissions)

    def test_a_login_never_leaves_the_organization_with_fewer_admins(self):
        # Stated as the property that actually matters, so a future rewrite of
        # the mechanism still has to answer it.
        sole_admin = self.factory.create_admin()
        db.session.commit()
        before = self.enabled_admin_count()

        self.login_with(sole_admin, ["Engineering", "admin", "whatever"])

        self.assertEqual(1, before)
        self.assertEqual(before, self.enabled_admin_count())

    def test_the_default_group_survives_alongside_a_kept_builtin(self):
        admin = self.factory.create_admin()
        db.session.commit()

        after = self.login_with(admin, [])

        self.assertIn(self.factory.default_group.id, after.group_ids)
        self.assertIn(self.factory.admin_group.id, after.group_ids)

    def test_a_kept_group_is_not_recorded_twice(self):
        admin = self.factory.create_admin()
        db.session.commit()

        after = self.login_with(admin, ["admin"])

        self.assertEqual(sorted(set(after.group_ids)), sorted(after.group_ids))

    def test_a_regular_group_the_assertion_stops_naming_is_still_removed(self):
        # Only builtin groups are carried across the rewrite. Reassigning
        # someone from one team to another is what the RedashGroups attribute is
        # for, and keeping a builtin must not quietly turn every membership
        # into a permanent one.
        engineering = self.factory.create_group(name="Engineering")
        support = self.factory.create_group(name="Support")
        user = self.factory.create_user()
        db.session.commit()

        self.login_with(user, ["Engineering"])
        after = self.login_with(user, ["Support"])

        self.assertIn(support.id, after.group_ids)
        self.assertNotIn(engineering.id, after.group_ids)

    def test_a_builtin_group_of_another_organization_is_not_kept(self):
        # Preservation is scoped to the user's own org, so a foreign id sitting
        # in group_ids is not resurrected by a login.
        other_org = self.factory.create_org()
        db.session.commit()
        user = self.factory.create_user()
        user.group_ids = list(user.group_ids) + [other_org.admin_group.id]
        db.session.add(user)
        db.session.commit()

        after = self.login_with(user, [])

        self.assertNotIn(other_org.admin_group.id, after.group_ids)


class TestAnAssertionCannotGrantABuiltinGroup(SamlAssignmentTestCase):
    def test_a_user_outside_the_builtin_admin_group_is_not_added_by_name(self):
        # The escalation the exclusion in find_by_name exists for. Keeping the
        # groups a user already has must not become a way to hand out new ones.
        user = self.factory.create_user()
        db.session.commit()

        after = self.login_with(user, ["admin"])

        self.assertNotIn(self.factory.admin_group.id, after.group_ids)
        self.assertNotIn("super_admin", after.permissions)
        self.assertEqual([self.factory.default_group.id], after.group_ids)

    def test_naming_every_builtin_group_adds_nothing(self):
        user = self.factory.create_user()
        db.session.commit()

        after = self.login_with(user, ["admin", "default"])

        self.assertEqual([self.factory.default_group.id], after.group_ids)

    def test_a_regular_group_that_shares_a_builtin_name_still_resolves(self):
        # Group names are not unique, so an organization can have a regular
        # group of its own called "admin". That one is a group an administrator
        # created and stays assignable; the builtin beside it does not.
        theirs = self.factory.create_group(name="admin")
        user = self.factory.create_user()
        db.session.commit()

        self.assertEqual([theirs.id], [g.id for g in Group.find_by_name(self.factory.org, ["admin"])])

        after = self.login_with(user, ["admin"])

        self.assertIn(theirs.id, after.group_ids)
        self.assertNotIn(self.factory.admin_group.id, after.group_ids)
        self.assertNotIn("super_admin", after.permissions)


class TestAnAssertionCannotEmptyTheAdmins(SamlAssignmentTestCase):
    """The ordinary case the builtin carve-out above does not reach.

    Most deployments do not map an identity provider group onto Redash's own
    builtin admin group. They make a REGULAR group, put "admin" on it, and map
    the identity provider group onto that. Carrying builtin memberships across
    the rewrite does nothing for them: the group is regular, so an assertion
    that stops naming it removes it, and when its holder was the last enabled
    administrator the organization is left with nobody who can hand the
    permission back.

    The rule this file pins is the same one the group and user endpoints
    answer to, reached from the login path: no single operation may take the
    last enabled administrator away.

    A login is not a form submission, so the refusal is shaped differently. A
    failed login would leave the sole administrator unable to reach the
    product at all, which is the lockout stated the other way round, so the
    login COMPLETES and the memberships that preserve the invariant are the
    ones kept. The property traded away is that an assertion can no longer
    demote the last administrator; that demotion now takes another
    administrator, or a shell.
    """

    def admin_carrying_group(self, name="Engineering"):
        group = self.factory.create_group(name=name, permissions=Group.DEFAULT_PERMISSIONS + ["admin"])
        db.session.commit()
        return group

    def enabled_admins(self):
        return permissions.enabled_admin_count(self.factory.org)

    def test_a_sole_admin_keeps_the_regular_group_the_assertion_dropped(self):
        engineering = self.admin_carrying_group()
        sole_admin = self.factory.create_user(group_ids=[self.factory.default_group.id, engineering.id])
        db.session.commit()
        self.assertEqual(1, self.enabled_admins())

        after = self.login_with(sole_admin, [])

        self.assertIn(engineering.id, after.group_ids)
        self.assertIn("admin", after.permissions)
        self.assertEqual(1, self.enabled_admins())

    def test_the_login_still_applies_the_groups_the_assertion_does_name(self):
        # Keeping the invariant is not a licence to ignore the assertion. The
        # rescue is the narrowest one that works: the groups carrying admin
        # come back, everything else the assertion says still happens.
        engineering = self.admin_carrying_group()
        support = self.factory.create_group(name="Support")
        sole_admin = self.factory.create_user(group_ids=[self.factory.default_group.id, engineering.id])
        db.session.commit()

        after = self.login_with(sole_admin, ["Support"])

        self.assertIn(support.id, after.group_ids)
        self.assertIn(engineering.id, after.group_ids)
        self.assertIn(self.factory.default_group.id, after.group_ids)

    def test_a_group_that_does_not_carry_admin_is_still_removed(self):
        engineering = self.admin_carrying_group()
        support = self.factory.create_group(name="Support")
        sole_admin = self.factory.create_user(group_ids=[self.factory.default_group.id, engineering.id, support.id])
        db.session.commit()

        after = self.login_with(sole_admin, [])

        self.assertIn(engineering.id, after.group_ids)
        self.assertNotIn(support.id, after.group_ids)

    def test_the_removal_proceeds_when_another_enabled_admin_remains(self):
        # The whole point of the RedashGroups attribute is that it can demote
        # somebody. It still can, right up to the last administrator.
        engineering = self.admin_carrying_group()
        leaving = self.factory.create_user(group_ids=[self.factory.default_group.id, engineering.id])
        self.factory.create_admin()
        db.session.commit()
        self.assertEqual(2, self.enabled_admins())

        after = self.login_with(leaving, [])

        self.assertNotIn(engineering.id, after.group_ids)
        self.assertNotIn("admin", after.permissions)
        self.assertEqual(1, self.enabled_admins())

    def test_a_disabled_second_admin_does_not_authorize_the_removal(self):
        # enabled_admin_count is the measure rather than a count of members,
        # because a disabled administrator cannot log in and therefore cannot
        # administer anything.
        engineering = self.admin_carrying_group()
        sole_admin = self.factory.create_user(group_ids=[self.factory.default_group.id, engineering.id])
        disabled = self.factory.create_user(group_ids=[self.factory.default_group.id, engineering.id])
        disabled.disable()
        db.session.commit()
        self.assertEqual(1, self.enabled_admins())

        after = self.login_with(sole_admin, [])

        self.assertIn(engineering.id, after.group_ids)
        self.assertEqual(1, self.enabled_admins())

    def test_a_login_by_somebody_who_is_not_an_admin_is_untouched(self):
        # The rescue only ever adds back a group the user already held, so an
        # ordinary user's login cannot be turned into a promotion by it.
        self.admin_carrying_group()
        self.factory.create_admin()
        user = self.factory.create_user()
        db.session.commit()

        after = self.login_with(user, [])

        self.assertEqual([self.factory.default_group.id], after.group_ids)
        self.assertNotIn("admin", after.permissions)

    def test_an_organization_already_without_admins_still_logs_people_in(self):
        # Nothing to preserve, and refusing the login here would only make an
        # already broken organization harder to look at.
        support = self.factory.create_group(name="Support")
        user = self.factory.create_user(group_ids=[self.factory.default_group.id, support.id])
        db.session.commit()
        self.assertEqual(0, self.enabled_admins())

        after = self.login_with(user, [])

        self.assertNotIn(support.id, after.group_ids)
        self.assertIn(self.factory.default_group.id, after.group_ids)

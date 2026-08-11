"""User.permissions must resolve group ids inside the user's own organization.

The property is what every permission check ultimately reads, so it is the last
place a group id from another tenant may be allowed to mean anything. Today no
web write path stores a foreign id (they all go through get_by_id_and_org), and
these tests do not claim otherwise: they store one directly, which is what a
future path missing that validation would amount to under MULTI_ORG.
"""

from redash.models import Group, db
from tests import BaseTestCase


class TestUserPermissionsOrgScope(BaseTestCase):
    def test_a_foreign_group_grants_nothing(self):
        other_org = self.factory.create_org()
        foreign_admin_group = self.factory.create_group(
            org=other_org,
            name="admin next door",
            permissions=Group.ADMIN_PERMISSIONS,
        )
        db.session.commit()

        user = self.factory.create_user(group_ids=[self.factory.default_group.id, foreign_admin_group.id])
        db.session.commit()

        self.assertNotIn("admin", user.permissions)
        self.assertNotIn("super_admin", user.permissions)
        self.assertFalse(user.has_permission("admin"))

    def test_the_users_own_groups_still_resolve(self):
        """The org condition must not quietly cost anybody a permission."""
        own_group = self.factory.create_group(name="reporting", permissions=["list_users", "no_export_data"])
        db.session.commit()

        user = self.factory.create_user(group_ids=[self.factory.default_group.id, own_group.id])
        db.session.commit()

        self.assertEqual(
            set(user.permissions),
            set(self.factory.default_group.permissions) | {"list_users", "no_export_data"},
        )

    def test_a_foreign_group_is_dropped_without_touching_the_others(self):
        other_org = self.factory.create_org()
        foreign_group = self.factory.create_group(org=other_org, name="theirs", permissions=["admin"])
        own_group = self.factory.create_group(name="ours", permissions=["list_users"])
        db.session.commit()

        user = self.factory.create_user(group_ids=[self.factory.default_group.id, foreign_group.id, own_group.id])
        db.session.commit()

        self.assertIn("list_users", user.permissions)
        self.assertNotIn("admin", user.permissions)

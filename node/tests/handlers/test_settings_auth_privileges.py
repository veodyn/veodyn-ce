"""The organization's authentication settings are a trust anchor, not a preference.

POST /api/settings/organization writes every key in redash/settings/organization.py
and was gated by "admin" alone. The auth_saml_* keys are read per organization by
authentication.saml_auth.get_saml_client, which builds inline IdP metadata out of
the certificate stored there and runs with allow_unsolicited on and
want_response_signed off. So a plain org admin could install an identity provider
whose private key they hold, sign an assertion naming their own email and
RedashGroups ["admin"], and be handed the builtin admin group, which carries
"super_admin" in every organization models.init_db creates.

Two defenses are covered here. The endpoint refuses an admin who is not a super
admin any CHANGE to an auth_* setting, and Group.find_by_name no longer resolves a
name onto a builtin group, so a controlled assertion cannot name its way into the
one group Redash guarantees exists.

Both are needed. The first closes the door; the second means that an assertion
arriving through some other misconfiguration still cannot land in the builtin
admin group.

Every test acts as a plain admin. factory.create_admin() puts its user in the
builtin admin group and so holds "super_admin", and would be refused by nothing.
The fixture comes from tests/handlers/test_group_privileges.py.
"""

from redash.models import Group, Organization, User, db
from tests.handlers.test_super_admin_escalation import SuperAdminEscalationTestCase

# A self-signed certificate is a handful of base64, and nothing in these tests
# parses it. What matters is that it is not the certificate the organization was
# configured with, because installing your own is the whole attack.
ATTACKER_CERT = "MIIC" + "QQ" * 40


def a_different_value(current):
    """A value of the same shape as `current` that is not equal to it.

    The refusal is about a CHANGE, so every test value has to actually differ
    from what the organization already has, whatever type that setting is.
    """
    if isinstance(current, bool):
        return not current
    if isinstance(current, list):
        return list(current) + ["attacker.example"]
    return "{}attacker".format(current or "")


class OrganizationAuthSettingsTestCase(SuperAdminEscalationTestCase):
    def save(self, user, values):
        return self.make_request("post", "/api/settings/organization", user=user, data=values)

    def current_settings(self, user):
        return self.make_request("get", "/api/settings/organization", user=user).json["settings"]

    def auth_settings(self, user):
        """Every auth setting the settings page itself hands an admin.

        Read off the endpoint rather than off the constant the handler checks
        against, so this cannot pass by agreeing with a mistake in that constant,
        and so an auth setting added upstream is covered the day it lands.
        """
        return {k: v for k, v in self.current_settings(user).items() if k.startswith("auth_")}


class TestAuthSettingsAreSuperAdminOnly(OrganizationAuthSettingsTestCase):
    def test_refuses_a_plain_admin_a_change_to_any_auth_setting(self):
        admin, _ = self.create_admin_only_user()
        settings = self.auth_settings(admin)

        # A guard on the loop below. If the endpoint ever stops reporting the
        # auth settings, an empty dict would make this test pass having asserted
        # nothing at all.
        for expected in ["auth_saml_x509_cert", "auth_saml_sso_url", "auth_saml_type", "auth_saml_enabled"]:
            self.assertIn(expected, settings)

        for key, current in settings.items():
            with self.subTest(setting=key):
                response = self.save(admin, {key: a_different_value(current)})

                self.assertEqual(response.status_code, 403)
                db.session.rollback()
                self.assertEqual(current, self.current_settings(admin)[key])

    def test_lets_a_super_admin_change_an_auth_setting(self):
        super_admin = self.factory.create_admin()
        db.session.commit()

        response = self.save(super_admin, {"auth_saml_x509_cert": ATTACKER_CERT})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            ATTACKER_CERT, Organization.get_by_slug(self.factory.org.slug).get_setting("auth_saml_x509_cert")
        )

    def test_lets_a_plain_admin_change_an_ordinary_setting(self):
        # The fix has to take the trust anchor away from an org admin, not the
        # settings page. An admin who cannot set a date format would ask for
        # super_admin, and be right to.
        admin, _ = self.create_admin_only_user()

        response = self.save(admin, {"date_format": "YYYY-MM-DD"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual("YYYY-MM-DD", Organization.get_by_slug(self.factory.org.slug).get_setting("date_format"))

    def test_lets_a_plain_admin_re_save_the_whole_settings_page(self):
        # The shape the client actually sends. useOrganizationSettings.js GETs
        # every value and POSTs the whole object back on every save, so an admin
        # editing the date format submits every auth_* key along untouched.
        # Refusing on a key being PRESENT would break that, which is why the
        # refusal is measured against the stored value instead.
        admin, _ = self.create_admin_only_user()
        values = dict(self.current_settings(admin))
        values["date_format"] = "YYYY-MM-DD"

        response = self.save(admin, values)

        self.assertEqual(response.status_code, 200)
        self.assertEqual("YYYY-MM-DD", Organization.get_by_slug(self.factory.org.slug).get_setting("date_format"))

    def test_refuses_a_plain_admin_an_auth_setting_riding_along_with_an_ordinary_one(self):
        # The mirror image of the test above: an ordinary key in the same request
        # is not cover for a changed auth key, and the ordinary key must not be
        # written either, because the request is refused whole.
        admin, _ = self.create_admin_only_user()

        response = self.save(admin, {"date_format": "YYYY-MM-DD", "auth_saml_x509_cert": ATTACKER_CERT})

        self.assertEqual(response.status_code, 403)
        db.session.rollback()
        org = Organization.get_by_slug(self.factory.org.slug)
        self.assertNotEqual(ATTACKER_CERT, org.get_setting("auth_saml_x509_cert"))
        self.assertNotEqual("YYYY-MM-DD", org.get_setting("date_format"))

    def test_refuses_a_plain_admin_an_auth_setting_the_endpoint_does_not_know(self):
        # Fail closed. An auth_* key that is not in redash/settings/organization.py
        # has no stored value to compare against, so it counts as a change and is
        # refused rather than falling through to the handler.
        admin, _ = self.create_admin_only_user()

        response = self.save(admin, {"auth_something_invented_later": "attacker"})

        self.assertEqual(response.status_code, 403)


class TestSuperAdminIsNotReachableThroughTheSamlTrustAnchor(OrganizationAuthSettingsTestCase):
    def test_a_plain_admin_cannot_install_their_own_identity_provider(self):
        admin, _ = self.create_admin_only_user()
        idp = {
            "auth_saml_enabled": True,
            "auth_saml_type": "static",
            "auth_saml_entity_id": "https://attacker.example/idp",
            "auth_saml_sso_url": "https://attacker.example/sso",
            "auth_saml_x509_cert": ATTACKER_CERT,
        }

        response = self.save(admin, idp)

        self.assertEqual(response.status_code, 403)
        db.session.rollback()
        org = Organization.get_by_slug(self.factory.org.slug)
        self.assertNotEqual(ATTACKER_CERT, org.get_setting("auth_saml_x509_cert"))
        self.assertFalse(org.get_setting("auth_saml_enabled"))

    def test_a_plain_admin_cannot_reach_a_super_admin_endpoint_through_saml(self):
        # End to end, through the two halves the attack is made of. The first is
        # the settings write that makes the attacker the organization's identity
        # provider. The second is the assertion they then sign, driven the way
        # authentication.saml_auth drives it: get_identity, then
        # update_group_assignments with whatever RedashGroups says. Signing the
        # assertion is pysaml2's job and is not reproduced here; the subject and
        # the group names are the attacker's input either way, so handing them
        # straight to update_group_assignments is the same request arriving.
        #
        # "admin" is the group name because Group.find_by_name matched on the
        # name alone and every organization has a BUILTIN group called that
        # carrying Group.ADMIN_PERMISSIONS, which includes "super_admin".
        admin, admin_group = self.create_admin_only_user()
        admin_group.name = "Analysts"
        db.session.commit()
        assertion = ["Analysts", "admin"]

        self.assertEqual(self.status_code_for_super_admin_endpoint(admin), 403)
        self.assertIn("super_admin", Group.query.get(self.factory.admin_group.id).permissions)

        installed = self.save(
            admin,
            {
                "auth_saml_enabled": True,
                "auth_saml_type": "static",
                "auth_saml_sso_url": "https://attacker.example/sso",
                "auth_saml_x509_cert": ATTACKER_CERT,
            },
        )
        db.session.rollback()

        User.query.get(admin.id).update_group_assignments(assertion)

        # The escalation is asserted before any status code, so a regression
        # fails on "this user holds super_admin now" rather than on an incidental
        # 403 somewhere else in the request.
        self.assertNotIn("super_admin", User.query.get(admin.id).permissions)
        self.assertNotIn(self.factory.admin_group.id, User.query.get(admin.id).group_ids)
        self.assertEqual(self.status_code_for_super_admin_endpoint(admin), 403)
        self.assertEqual(installed.status_code, 403)


class TestFindByNameDoesNotResolveBuiltinGroups(SuperAdminEscalationTestCase):
    """Defense in depth under the SAML group assignment itself.

    A name is not a permission, but Group.find_by_name treated it as one: the
    literal string "admin" in an assertion matched the builtin admin group, which
    carries "super_admin". Names in an assertion come from the identity provider,
    and an organization does not get to reserve a word there.
    """

    def test_does_not_resolve_a_builtin_group_by_name(self):
        self.assertEqual([], Group.find_by_name(self.factory.org, ["admin", "default"]))

    def test_still_resolves_a_regular_group_by_name(self):
        engineering = self.factory.create_group(name="Engineering")
        db.session.commit()

        self.assertEqual([engineering.id], [g.id for g in Group.find_by_name(self.factory.org, ["Engineering"])])

    def test_resolves_the_regular_group_that_shares_a_builtin_name(self):
        # Group names are not unique, so an organization can have a regular group
        # called "admin" of its own. That one is a group an admin created and
        # stays resolvable; the builtin beside it does not.
        theirs = self.factory.create_group(name="admin")
        db.session.commit()

        self.assertEqual([theirs.id], [g.id for g in Group.find_by_name(self.factory.org, ["admin"])])

    def test_an_assertion_naming_admin_does_not_join_the_builtin_admin_group(self):
        user = self.factory.create_user()
        db.session.commit()

        user.update_group_assignments(["admin"])

        self.assertNotIn("super_admin", User.query.get(user.id).permissions)
        self.assertEqual([self.factory.default_group.id], User.query.get(user.id).group_ids)

    def test_an_assertion_still_assigns_the_regular_groups_it_names(self):
        # The refusal above must not cost a normal SAML deployment its group
        # assignment, which is the only thing find_by_name is used for.
        engineering = self.factory.create_group(name="Engineering")
        user = self.factory.create_user()
        db.session.commit()

        user.update_group_assignments(["Engineering"])

        assigned = User.query.get(user.id).group_ids
        self.assertIn(engineering.id, assigned)
        self.assertIn(self.factory.default_group.id, assigned)

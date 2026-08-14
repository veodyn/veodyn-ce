"""Invite, reset and verify tokens: purpose-scoped, and dead once used.

All three used to be the same string, signed with no salt and validated by age
alone. So a verification link mailed to a user was a password-reset credential,
and a reset link stayed live for its full seven days after the password had
already been set.

The happy-path cases at the bottom are the most important ones here. Everything
else tightens account recovery; those are what show it still works.
"""

from redash.authentication.account import (
    INVITE_SALT,
    invite_token,
    reset_link_for_user,
    verify_link_for_user,
)
from redash.models import User, db
from redash.utils import json_dumps
from tests import BaseTestCase

PASSWORD = "test1234"
NEW_PASSWORD = "test5678"


def token_from(link):
    return link.rsplit("/", 1)[-1]


class JsonTokenTestCase(BaseTestCase):
    """BaseTestCase.post_request sends form data.

    The /api/invite and /api/reset handlers read request.get_json(force=True),
    which returns None for a form body, so a form POST reaches them with no
    password and answers 400 for that reason instead of the one under test.
    Every 400 here would have been a false pass.
    """

    def post_json(self, path, payload):
        return self.client.post(
            "/{}{}".format(self.factory.org.slug, path),
            data=json_dumps(payload),
            content_type="application/json",
        )


class TestTokenPurposeIsScoped(BaseTestCase):
    def test_a_verify_token_is_not_a_reset_credential(self):
        """The replay the missing salt allowed."""
        user = self.factory.create_user(is_invitation_pending=False)
        token = token_from(verify_link_for_user(user))

        response = self.get_request("/reset/{}".format(token), org=self.factory.org)

        self.assertEqual(400, response.status_code)

    def test_a_verify_token_is_not_a_reset_credential_on_the_json_path(self):
        user = self.factory.create_user(is_invitation_pending=False)
        token = token_from(verify_link_for_user(user))

        response = self.get_request("/api/reset/{}".format(token), org=self.factory.org)

        self.assertEqual(400, response.status_code)

    def test_an_invite_token_is_not_a_reset_credential(self):
        user = self.factory.create_user(is_invitation_pending=True)
        token = invite_token(user, salt=INVITE_SALT)

        response = self.get_request("/api/reset/{}".format(token), org=self.factory.org)

        self.assertEqual(400, response.status_code)

    def test_a_reset_token_still_works_on_the_reset_path(self):
        """The other direction, so the salts are not simply refusing everything."""
        user = self.factory.create_user(is_invitation_pending=False)
        token = token_from(reset_link_for_user(user))

        response = self.get_request("/api/reset/{}".format(token), org=self.factory.org)

        self.assertEqual(200, response.status_code)


class TestTokenDiesOnUse(JsonTokenTestCase):
    def test_a_reset_token_is_refused_after_the_password_is_set(self):
        user = self.factory.create_user(is_invitation_pending=False)
        token = token_from(reset_link_for_user(user))

        first = self.post_json("/api/reset/{}".format(token), {"password": NEW_PASSWORD})
        self.assertEqual(200, first.status_code)

        replay = self.post_json("/api/reset/{}".format(token), {"password": "somethingelse"})

        self.assertEqual(400, replay.status_code)
        # And the replay did not change anything on the way to being refused.
        self.assertTrue(User.query.get(user.id).verify_password(NEW_PASSWORD))

    def test_an_invite_token_is_refused_after_the_invite_is_accepted(self):
        user = self.factory.create_user(is_invitation_pending=True)
        token = invite_token(user, salt=INVITE_SALT)

        first = self.post_json("/api/invite/{}".format(token), {"password": PASSWORD})
        self.assertEqual(200, first.status_code)

        replay = self.post_json("/api/invite/{}".format(token), {"password": NEW_PASSWORD})

        self.assertEqual(400, replay.status_code)
        self.assertTrue(User.query.get(user.id).verify_password(PASSWORD))


class TestJsonEndpointGuards(JsonTokenTestCase):
    def test_post_refuses_an_already_accepted_invitation(self):
        """The guard the JSON POST dropped. Its own GET sibling always had it."""
        user = self.factory.create_user(is_invitation_pending=False)
        token = invite_token(user, salt=INVITE_SALT)

        response = self.post_json("/api/invite/{}".format(token), {"password": NEW_PASSWORD})

        self.assertEqual(400, response.status_code)

    def test_get_answers_400_for_an_already_accepted_invitation(self):
        """Not 500. json_response takes one argument and this branch passed two."""
        user = self.factory.create_user(is_invitation_pending=False)
        token = invite_token(user, salt=INVITE_SALT)

        response = self.get_request("/api/invite/{}".format(token), org=self.factory.org)

        self.assertEqual(400, response.status_code)

    def test_a_disabled_user_cannot_accept_an_invite(self):
        user = self.factory.create_user(is_invitation_pending=True)
        token = invite_token(user, salt=INVITE_SALT)
        user.disable()
        db.session.add(user)
        db.session.commit()

        response = self.post_json("/api/invite/{}".format(token), {"password": NEW_PASSWORD})

        self.assertEqual(400, response.status_code)
        self.assertFalse(User.query.get(user.id).verify_password(NEW_PASSWORD))

    def test_a_disabled_user_cannot_reset_on_the_html_path(self):
        user = self.factory.create_user(is_invitation_pending=False)
        token = token_from(reset_link_for_user(user))
        user.disable()
        db.session.add(user)
        db.session.commit()

        response = self.get_request("/reset/{}".format(token), org=self.factory.org)

        self.assertEqual(400, response.status_code)


class TestAccountRecoveryStillWorks(JsonTokenTestCase):
    """The cases that stand between this hardening and a broken recovery flow.

    Each completes a whole flow and then proves the password by using it, rather
    than asserting on an intermediate response.
    """

    def test_a_fresh_invite_sets_a_password(self):
        user = self.factory.create_user(is_invitation_pending=True)
        token = invite_token(user, salt=INVITE_SALT)

        opened = self.get_request("/api/invite/{}".format(token), org=self.factory.org)
        self.assertEqual(200, opened.status_code)

        accepted = self.post_json("/api/invite/{}".format(token), {"password": PASSWORD})
        self.assertEqual(200, accepted.status_code)

        stored = User.query.get(user.id)
        self.assertTrue(stored.verify_password(PASSWORD))
        self.assertFalse(stored.is_invitation_pending)

    def test_a_fresh_reset_changes_a_password(self):
        user = self.factory.create_user(is_invitation_pending=False)
        user.hash_password(PASSWORD)
        db.session.add(user)
        db.session.commit()
        token = token_from(reset_link_for_user(user))

        opened = self.get_request("/api/reset/{}".format(token), org=self.factory.org)
        self.assertEqual(200, opened.status_code)

        changed = self.post_json("/api/reset/{}".format(token), {"password": NEW_PASSWORD})
        self.assertEqual(200, changed.status_code)

        stored = User.query.get(user.id)
        self.assertTrue(stored.verify_password(NEW_PASSWORD))
        self.assertFalse(stored.verify_password(PASSWORD))

    def test_a_fresh_verify_link_still_verifies_the_email(self):
        user = self.factory.create_user(is_email_verified=False)
        token = token_from(verify_link_for_user(user))

        response = self.get_request("/verify/{}".format(token), org=self.factory.org)

        self.assertEqual(200, response.status_code)
        self.assertTrue(User.query.get(user.id).is_email_verified)

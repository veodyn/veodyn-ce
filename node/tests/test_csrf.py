"""CSRF enforcement for session-authenticated requests.

The check in redash/security.py is a single conditional, and the Flask-Login
session key it tests was renamed between 0.4.x and 0.5.0. The un-prefixed
spelling survived the upgrade to 0.6.0, which turned the check into dead code
for every session-authenticated request without failing a test, a lint or a
startup check. These three cases pin the behaviour so the next upgrade of
flask-login, flask-wtf or flask cannot repeat it silently.

Do not delete or skip this module to make an upgrade pass.
"""

import os
import subprocess
import sys
from unittest import TestCase

from redash import settings
from redash.app import create_app
from redash.utils import json_dumps
from tests import BaseTestCase, authenticate_request, get_test_app


class TestEnforceCsrfDefault(TestCase):
    """The default is not observable from the cases below, so it gets its own.

    tests/__init__.py sets REDASH_ENFORCE_CSRF=false for the whole suite and
    get_csrf_app forces the setting on regardless, which is what makes those
    cases testable at all. The consequence is that flipping the shipped default
    back to "false" passes every one of them. This reads it in a clean
    interpreter with the variable absent, which is the only place it shows.
    """

    def test_the_shipped_default_is_on(self):
        env = {k: v for k, v in os.environ.items() if k != "REDASH_ENFORCE_CSRF"}
        env["REDASH_COOKIE_SECRET"] = "test-secret-for-import"

        result = subprocess.run(
            [sys.executable, "-c", "from redash import settings; print(settings.ENFORCE_CSRF)"],
            capture_output=True,
            text=True,
            env=env,
            check=True,
        )

        self.assertEqual("True", result.stdout.strip())

_csrf_app = None


def get_csrf_app():
    """An app built while ENFORCE_CSRF is on.

    tests/__init__.py sets REDASH_ENFORCE_CSRF=false for the whole suite, and
    security.init_app decides at app-creation time whether to register the
    before_request hook at all. The setting therefore cannot be flipped after
    the fact, so exercising the check needs an app of its own. The schema and
    the database are the shared ones; this adds an app, not a fixture.
    """
    global _csrf_app
    if _csrf_app is None:
        get_test_app()  # build the shared schema before a second app binds to it
        original = settings.ENFORCE_CSRF
        settings.ENFORCE_CSRF = True
        try:
            app = create_app()
        finally:
            settings.ENFORCE_CSRF = original
        app.config["TESTING"] = True
        _csrf_app = app
    return _csrf_app


class CsrfTestCase(BaseTestCase):
    """BaseTestCase against the CSRF-enforcing app.

    Only the app and its context differ. The schema reset, the factories and
    the disabled limiter are all BaseTestCase's.
    """

    def setUp(self):
        super().setUp()
        self.app_ctx.pop()
        self.app = get_csrf_app()
        self.app_ctx = self.app.app_context()
        self.app_ctx.push()
        self.client = self.app.test_client()

    def queries_path(self):
        return "/{}/api/queries".format(self.factory.org.slug)

    def post_query(self, client, path=None, headers=None):
        """POST a state-changing endpoint. Returns the response."""
        payload = {
            "name": "CSRF probe",
            "query": "SELECT 1",
            "data_source_id": self.factory.data_source.id,
        }
        return client.post(
            path or self.queries_path(),
            data=json_dumps(payload),
            content_type="application/json",
            headers=headers or {},
        )

    def test_api_key_authenticated_post_needs_no_csrf_token(self):
        """API-key requests are deliberately exempt. This is what must not regress."""
        # A client of its own, so no session cookie left by an earlier request
        # can carry this to a pass for the wrong reason: the exemption is only
        # meaningful if this request really is API-key authenticated.
        client = self.app.test_client()
        path = "{}?api_key={}".format(self.queries_path(), self.factory.user.api_key)

        response = self.post_query(client, path=path)

        self.assertEqual(200, response.status_code)
        with client.session_transaction() as sess:
            self.assertNotIn("_user_id", sess)

    def test_session_authenticated_post_without_csrf_token_is_rejected(self):
        """The case the un-prefixed session key silently allowed."""
        client = self.app.test_client()
        authenticate_request(client, self.factory.user)

        response = self.post_query(client)

        self.assertEqual(400, response.status_code)

    def test_session_authenticated_post_with_csrf_token_succeeds(self):
        """The token the frontend forwards as X-CSRF-TOKEN is accepted."""
        client = self.app.test_client()
        authenticate_request(client, self.factory.user)
        # Any prior response carries the cookie; inject_csrf_token sets it on
        # every one of them.
        client.get("/{}/api/session".format(self.factory.org.slug))
        token = client.get_cookie("csrf_token").value

        response = self.post_query(client, headers={"X-CSRF-TOKEN": token})

        self.assertEqual(200, response.status_code)

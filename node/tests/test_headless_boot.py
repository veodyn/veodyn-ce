"""Proves the Flask app boots and serves with no client build present at all.

The fork used to be its own UI: STATIC_ASSETS_PATH pointed at client/dist/,
and FLASK_TEMPLATE_PATH defaulted to the same directory, so template lookup
(multi_org.html) and static_folder both depended on a webpack build having
happened first. That is what the test suite's client-dist stub files existed
to paper over.

With handlers/static.py and handlers/embed.py no longer serving any part of
the SPA, and FLASK_TEMPLATE_PATH pointed at the fork's own templates/
directory instead of STATIC_ASSETS_PATH (redash/settings/__init__.py), none
of that should be true anymore. This file proves it directly by pointing
STATIC_ASSETS_PATH at a directory that does not exist and confirming the app
still boots and serves normally.
"""

import importlib
import os
from unittest.mock import patch

from flask import render_template

from redash import settings
from tests import BaseTestCase

NONEXISTENT_STATIC_ASSETS_PATH = "/nonexistent/redash-client-dist-for-tests"


class TestHeadlessBoot(BaseTestCase):
    def setUp(self):
        # Patched only around app construction: Flask reads STATIC_ASSETS_PATH
        # once, in Redash.__init__ (redash/app.py), to set static_folder. It
        # does not need to stay patched after that; the point is that
        # construction and every request below succeed despite the path
        # never existing on disk.
        with patch("redash.settings.STATIC_ASSETS_PATH", NONEXISTENT_STATIC_ASSETS_PATH):
            super().setUp()

    def test_root_returns_404_json_when_ui_base_url_is_unset(self):
        with patch("redash.settings.UI_BASE_URL", ""):
            res = self.make_request("get", "/", user=False, is_json=False)

        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.mimetype, "application/json")
        body = res.get_json()
        self.assertIn("no_ui", body["error"])
        self.assertIn("UI_BASE_URL", body["message"])

    def test_root_redirects_to_ui_base_url_when_set(self):
        with patch("redash.settings.UI_BASE_URL", "https://app.example.com"):
            res = self.make_request("get", "/", user=False, is_json=False)

        self.assertEqual(res.status_code, 302)
        self.assertEqual(res.location, "https://app.example.com")

    def test_default_ui_base_url_does_not_redirect_to_host(self):
        # The other two UI_BASE_URL cases above patch settings.UI_BASE_URL
        # directly, which bypasses the initializer in settings/__init__.py
        # and so cannot see a bug in that initializer itself. This one
        # exercises it for real: REDASH_UI_BASE_URL unset, REDASH_HOST set,
        # same as production. UI_BASE_URL must stay empty, not fall back to
        # HOST, or "/" redirects to itself forever.
        original_ui_base_url = os.environ.pop("REDASH_UI_BASE_URL", None)
        os.environ["REDASH_HOST"] = "http://localhost:5001"
        try:
            importlib.reload(settings)
            self.assertEqual(settings.UI_BASE_URL, "")

            with patch("redash.settings.STATIC_ASSETS_PATH", NONEXISTENT_STATIC_ASSETS_PATH):
                res = self.make_request("get", "/", user=False, is_json=False)

            self.assertEqual(res.status_code, 404)
            self.assertNotEqual(res.status_code, 302)
        finally:
            if original_ui_base_url is not None:
                os.environ["REDASH_UI_BASE_URL"] = original_ui_base_url
            importlib.reload(settings)

    def test_known_api_endpoint_still_works(self):
        res = self.make_request("get", "/api/dashboards")

        self.assertEqual(res.status_code, 200)
        self.assertIn("results", res.json)

    def test_login_page_renders_with_no_client_build(self):
        res = self.make_request("get", "/login", user=False, is_json=False)

        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)
        self.assertNotIn("/static/images/", html)
        self.assertNotIn("asset_url", html)

    def test_multi_org_html_still_renders(self):
        # multi_org.html moved from client/app/ into the fork's own
        # templates/ directory (redash/templates/multi_org.html) so lookup no
        # longer depends on STATIC_ASSETS_PATH/client/dist existing. MULTI_ORG
        # is the condition under which this template used to be selected by
        # render_index(); patched explicitly here so the test does not rely
        # on the whole suite's forced MULTI_ORG env var to make its point.
        with patch("redash.settings.MULTI_ORG", True):
            html = render_template("multi_org.html", base_href="https://app.example.com/")

        self.assertIn("application-root", html)

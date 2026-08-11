"""Generated links must point at the product UI, not at this API.

The fork used to be its own UI, so base_url() returning REDASH_HOST was
correct. With the client removed, REDASH_HOST is an API origin that serves
no /queries/<id> or /alerts/<id> page, and every alert notification, failure
report and invite email would link into a hole.

REDASH_UI_BASE_URL defaults to REDASH_HOST so an unconfigured deployment
behaves exactly as before rather than silently emitting empty-host links.
"""

from unittest.mock import patch

from redash.utils import base_url


class TestUiBaseUrl:
    def test_prefers_the_ui_base_url_when_set(self):
        with patch("redash.settings.UI_BASE_URL", "https://app.example.com"), \
             patch("redash.settings.HOST", "https://api.example.com"), \
             patch("redash.settings.MULTI_ORG", False):
            assert base_url(None) == "https://app.example.com"

    def test_falls_back_to_host_when_unset(self):
        # An existing deployment that has not set the new variable keeps
        # working. This is what makes the change safe to ship ahead of the
        # deletion rather than in lockstep with it.
        with patch("redash.settings.UI_BASE_URL", ""), \
             patch("redash.settings.HOST", "https://api.example.com"), \
             patch("redash.settings.MULTI_ORG", False):
            assert base_url(None) == "https://api.example.com"

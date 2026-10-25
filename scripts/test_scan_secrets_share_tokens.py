import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parent / "scan_secrets_extra_allowlist.py"
_spec = importlib.util.spec_from_file_location("scan_secrets_extra_allowlist", MODULE_PATH)
allowlist = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(allowlist)

TOKEN = "Ab3d" * 10
SITE_VALUES = "helm/envs/site-dev/site-app.yaml"


class TestSiteShareTokens(unittest.TestCase):
    def test_a_share_token_line_in_a_site_values_file_is_excused(self):
        line = f'    SITE_DASH_HOME_MAP: "{TOKEN}"'
        self.assertTrue(allowlist.is_site_share_token(SITE_VALUES, TOKEN, line))
        self.assertTrue(allowlist.is_site_share_token("helm/envs/site-prod/site-app.yaml", TOKEN, line))

    def test_the_same_line_in_any_other_file_is_not(self):
        line = f'    SITE_DASH_HOME_MAP: "{TOKEN}"'
        for path in ["helm/envs/frontend-dev/frontend-app.yaml", "site/.env.example", "helm/envs/site-dev/values.yaml"]:
            with self.subTest(path=path):
                self.assertFalse(allowlist.is_site_share_token(path, TOKEN, line))

    def test_another_key_or_shape_in_the_site_values_file_is_not(self):
        for line in [
            f'    VEODYN_API_KEY: "{TOKEN}"',
            f'    SITE_DASH_HOME_MAP: "{TOKEN}" # extra',
            f'    SITE_DASH_HOME_MAP: "{TOKEN}x"',
            f'    SITE_DASH_HOME_MAP: {TOKEN}',
        ]:
            with self.subTest(line=line):
                self.assertFalse(allowlist.is_site_share_token(SITE_VALUES, TOKEN, line))

    def test_the_literal_must_be_the_token_on_that_line(self):
        line = f'    SITE_DASH_HOME_MAP: "{TOKEN}"'
        self.assertFalse(allowlist.is_site_share_token(SITE_VALUES, TOKEN[::-1], line))


if __name__ == "__main__":
    unittest.main()

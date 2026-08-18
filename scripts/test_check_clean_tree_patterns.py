"""Shape-rule tests for scripts/check-clean-tree.py.

Split out of scripts/test_check_clean_tree.py for file size, alongside
test_check_clean_tree_declarations.py, and discovered by the same
`test_check_clean_tree*.py` wildcard in ci/scan-secrets.yaml.

PATTERN_RULES are the detectors that name nothing: an email address at a
domain built from a harvested term, a clone URL authenticated with the
pipeline's job token, a container image path with a literal namespace under a
variable host. Their findings are fatal, and OPEN_PATTERN_SITES is the only
thing that can absorb one.

That tuple is empty in the shipped manifest, both rules having reached zero
sites, so the tests for its count and staleness paths run against a stub
declared here rather than off an empty tuple, which would assert nothing.

No identity term is written into this file; see clean_tree_test_support.py.

    python3 -m unittest discover -s scripts -p "test_check_clean_tree*.py"
"""

import tempfile
import unittest
from pathlib import Path

from clean_tree_test_support import PLANTABLE
from clean_tree_test_support import gate, manifest, scan_repo


class TestPatternRules(unittest.TestCase):
    def test_tenant_email_fires_and_an_undeclared_site_is_fatal(self):
        with tempfile.TemporaryDirectory() as tmp:
            _counts, _sites, pattern_hits, _text, _names = scan_repo(
                Path(tmp), {"conf.py": f'OWNER = "ops@{PLANTABLE}.net"\n'}
            )

            self.assertIn(("conf.py", 1, "tenant-email"), pattern_hits)
            fatal, over, empty = gate.check_pattern_hits(pattern_hits, manifest)
            self.assertIn(("conf.py", 1, "tenant-email"), fatal)
            self.assertEqual(over, [])
            # OPEN_PATTERN_SITES is empty in the shipped manifest, so there is no
            # declaration to go stale here. TestDeclaredSites uses a stub instead.
            self.assertEqual(empty, [])

    def test_ci_token_clone_and_registry_namespace_fire(self):
        with tempfile.TemporaryDirectory() as tmp:
            _c, _s, pattern_hits, _text, _names = scan_repo(
                Path(tmp),
                {
                    "pipe.yml": "  - git clone https://gitlab-ci-token:${CI_JOB_TOKEN}@host/g/p.git\n"
                    '  IMAGE: "${CI_HARBOR_REGISTRY_HOST}/some-namespace/app"\n'
                },
            )

            self.assertEqual(
                sorted(rule for _p, _l, rule in pattern_hits), ["ci-token-clone", "registry-namespace"]
            )

    def test_the_shipped_manifest_declares_no_open_pattern_site(self):
        # The two tests below run against a stub, so a declaration reappearing in
        # the manifest without them being pointed back at it would go untested.
        self.assertEqual(manifest.OPEN_PATTERN_SITES, ())


class _StubManifest:
    """The declarations check_pattern_hits() reads, and nothing else.

    OPEN_PATTERN_SITES is empty in the shipped manifest, so the count and staleness
    paths have no real site left to exercise.
    """

    OPEN_PATTERN_SITES = (("conf/thing.yml", "registry-namespace", 2, "a declared site, for the test"),)


class TestDeclaredSites(unittest.TestCase):
    def test_a_declared_site_at_its_exact_count_is_not_a_finding(self):
        hits = [("conf/thing.yml", line, "registry-namespace") for line in (4, 9)]

        fatal, over, empty = gate.check_pattern_hits(hits, _StubManifest)

        self.assertEqual((fatal, over, empty), ([], [], []))

    def test_a_declared_site_that_gains_one_more_occurrence_fails(self):
        hits = [("conf/thing.yml", line, "registry-namespace") for line in (4, 9, 14)]

        _fatal, over, _empty = gate.check_pattern_hits(hits, _StubManifest)

        self.assertIn(("conf/thing.yml", "registry-namespace", 2, 3), over)

    def test_a_declared_site_that_matches_nothing_fails_as_stale(self):
        _fatal, _over, empty = gate.check_pattern_hits([], _StubManifest)

        self.assertEqual(empty, [("conf/thing.yml", "registry-namespace")])


if __name__ == "__main__":
    unittest.main()

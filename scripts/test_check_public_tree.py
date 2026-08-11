"""Unit tests for scripts/check-public-tree.py.

The point these tests exist to make: a guard that has only ever been watched
pass is indistinguishable from a guard that does nothing. Asserting that the
checker exits clean against the real repository would keep passing if
FORBIDDEN_PATHS were emptied, if path_matches always returned False, or if
`git ls-files` were reading the wrong directory. So every test here that
matters builds a throwaway git repository, plants a path the manifest
forbids, and asserts the checker rejects that tree and names the path it
found.

Two of them cover the ways this guard could quietly stop guarding rather
than a path anyone plants:

- `test_empty_repository_exits_2` covers passing vacuously. A checkout where
  git lists nothing tracked must fail, not report a clean tree.
- `test_every_phase_3_deletion_is_covered` covers the manifest drifting away
  from what it was derived from. It replays a sample of the files the Phase 3
  deletion actually removed and requires each to match some entry, so
  dropping an entry fails here rather than the next time somebody merges.

Stdlib-only, no pytest, same as scripts/test_scan_secrets.py: this runs on
the bare python image the CI job uses, with nothing installed.

Run with:
    python3 scripts/test_check_public_tree.py
    python3 -m unittest discover -s scripts -p "test_check_public_tree.py"
"""

import contextlib
import importlib.util
import io
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


checker = _load(SCRIPTS_DIR / "check-public-tree.py", "check_public_tree_under_test")
manifest = _load(SCRIPTS_DIR / "public_tree_forbidden_paths.py", "public_tree_forbidden_paths_under_test")

# A sample of what `git diff --diff-filter=D --name-only 06a33c5..06099fa`
# lists, one per manifest entry, kept as literal paths rather than read back
# out of git: the assertion is about what the manifest covers, and it should
# hold in a checkout with no history reachable (a CI clone with a shallow
# fetch, or the public repository once it is squashed).
PHASE_3_DELETIONS = (
    "helm/envs/secrets",
    "helm/envs/veodyn-api-prod/values.yaml",
    "helm/depends/seed_flow_dev.sh",
    "helm/depends/vars/veodyn-de/flow-prod-values.yml",
    "helm/deploy.sh",
    "ci/init-prod.yaml",
    "ci/init-dev.yaml",
    "docs/bug-evidence/VD-002-archive-search-ignored.png",
    "docs/bugs.md",
    "docs/coverage.md",
    "docs/dev-redash.md",
    "docs/local-la-metro-stack.md",
    "product-critic-output/report.md",
    ".harness/reflections/2026-07-26.md",
    ".mcp.json",
)


def git(root, *args):
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


def make_repo(root, tracked=(), untracked=(), gitignore=None):
    """Build a throwaway repository. `tracked` files are written and staged
    (staged, not committed: `git ls-files` lists the index, so no commit and
    therefore no user.name/user.email configuration is needed, which keeps
    these tests runnable on a CI image with no git identity set).
    """
    git(root, "init", "-q")
    if gitignore is not None:
        (root / ".gitignore").write_text(gitignore)
    for rel_path in tracked:
        path = root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("placeholder\n")
    if tracked:
        git(root, "add", "--", *tracked)
    for rel_path in untracked:
        path = root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("placeholder\n")
    return root


class TestPlantedPathIsRejected(unittest.TestCase):
    def test_tracked_forbidden_path_is_found_and_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo(Path(tmp), tracked=["README.md", "helm/envs/values-dev.yaml"])

            tracked_matches, untracked_matches = checker.check_tree(root, manifest.FORBIDDEN_PATHS)

            self.assertEqual(untracked_matches, [])
            self.assertEqual(len(tracked_matches), 1)
            entry, reason, matched = tracked_matches[0]
            self.assertEqual(entry, "helm/envs/")
            self.assertEqual(matched, ["helm/envs/values-dev.yaml"])
            self.assertTrue(reason)

    def test_report_prints_the_offending_path(self):
        # The finding is worth nothing if the operator cannot see which file
        # tripped it, so assert on the printed report, not just the return
        # value. Also asserts the report does NOT open the file: the word
        # "placeholder" is this fixture's file content.
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo(Path(tmp), tracked=["README.md", "helm/envs/secrets"])
            tracked_matches, _ = checker.check_tree(root, manifest.FORBIDDEN_PATHS)

            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                checker._print_matches("heading", tracked_matches, "remedy")
            output = buffer.getvalue()

            self.assertIn("helm/envs/secrets", output)
            self.assertIn("helm/envs/", output)
            self.assertNotIn("placeholder", output)

    def test_untracked_forbidden_path_is_found_separately(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo(Path(tmp), tracked=["README.md"], untracked=[".mcp.json"])

            tracked_matches, untracked_matches = checker.check_tree(root, manifest.FORBIDDEN_PATHS)

            self.assertEqual(tracked_matches, [])
            self.assertEqual([entry for entry, _, _ in untracked_matches], [".mcp.json"])

    def test_gitignored_forbidden_path_is_not_reported(self):
        # Git already refuses to publish an ignored path. Failing on one
        # would only teach people to weaken this script.
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo(
                Path(tmp),
                tracked=["README.md"],
                untracked=["product-critic-output/report.md"],
                gitignore="product-critic-output/\n",
            )

            tracked_matches, untracked_matches = checker.check_tree(root, manifest.FORBIDDEN_PATHS)

            self.assertEqual(tracked_matches, [])
            self.assertEqual(untracked_matches, [])

    def test_clean_tree_reports_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo(Path(tmp), tracked=["README.md", "helm/charts/app/values.yaml"])

            self.assertEqual(checker.check_tree(root, manifest.FORBIDDEN_PATHS), ([], []))


class TestGuardCannotPassVacuously(unittest.TestCase):
    def test_empty_repository_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo(Path(tmp))

            with self.assertRaises(SystemExit) as ctx:
                checker.check_tree(root, manifest.FORBIDDEN_PATHS)
            self.assertEqual(ctx.exception.code, checker.EXIT_CANNOT_CHECK)

    def test_missing_manifest_module_exits_2(self):
        with self.assertRaises(SystemExit) as ctx:
            checker._load_by_path("gone", SCRIPTS_DIR / "no-such-manifest.py")
        self.assertEqual(ctx.exception.code, checker.EXIT_CANNOT_CHECK)


class TestExportMode(unittest.TestCase):
    """`--export` checks the deferred paths as well, because a deferral does not travel.

    DEFERRED_PATHS means "this repository may still hold it". The exported tree
    is a different repository, it needs none of what is deferred, and under a
    private-first flip its whole history publishes at once, so a deferred path
    committed to the export and deleted before the flip is still published.
    """

    def test_a_deferred_path_passes_by_default_and_fails_on_export(self):
        self.assertTrue(manifest.DEFERRED_PATHS, "no deferred paths left; this test is now vacuous")
        deferred_entry = manifest.DEFERRED_PATHS[0][0]
        planted = f"{deferred_entry.rstrip('/')}/planted.md"

        with tempfile.TemporaryDirectory() as tmp:
            root = make_repo(Path(tmp), tracked=["README.md", planted])

            self.assertEqual(checker.check_tree(root, manifest.FORBIDDEN_PATHS), ([], []))

            tracked, _ = checker.check_tree(
                root, tuple(manifest.FORBIDDEN_PATHS) + tuple(manifest.DEFERRED_PATHS)
            )
            self.assertEqual([entry for entry, _, _ in tracked], [deferred_entry])
            self.assertEqual([matched for _, _, matched in tracked], [[planted]])

    def test_export_does_not_narrow_what_the_default_run_checks(self):
        # The flag may only ADD. A version that swapped one list for the other
        # would let every ordinary forbidden path through on the export, which
        # is the run where it matters most.
        combined = tuple(manifest.FORBIDDEN_PATHS) + tuple(manifest.DEFERRED_PATHS)
        for entry in manifest.FORBIDDEN_PATHS:
            self.assertIn(entry, combined)


class TestMatchingRule(unittest.TestCase):
    def test_trailing_slash_entry_matches_anything_beneath_it(self):
        self.assertTrue(checker.path_matches("helm/envs/veodyn-api-prod/values.yaml", "helm/envs/"))
        self.assertFalse(checker.path_matches("helm/charts/redash/values.yaml", "helm/envs/"))

    def test_entry_without_a_trailing_slash_matches_exactly(self):
        self.assertTrue(checker.path_matches("docs/bugs.md", "docs/bugs.md"))
        # A prefix rule would have claimed this file, which nobody decided
        # anything about.
        self.assertFalse(checker.path_matches("docs/bugs-triage.md", "docs/bugs.md"))


class TestManifest(unittest.TestCase):
    def test_every_phase_3_deletion_is_covered(self):
        entries = [entry for entry, _ in manifest.FORBIDDEN_PATHS]
        for rel_path in PHASE_3_DELETIONS:
            with self.subTest(rel_path=rel_path):
                self.assertTrue(
                    any(checker.path_matches(rel_path, entry) for entry in entries),
                    f"{rel_path} was deleted in Phase 3 but no manifest entry covers it",
                )

    def test_every_entry_states_a_reason(self):
        for entry, reason in manifest.FORBIDDEN_PATHS + manifest.DEFERRED_PATHS:
            with self.subTest(entry=entry):
                self.assertTrue(entry)
                self.assertTrue(reason.strip())

    def test_no_path_is_both_forbidden_and_deferred(self):
        forbidden = {entry for entry, _ in manifest.FORBIDDEN_PATHS}
        deferred = {entry for entry, _ in manifest.DEFERRED_PATHS}
        self.assertEqual(forbidden & deferred, set())

    # No test here that the manifest holds no credential-shaped literal:
    # scripts/scan-secrets.py already walks every tracked text file in this
    # repository, this one included, and a second copy of that rule scoped to
    # one file would only be a second place to keep it right.


if __name__ == "__main__":
    unittest.main()

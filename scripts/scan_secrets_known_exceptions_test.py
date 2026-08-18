"""KNOWN_EXCEPTIONS test cases for scripts/test_scan_secrets.py.

This filename does not match unittest discover's `test_scan_secrets.py`
pattern, so nothing collects it directly. It runs because
test_scan_secrets.py imports these TestCase classes into its own namespace
and unittest's default loader collects any TestCase reachable there.

Covers suppression, the printed report, and the position-and-shape identity
guard, along with that guard's accepted limit (see
test_exception_does_not_catch_same_line_same_shape_substitution). Uses a
scratch temp-dir copy of an excepted path, never the real helm/ files, and
only obviously-fake repeated-character literals.

Also carries the expiry guard for the other allowlist,
scripts/scan_secrets_extra_allowlist.py's EXTRA_ALLOWLISTED_LITERALS, beside
its KNOWN_EXCEPTIONS counterpart: both exist only to fail when an entry
outlives the file it was written for.
"""

import tempfile
import unittest
from pathlib import Path

from scan_secrets_test_support import (
    REPO_ROOT,
    _credential_scan_real,
    fake_credential_scan,
    full_coverage_tree,
    scan_secrets,
    shape_description,
)


def _position(lineno, literal):
    return (lineno, f"credential-shaped: {shape_description(literal)}")


class TestKnownExceptions(unittest.TestCase):
    # All three are hex-shaped, so only length distinguishes them in a shape
    # descriptor: A and SAME_SHAPE are 24 chars, DIFFERENT_SHAPE is 40.
    _FAKE_LITERAL_A = "a" * 24
    _FAKE_LITERAL_SAME_SHAPE = "b" * 24
    _FAKE_LITERAL_DIFFERENT_SHAPE = "c" * 40

    def _scratch_tree(self, tmp, secrets_file_text):
        root = Path(tmp)
        except_dir = root / "helm" / "envs"
        except_dir.mkdir(parents=True)
        (except_dir / "secrets").write_text(secrets_file_text)
        rel_paths = full_coverage_tree(root, extra_rel_paths=["helm/envs/secrets"])
        return root, rel_paths

    def test_exception_suppresses_finding_and_records_the_position(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, rel_paths = self._scratch_tree(tmp, f"leaked: {self._FAKE_LITERAL_A}\n")
            known_exceptions = (
                {
                    "path": "helm/envs/secrets",
                    "reason": "test reason",
                    "removed_by": "test phase",
                    "suppressed_positions": (_position(1, self._FAKE_LITERAL_A),),
                },
            )
            credential_scan = fake_credential_scan(root, rel_paths, known_exceptions=known_exceptions)

            _, findings, exception_report = scan_secrets.scan(credential_scan)

            self.assertEqual(findings, [])
            self.assertEqual(
                exception_report["helm/envs/secrets"]["suppressed_positions"],
                [_position(1, self._FAKE_LITERAL_A)],
            )
            self.assertEqual(scan_secrets._exceptions.print_exception_report(exception_report), [])

    def test_exception_fails_when_credential_is_substituted_with_a_different_shape(self):
        # The recorded literal is replaced by a longer one on the same line, so
        # the suppressed COUNT is unchanged but the shape descriptor is not.
        with tempfile.TemporaryDirectory() as tmp:
            root, rel_paths = self._scratch_tree(tmp, f"leaked: {self._FAKE_LITERAL_A}\n")
            known_exceptions = (
                {
                    "path": "helm/envs/secrets",
                    "reason": "test reason",
                    "removed_by": "test phase",
                    "suppressed_positions": (_position(1, self._FAKE_LITERAL_A),),
                },
            )
            credential_scan = fake_credential_scan(root, rel_paths, known_exceptions=known_exceptions)
            _, before_findings, before_report = scan_secrets.scan(credential_scan)
            self.assertEqual(before_findings, [])
            self.assertEqual(scan_secrets._exceptions.print_exception_report(before_report), [])

            (root / "helm" / "envs" / "secrets").write_text(f"leaked: {self._FAKE_LITERAL_DIFFERENT_SHAPE}\n")
            _, after_findings, after_report = scan_secrets.scan(credential_scan)

            self.assertEqual(after_findings, [])
            self.assertEqual(
                after_report["helm/envs/secrets"]["suppressed_positions"],
                [_position(1, self._FAKE_LITERAL_DIFFERENT_SHAPE)],
            )
            self.assertEqual(scan_secrets._exceptions.print_exception_report(after_report), ["helm/envs/secrets"])

    def test_exception_does_not_catch_same_line_same_shape_substitution(self):
        # The guard's accepted limit (see
        # credential_scan_known_exceptions.py's docstring): a same-line
        # substitution keeping the same shape and length is invisible to a
        # (line, shape) identity check, unlike a value hash. A failure here
        # means the guard grew a stronger check, so update those docstrings.
        with tempfile.TemporaryDirectory() as tmp:
            root, rel_paths = self._scratch_tree(tmp, f"leaked: {self._FAKE_LITERAL_A}\n")
            known_exceptions = (
                {
                    "path": "helm/envs/secrets",
                    "reason": "test reason",
                    "removed_by": "test phase",
                    "suppressed_positions": (_position(1, self._FAKE_LITERAL_A),),
                },
            )
            credential_scan = fake_credential_scan(root, rel_paths, known_exceptions=known_exceptions)
            scan_secrets.scan(credential_scan)

            (root / "helm" / "envs" / "secrets").write_text(f"leaked: {self._FAKE_LITERAL_SAME_SHAPE}\n")
            _, after_findings, after_report = scan_secrets.scan(credential_scan)

            self.assertEqual(after_findings, [])
            self.assertEqual(
                after_report["helm/envs/secrets"]["suppressed_positions"],
                [_position(1, self._FAKE_LITERAL_SAME_SHAPE)],
            )
            # Not a failure: the substituted literal's (line, shape) is what
            # was recorded, so the guard cannot tell the two apart.
            self.assertEqual(scan_secrets._exceptions.print_exception_report(after_report), [])

    def test_exception_fails_when_all_recorded_credentials_are_gone(self):
        # The file rotated to carry nothing credential-shaped at all. An
        # exception recorded against zero remaining matches must fail, or it
        # sits there able to absorb whatever lands in the file next.
        with tempfile.TemporaryDirectory() as tmp:
            root, rel_paths = self._scratch_tree(tmp, "nothing credential-shaped here\n")
            known_exceptions = (
                {
                    "path": "helm/envs/secrets",
                    "reason": "test reason",
                    "removed_by": "test phase",
                    "suppressed_positions": (_position(1, self._FAKE_LITERAL_A),),
                },
            )
            credential_scan = fake_credential_scan(root, rel_paths, known_exceptions=known_exceptions)

            _, findings, exception_report = scan_secrets.scan(credential_scan)

            self.assertEqual(findings, [])
            self.assertEqual(exception_report["helm/envs/secrets"]["suppressed_positions"], [])
            self.assertEqual(
                scan_secrets._exceptions.print_exception_report(exception_report), ["helm/envs/secrets"]
            )

    def test_exception_notes_but_does_not_fail_on_partial_rotation(self):
        # Two positions recorded, one still present. A partial rotation with
        # nothing NEW showing up is a note, not a failure.
        with tempfile.TemporaryDirectory() as tmp:
            root, rel_paths = self._scratch_tree(tmp, f"leaked: {self._FAKE_LITERAL_A}\n")
            known_exceptions = (
                {
                    "path": "helm/envs/secrets",
                    "reason": "test reason",
                    "removed_by": "test phase",
                    "suppressed_positions": (
                        _position(1, self._FAKE_LITERAL_A),
                        _position(2, self._FAKE_LITERAL_DIFFERENT_SHAPE),
                    ),
                },
            )
            credential_scan = fake_credential_scan(root, rel_paths, known_exceptions=known_exceptions)

            _, findings, exception_report = scan_secrets.scan(credential_scan)

            self.assertEqual(findings, [])
            self.assertEqual(
                exception_report["helm/envs/secrets"]["suppressed_positions"],
                [_position(1, self._FAKE_LITERAL_A)],
            )
            # Fewer than recorded, but not zero, and nothing unrecorded: a
            # note, not a failure.
            self.assertEqual(scan_secrets._exceptions.print_exception_report(exception_report), [])


class TestKnownExceptionsExpire(unittest.TestCase):
    def test_known_exception_paths_still_exist(self):
        # KNOWN_EXCEPTIONS names files carrying live deploy credentials the
        # scan skips until they leave this tree. This test's only job is to
        # fail at that moment. Do not fix a failure here by removing the
        # assertion; delete the KNOWN_EXCEPTIONS entry it points at.
        for exception in _credential_scan_real.KNOWN_EXCEPTIONS:
            path = REPO_ROOT / exception["path"]
            self.assertTrue(
                path.exists(),
                f"KNOWN_EXCEPTIONS path {exception['path']!r} no longer exists; delete this "
                "entry from KNOWN_EXCEPTIONS instead of leaving it as dead config",
            )


class TestExtraAllowlistExpires(unittest.TestCase):
    def test_extra_allowlisted_paths_still_exist(self):
        # The same expiry job as test_known_exception_paths_still_exist, for
        # the other allowlist. EXTRA_ALLOWLISTED_LITERALS spells out the exact
        # values it excuses and scan-secrets.py skips that module in its own
        # scan (SELF_REL_PATHS), so nothing else can notice when an entry
        # outlives its file and leaves the value in a module nobody scans. Do
        # not fix a failure here by removing the assertion or loosening the
        # path check; delete the entry it points at, which takes the value out
        # of the tree with it.
        #
        # Matched by suffix against TRACKED paths, the same question the scan
        # asks: a file on disk but untracked is never scanned, so it excuses
        # nothing.
        _, tracked_rel_paths = _credential_scan_real.discover_tracked_text_files()
        for index, (path_suffix, _literal) in enumerate(scan_secrets._extra_allowlist.EXTRA_ALLOWLISTED_LITERALS):
            self.assertTrue(
                any(rel_path.endswith(path_suffix) for rel_path in tracked_rel_paths),
                f"EXTRA_ALLOWLISTED_LITERALS entry {index} is scoped to {path_suffix!r}, and no "
                "tracked file's path ends with that any more; delete this entry from "
                "EXTRA_ALLOWLISTED_LITERALS instead of leaving it as dead config that keeps its "
                "literal in a module the scan does not read",
            )


# Without this block, `python3 scripts/scan_secrets_known_exceptions_test.py`
# imports this module, runs no tests, and exits 0. This file is named
# `*_test.py` while two of the discover lines in ci/scan-secrets.yaml match
# `test_*.py`; the third one is what covers it there.
if __name__ == "__main__":
    unittest.main()

"""KNOWN_EXCEPTIONS test cases for scripts/test_scan_secrets.py.

Split out purely for the file-size hook: not itself collected by unittest
discover's `test_scan_secrets.py` pattern (this filename does not match
it), but test_scan_secrets.py imports these TestCase classes into its own
module namespace, and unittest's default loader collects any TestCase
subclass reachable there, imported or not, so they still run under both
`python3 scripts/test_scan_secrets.py` and
`python3 -m unittest discover -s scripts -p "test_scan_secrets.py"`.

Covers the KNOWN_EXCEPTIONS mechanism: suppression, the printed report, and
the position-and-shape identity guard that stops an excepted file absorbing
a substituted or newly added credential silently, along with the guard's
known, accepted limit (see
test_exception_does_not_catch_same_line_same_shape_substitution below). Uses
a scratch temp-dir copy of an excepted path, never the real helm/ files, and
only ever obviously-fake, repeated-character literals, never a real
credential shape borrowed from the real tree.

Also carries the expiry guard for the OTHER allowlist,
scripts/scan_secrets_extra_allowlist.py's EXTRA_ALLOWLISTED_LITERALS, which
sits here beside its KNOWN_EXCEPTIONS counterpart so the pair is found
together: both exist only to fail when an entry outlives the file it was
written for.
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
    # All three fake literals are hex-shaped (`_HEX_SHAPE` matches any run
    # of hex digits, and 'a', 'b', 'c' all are hex digits), so the only
    # thing distinguishing them in a shape descriptor is length:
    # _FAKE_LITERAL_A and _FAKE_LITERAL_SAME_SHAPE are both 24 chars (same
    # shape descriptor, different value); _FAKE_LITERAL_DIFFERENT_SHAPE is
    # 40 chars (a different shape descriptor).
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
        # BEFORE: the scratch file has exactly the recorded literal and the
        # guard does not fire. AFTER: that literal is replaced by a longer
        # one on the same line, so the suppressed COUNT is unchanged but the
        # shape descriptor is not (24 chars vs 40 chars). This is the
        # substitution shape the guard is documented to catch.
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
        # Documents the guard's known, accepted limit (see
        # credential_scan_known_exceptions.py's docstring): a same-line
        # substitution that keeps the same shape and length is invisible to
        # a (line, shape) identity check, unlike a value hash. If this ever
        # starts failing, either the guard grew a stronger check (update the
        # docstrings that promise it does not) or something else broke.
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
            # Not a failure: the substituted literal's (line, shape) is
            # identical to what was recorded, so the guard cannot tell the
            # two literals apart. This is the accepted gap, not a bug.
            self.assertEqual(scan_secrets._exceptions.print_exception_report(after_report), [])

    def test_exception_fails_when_all_recorded_credentials_are_gone(self):
        # The file rotated to carry nothing credential-shaped at all. A
        # stale exception recorded against zero remaining matches must not
        # sit there able to silently absorb whatever lands in the file next;
        # this used to only print a note.
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
        # Two positions were recorded; only one is still present (the other
        # names a line/shape this one-line file never had). A legitimate
        # partial rotation (nothing NEW showed up) should only note that
        # suppressed_positions is stale, not fail.
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
        # Purpose of this test: KNOWN_EXCEPTIONS names files carrying live
        # deploy credentials that the scan is told to skip until Phase 3
        # (the deploy repo extraction) moves them out of this tree. This
        # test's only job is to fail once that move happens, forcing the
        # stale KNOWN_EXCEPTIONS entry to be deleted rather than left behind
        # as dead config forever. Do not "fix" a failure here by removing
        # this assertion; delete the KNOWN_EXCEPTIONS entry it points at.
        for exception in _credential_scan_real.KNOWN_EXCEPTIONS:
            path = REPO_ROOT / exception["path"]
            self.assertTrue(
                path.exists(),
                f"KNOWN_EXCEPTIONS path {exception['path']!r} no longer exists; delete this "
                "entry from KNOWN_EXCEPTIONS instead of leaving it as dead config",
            )


class TestExtraAllowlistExpires(unittest.TestCase):
    def test_extra_allowlisted_paths_still_exist(self):
        # Purpose of this test: the same expiry job as
        # test_known_exception_paths_still_exist above, for the other
        # allowlist. EXTRA_ALLOWLISTED_LITERALS spells out the exact values
        # it excuses, and scan-secrets.py deliberately skips that module in
        # its own scan (see SELF_REL_PATHS) because an allowlist always
        # self-matches. So nothing else in this repo can notice when an
        # entry outlives the file it was written for, and several entries
        # are scoped to a tree that is scheduled for deletion at the Phase 5
        # cutover. Left unchecked, that deletion leaves the values sitting
        # in a module nobody scans, excused by entries pointing at nothing.
        # This test's only job is to fail at that moment. Do not "fix" a
        # failure here by removing this assertion or by loosening the path
        # check; delete the EXTRA_ALLOWLISTED_LITERALS entry it points at,
        # which takes the value out of the tree with it.
        #
        # Entries are matched against scanned paths by suffix, so this asks
        # the same question the scan does: is there still a tracked file
        # whose path ends with this suffix? A path present on disk but not
        # tracked is never scanned, so it excuses nothing either.
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
# imports this module, runs no tests at all, and exits 0. That is how this
# file went unrun: it was invoked that way as a verification gate through two
# phases and reported green every time, while both expiry guards in it had
# never executed. Its siblings test_scan_secrets.py and
# test_check_public_tree.py have always carried this block.
#
# CI discovers by filename pattern, and this file is named `*_test.py` while
# both discover lines in ci/scan-secrets.yaml match `test_*.py`, so the
# pattern that runs its siblings has never matched it either. Both halves had
# to be wrong at once for this to stay invisible, and both were. See the
# third discover line in that job.
if __name__ == "__main__":
    unittest.main()

"""
Unit tests for scripts/scan-secrets.py's own guard against passing having
scanned nothing or having scanned only a narrowed slice of the tree, and for
its KNOWN_EXCEPTIONS handling (suppression, printing, and the position-and-
shape identity guard; see scan_secrets_known_exceptions_test.py, imported
below and split out purely for file size).

Regression coverage:

- The coverage sentinel used to check two prefixes (`app/`, `docs/`) and be
  satisfied by a single discovered-and-read file under each. That let a
  severely narrowed scan (hundreds of files under a prefix discovered, only
  one actually opened) still pass, and never proved `api/`, `node/`,
  `helm/`, `scripts/`, or root files were scanned at all. These tests cover
  every monitored prefix, a root-level file, and a narrowing that trips the
  coverage-ratio bar without ever reaching zero.

- KNOWN_EXCEPTIONS used to record only a suppressed-count; a run only failed
  when the count went up. A credential removed and a different one added in
  the same file left the count unchanged and was absorbed silently. A first
  fix recorded a sha256 digest of each suppressed literal instead, and that
  was reverted before ever reaching main: an unsalted hash of a short,
  human-chosen password is practically brute-forceable, which is
  unacceptable in a tree headed for a public repository. The guard now
  records (line number, shape descriptor) instead, which is weaker but
  derives nothing from the value; see
  node/tests/query_runner/credential_scan_known_exceptions.py's docstring
  for exactly what that does and does not catch, and
  scan_secrets_known_exceptions_test.py for the test cases.

Stdlib-only, no pytest: this test runs standalone on the host, same as
scan-secrets.py itself (poetry/pytest are not on the host PATH; see
scan-secrets.py's own module docstring for why it avoids the Redash
container).

Run with:
    python3 scripts/test_scan_secrets.py
    python3 -m unittest discover -s scripts -p "test_scan_secrets.py"
"""

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from scan_secrets_known_exceptions_test import (
    TestExtraAllowlistExpires,
    TestKnownExceptions,
    TestKnownExceptionsExpire,
)
from scan_secrets_test_support import (
    fake_credential_scan,
    full_coverage_tree,
    scan_secrets,
    write_prose,
    write_screenshots,
)

# Imported so unittest's default loader (which collects every TestCase
# subclass reachable in this module's namespace, not just ones defined
# here) picks them up under both run forms above. Referenced so lint does
# not flag the import as unused.
_ = (TestKnownExceptions, TestKnownExceptionsExpire, TestExtraAllowlistExpires)


def assert_refuses(testcase, credential_scan):
    """Run scan(), assert it exits 2, and return what it printed to stderr.

    The message is asserted alongside the code, and that is not belt and
    braces. Exit 2 means CANNOT_CHECK and half a dozen distinct refusals
    share it by design, so a test that checks only the code can be
    satisfied by a guard other than the one it names, and would go on
    passing after its own guard had been deleted. `discovered == 0` and
    "every discovered file is binary" are the live example: both exit 2,
    and the second subsumes the first.
    """
    stderr = io.StringIO()
    with contextlib.redirect_stderr(stderr), testcase.assertRaises(SystemExit) as ctx:
        scan_secrets.scan(credential_scan)
    testcase.assertEqual(ctx.exception.code, 2)
    return stderr.getvalue()


class TestScanSentinelProvesFilesWereActuallyRead(unittest.TestCase):
    def test_zero_files_actually_scanned_overall_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel_paths = ["app/missing.ts", "docs/missing.md"]
            credential_scan = fake_credential_scan(root, rel_paths)

            message = assert_refuses(self, credential_scan)
            self.assertIn("zero were actually opened and scanned", message)

    def test_full_coverage_tree_does_not_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel_paths = full_coverage_tree(root)
            credential_scan = fake_credential_scan(root, rel_paths)

            returned_root, findings, exception_report = scan_secrets.scan(credential_scan)

            self.assertEqual(returned_root, root)
            self.assertEqual(findings, [])
            self.assertEqual(exception_report, {})

    def test_prefix_present_by_name_but_wholly_missing_from_disk_exits_2(self):
        # Every monitored prefix except api/ has real, readable files.
        # api/'s two files are removed from disk after being discovered
        # (simulating a read failure) and its only other discovered path
        # was never written at all, so nothing under api/ is actually
        # scanned even though 3 paths were discovered there. This is the
        # "discovered by name but zero actually read" regression the
        # sentinel exists to catch, still present with the fuller prefix
        # set and the coverage-ratio bar.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel_paths = full_coverage_tree(root, extra_rel_paths=["api/missing.py"])
            (root / "api" / "real1.txt").unlink()
            (root / "api" / "real2.txt").unlink()
            credential_scan = fake_credential_scan(root, rel_paths)

            message = assert_refuses(self, credential_scan)
            self.assertIn("'api/'", message)

    def test_prefix_wholly_absent_from_discovery_exits_2(self):
        # A monorepo-wide discovery narrowed to only app/ and docs/ (e.g. a
        # sparse checkout, or the redash-only fallback): api/, node/,
        # helm/, and scripts/ never even appear in the discovered path
        # list. The old sentinel (app/ and docs/ only) would have passed
        # this; the expanded sentinel must not.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "app").mkdir()
            (root / "app" / "real.ts").write_text("const x = 1;\n")
            (root / "docs").mkdir()
            (root / "docs" / "real.md").write_text("# hello\n")
            rel_paths = ["app/real.ts", "docs/real.md"]
            credential_scan = fake_credential_scan(root, rel_paths)

            message = assert_refuses(self, credential_scan)
            self.assertIn("zero files were discovered under 'api/'", message)

    def test_prefix_severely_narrowed_below_coverage_ratio_exits_2(self):
        # Proof of failure for the "one scanned file is not proof" gap: 22
        # files are genuinely discovered under node/, but all but one are
        # excluded (simulating a filtering regression, or a discovery
        # result that only narrowed after the path list was already
        # built), leaving a single scanned file. A name-only or "at least
        # one scanned" bar would call this clean; the coverage-ratio bar
        # must not.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel_paths = full_coverage_tree(root)
            excluded = {"node/real1.txt", "node/real2.txt"}
            for n in range(1, 20):
                rel = f"node/extra{n}.py"
                (root / rel).write_text("pass\n")
                rel_paths.append(rel)
                excluded.add(rel)
            (root / "node" / "extra0.py").write_text("pass\n")
            rel_paths.append("node/extra0.py")
            credential_scan = fake_credential_scan(root, rel_paths, excluded=excluded)

            message = assert_refuses(self, credential_scan)
            self.assertIn("only 1/22 scannable files discovered under 'node/'", message)


class TestCoverageDenominatorIsScannableFiles(unittest.TestCase):
    """The ratio counts scanned/scannable, not scanned/discovered.

    scripts/export-ce-tree.py is what exposed the difference: the export
    withholds docs/superpowers/ and what is left of `docs/` is majority
    screenshots, so the guard read 41/93 and refused a tree in which every
    scannable file had in fact been scanned. See
    scan_secrets_coverage.py's docstring for the denominator's rationale;
    these are the four directions it has to hold in at once.
    """

    def test_mostly_binary_group_with_every_text_file_scanned_passes(self):
        # The export's shape: 20 screenshots and 2 prose files under docs/,
        # both prose files scanned. 2/22 = 0.09 against discovered, 2/2
        # against scannable. Nothing here is a coverage gap.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shots = write_screenshots(root, "docs/", 20)
            rel_paths = full_coverage_tree(root, extra_rel_paths=shots)
            credential_scan = fake_credential_scan(root, rel_paths)

            returned_root, findings, _ = scan_secrets.scan(credential_scan)

            self.assertEqual(returned_root, root)
            self.assertEqual(findings, [])

    def test_over_broad_exclusion_of_real_text_files_still_exits_2(self):
        # The property most at risk from taking binaries out of the
        # denominator, so it is asserted against a group that is ALSO
        # mostly binary: 20 screenshots plus 20 markdown files that an
        # over-broad is_excluded pattern now skips. The screenshots leave
        # the denominator; the 20 skipped markdown files must not, or the
        # regression the floor exists to catch becomes invisible.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shots = write_screenshots(root, "docs/", 20)
            prose = write_prose(root, "docs/", 20)
            rel_paths = full_coverage_tree(root, extra_rel_paths=shots + prose)
            credential_scan = fake_credential_scan(root, rel_paths, excluded=set(prose))

            message = assert_refuses(self, credential_scan)
            self.assertIn("only 2/22 scannable files discovered under 'docs/'", message)

    def test_paths_discovered_but_absent_from_disk_still_exit_2(self):
        # A discovery/checkout regression: 12 of docs/'s 22 discovered
        # paths are not in the tree at all. Unreadable is not binary, so
        # they stay in the denominator and 10/22 is below the bar. Were
        # they subtracted as binary the run would read 10/10 and pass.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            present = write_prose(root, "docs/", 8)
            absent = [rel.replace("page", "gone") for rel in write_prose(root, "docs/", 12, on_disk=False)]
            rel_paths = full_coverage_tree(root, extra_rel_paths=present + absent)
            credential_scan = fake_credential_scan(root, rel_paths)

            message = assert_refuses(self, credential_scan)
            self.assertIn("only 10/22 scannable files discovered under 'docs/'", message)

    def test_binary_sniff_regression_misreading_text_as_binary_exits_2(self):
        # The hole the new denominator opens. A sniff that starts calling
        # one shape of text file binary shrinks numerator and denominator
        # together: every group here reads 1/1 = 1.00 and the coverage bar
        # sees nothing wrong. MAX_TEXT_EXTENSION_BINARY_SHARE catches it,
        # because half the files whose extension the fork's own allowlist
        # calls text just came back binary.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel_paths = full_coverage_tree(root)

            def regressed_read(full_path):
                if full_path.name == "real2.txt":
                    return None
                return full_path.read_text()

            credential_scan = fake_credential_scan(root, rel_paths, read_text=regressed_read)

            message = assert_refuses(self, credential_scan)
            self.assertIn("read as BINARY content", message)
            self.assertIn("8/17", message)

    def test_group_whose_every_discovered_file_is_binary_exits_2(self):
        # Denominator zero has to be a refusal, not a division. A monitored
        # area holding nothing but assets is either a narrowed discovery or
        # a broken sniff; either way this scan inspected nothing there.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel_paths = full_coverage_tree(root)
            for rel in ("docs/real1.txt", "docs/real2.txt"):
                (root / rel).unlink()
                rel_paths.remove(rel)
            rel_paths.extend(write_screenshots(root, "docs/", 20))
            credential_scan = fake_credential_scan(root, rel_paths)

            message = assert_refuses(self, credential_scan)
            self.assertIn("all 20 file(s) discovered under 'docs/' read as binary content", message)


if __name__ == "__main__":
    unittest.main()

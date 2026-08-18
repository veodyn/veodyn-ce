"""
Unit tests for scripts/scan-secrets.py's coverage sentinel, and for its
KNOWN_EXCEPTIONS handling (in scan_secrets_known_exceptions_test.py, imported
below and split out for file size).

The sentinel cases cover every monitored prefix, a root-level file, and a
narrowing that trips the coverage-ratio bar without ever reaching zero. The
exception guard records (line number, shape descriptor) rather than a digest
of the suppressed literal; see
node/tests/query_runner/credential_scan_known_exceptions.py's docstring for
what that does and does not catch.

Stdlib-only, no pytest: this runs standalone on the host, same as
scan-secrets.py itself.

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

# unittest's default loader collects every TestCase subclass reachable in this
# namespace, imported or not, so these run under both forms above. Referenced
# so lint does not flag the import as unused.
_ = (TestKnownExceptions, TestKnownExceptionsExpire, TestExtraAllowlistExpires)


def assert_refuses(testcase, credential_scan):
    """Run scan(), assert it exits 2, and return what it printed to stderr.

    Callers assert the message too: half a dozen distinct refusals share exit
    2, so a test checking only the code can be satisfied by a guard other
    than the one it names, and would keep passing after its own guard was
    deleted.
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
        # api/ has 3 discovered paths and none that can be read: two are
        # unlinked after discovery and the third was never written. Discovered
        # by name, zero actually read.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel_paths = full_coverage_tree(root, extra_rel_paths=["api/missing.py"])
            (root / "api" / "real1.txt").unlink()
            (root / "api" / "real2.txt").unlink()
            credential_scan = fake_credential_scan(root, rel_paths)

            message = assert_refuses(self, credential_scan)
            self.assertIn("'api/'", message)

    def test_prefix_wholly_absent_from_discovery_exits_2(self):
        # Discovery narrowed to app/ and docs/ (a sparse checkout, or the
        # redash-only fallback): api/, node/, helm/ and scripts/ never appear
        # in the discovered path list at all.
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
        # 22 files discovered under node/, all but one excluded by a filtering
        # regression. An "at least one scanned" bar would call this clean.
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

    Four directions the denominator has to hold in at once; see
    scan_secrets_coverage.py's docstring for its rationale.
    """

    def test_mostly_binary_group_with_every_text_file_scanned_passes(self):
        # The export's shape: 20 screenshots and 2 prose files under docs/,
        # both prose files scanned. 2/22 = 0.09 against discovered, 2/2
        # against scannable.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shots = write_screenshots(root, "docs/", 20)
            rel_paths = full_coverage_tree(root, extra_rel_paths=shots)
            credential_scan = fake_credential_scan(root, rel_paths)

            returned_root, findings, _ = scan_secrets.scan(credential_scan)

            self.assertEqual(returned_root, root)
            self.assertEqual(findings, [])

    def test_over_broad_exclusion_of_real_text_files_still_exits_2(self):
        # 20 screenshots plus 20 markdown files an over-broad is_excluded
        # pattern skips. The screenshots leave the denominator; the skipped
        # markdown must not, or the floor stops catching that regression.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shots = write_screenshots(root, "docs/", 20)
            prose = write_prose(root, "docs/", 20)
            rel_paths = full_coverage_tree(root, extra_rel_paths=shots + prose)
            credential_scan = fake_credential_scan(root, rel_paths, excluded=set(prose))

            message = assert_refuses(self, credential_scan)
            self.assertIn("only 2/22 scannable files discovered under 'docs/'", message)

    def test_paths_discovered_but_absent_from_disk_still_exit_2(self):
        # A checkout regression: 12 of docs/'s 22 discovered paths are not in
        # the tree. Unreadable is not binary, so they stay in the denominator
        # and 10/22 is below the bar; subtracted, the run would read 10/10.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            present = write_prose(root, "docs/", 8)
            absent = [rel.replace("page", "gone") for rel in write_prose(root, "docs/", 12, on_disk=False)]
            rel_paths = full_coverage_tree(root, extra_rel_paths=present + absent)
            credential_scan = fake_credential_scan(root, rel_paths)

            message = assert_refuses(self, credential_scan)
            self.assertIn("only 10/22 scannable files discovered under 'docs/'", message)

    def test_binary_sniff_regression_misreading_text_as_binary_exits_2(self):
        # A sniff calling one shape of text file binary shrinks numerator and
        # denominator together: every group reads 1/1 = 1.00 and the coverage
        # bar sees nothing. MAX_TEXT_EXTENSION_BINARY_SHARE catches it.
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
        # Denominator zero has to be a refusal, not a division: either way
        # the scan inspected nothing under that prefix.
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

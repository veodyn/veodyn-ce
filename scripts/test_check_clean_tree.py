"""Unit tests for scripts/check-clean-tree.py.

The tests that matter plant a term in a throwaway tree and assert the gate
rejects it and names where. Two vacuous-pass shapes are covered by name:
`test_the_floor_sits_below_the_real_harvest` (a floor set above the value it
guards), and in the declarations file `test_every_declared_path_exists` and
`test_every_baseline_path_is_tracked` (an assertion reading a field where it
does not live).

Three siblings were split off for file size. All four have a `unittest.main()`
block and ci/scan-secrets.yaml discovers them under the wildcard below. This
file drives the scanner over planted terms;
test_check_clean_tree_patterns.py drives the value-free shape rules;
test_check_clean_tree_ratchet.py drives the baseline comparison and the
failure printing; test_check_clean_tree_declarations.py holds the shipped
tree to what the manifest declares about it.

No identity term is written into this file; see clean_tree_test_support.py.
Stdlib-only, no pytest, same as the two sibling guards' tests.

    python3 -m unittest discover -s scripts -p "test_check_clean_tree*.py"
"""

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from clean_tree_test_support import BUCKETS, PLANTABLE, REPO_ROOT, SCRIPTS_DIR, TERMS
from clean_tree_test_support import baseline, gate, git, make_repo, manifest, report, scan_repo


class TestPlantedTermIsRejected(unittest.TestCase):
    def test_planted_term_is_found_and_its_position_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            counts, sites, _patterns, text_count, _name_only = scan_repo(
                Path(tmp),
                {"README.md": "nothing here\n", "src/thing.ts": f"// see the {PLANTABLE} pack\n"},
            )

            self.assertEqual(text_count, 2)
            self.assertEqual(counts, {"src/thing.ts": 1})
            self.assertEqual([lineno for lineno, _group in sites["src/thing.ts"]], [1])

    def test_a_term_in_a_FILENAME_is_found_even_with_generic_contents(self):
        # `git ls-files` publishes every name in the tree, so a file NAMED after
        # the customer is as public as any line of any file.
        with tempfile.TemporaryDirectory() as tmp:
            counts, sites, _patterns, _text, _name_only = scan_repo(
                Path(tmp),
                {"README.md": "nothing here\n", f"src/{PLANTABLE}-adapter.ts": "export const x = 1;\n"},
            )

            planted = f"src/{PLANTABLE}-adapter.ts"
            self.assertEqual(counts, {planted: 1})
            self.assertEqual([lineno for lineno, _group in sites[planted]], [gate.PATH_LINENO])

    def test_the_report_says_a_name_match_is_a_name_match(self):
        # A different remedy from a line match (rename the file), and `path:0`
        # would send the reader looking for a line that does not exist.
        buffer = io.StringIO()
        findings = ([("src/thing.ts", 1)], [], [], [], [], [], [])
        with redirect_stdout(buffer):
            report.print_failures(
                findings, {"src/thing.ts": [(gate.PATH_LINENO, "t3")]}, BUCKETS
            )
        output = buffer.getvalue()

        self.assertIn("in the file name", output)
        self.assertNotIn("src/thing.ts:0", output)
        self.assertIn("term #3", output)


class TestGuardCannotPassVacuously(unittest.TestCase):
    def test_the_floor_sits_below_the_real_harvest(self):
        # Both directions: only checking that the harvest clears the floor would
        # also pass with the floor set to 1.
        self.assertGreater(len(TERMS), gate.MIN_HARVESTED_TERMS)
        self.assertGreaterEqual(gate.MIN_HARVESTED_TERMS, 5)

    def test_harvest_returns_terms_from_every_declared_source(self):
        # "At least one term from each" is all this can assert without a per-source
        # count that every normal edit would have to update. A source going from ten
        # terms to one passes here; TERM_COUNT in the baseline is what catches it,
        # see TestRegenerationRefusesAShrinkingHarvest in the ratchet file.
        sources = {source for _index, source, _pattern in TERMS}

        self.assertEqual(len(sources), len(manifest.IDENTITY_TERM_SOURCES))
        for rel_path, _symbol, _extraction, _reason in manifest.IDENTITY_TERM_SOURCES:
            self.assertTrue(any(rel_path in source for source in sources), rel_path)

    def test_a_missing_term_source_exits_2(self):
        with self.assertRaises(SystemExit) as ctx:
            gate.harvest_terms(REPO_ROOT, (("no/such/file.ts", "X", "regex-array", "reason"),))
        self.assertEqual(ctx.exception.code, gate.EXIT_CANNOT_CHECK)

    def test_a_repository_with_no_tracked_files_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            git(root, "init", "-q")
            with self.assertRaises(SystemExit) as ctx:
                gate.git_tracked_paths(root)
            self.assertEqual(ctx.exception.code, gate.EXIT_CANNOT_CHECK)

    def test_a_tree_of_only_skipped_files_exits_2_rather_than_reporting_clean(self):
        deferred = manifest.DEFERRED_PREFIXES[0][0]
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit) as ctx:
                scan_repo(Path(tmp), {f"{deferred}note.md": f"{PLANTABLE}\n"})
            self.assertEqual(ctx.exception.code, gate.EXIT_CANNOT_CHECK)

    def test_a_missing_module_exits_2(self):
        with self.assertRaises(SystemExit) as ctx:
            gate._load_by_path("gone", SCRIPTS_DIR / "no-such-module.py")
        self.assertEqual(ctx.exception.code, gate.EXIT_CANNOT_CHECK)

    def test_the_fingerprint_changes_when_the_term_list_changes(self):
        altered = TERMS + [(len(TERMS), "somewhere", "zzzz")]

        self.assertNotEqual(gate.term_fingerprint(TERMS), gate.term_fingerprint(altered))

    def test_the_committed_baseline_matches_the_committed_sources(self):
        self.assertEqual(baseline.TERM_FINGERPRINT, gate.term_fingerprint(TERMS))


class TestExclusions(unittest.TestCase):
    def test_a_deferred_prefix_is_not_scanned(self):
        deferred = manifest.DEFERRED_PREFIXES[0][0]
        with tempfile.TemporaryDirectory() as tmp:
            counts, _sites, _p, text_count, _names = scan_repo(
                Path(tmp), {"README.md": "clean\n", f"{deferred}note.md": f"{PLANTABLE}\n"}
            )

            self.assertEqual(counts, {})
            self.assertEqual(text_count, 1)

    def test_this_gates_own_modules_are_not_scanned(self):
        # The baseline module's rows are file paths, and some contain a connector
        # name that is itself a harvested term, so the gate would report itself.
        for self_path in manifest.SELF_REL_PATHS:
            with self.subTest(self_path=self_path), tempfile.TemporaryDirectory() as tmp:
                counts, _sites, _p, _text, _names = scan_repo(
                    Path(tmp), {"README.md": "clean\n", self_path: f"{PLANTABLE}\n"}
                )

                self.assertEqual(counts, {})

    def test_a_binary_files_contents_are_skipped_but_its_NAME_is_still_checked(self):
        # A PNG cannot be decoded, so its pixels are not scanned, but its path is:
        # a capture saved under the customer's name identifies the customer
        # without a single byte of it being text.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root, {"README.md": "clean\n"})
            named = f"{PLANTABLE}-dashboard.png"
            (root / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n\xff\xfe")
            (root / named).write_bytes(b"\x89PNG\r\n\x1a\n\xff\xfe")
            git(root, "add", "--", "logo.png", named)
            combined, rules = gate.build_matchers(TERMS, manifest)

            counts, sites, _p, text_count, name_only_count = gate.scan(
                root, gate.git_tracked_paths(root), combined, rules, manifest
            )

            self.assertEqual((text_count, name_only_count), (1, 2))
            self.assertEqual(counts, {named: 1})
            self.assertEqual([lineno for lineno, _group in sites[named]], [gate.PATH_LINENO])

    def test_a_tree_of_only_binaries_exits_2_rather_than_reporting_clean(self):
        # The name check must not become a reason to pass a run that read no text
        # at all.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            git(root, "init", "-q")
            (root / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n\xff\xfe")
            git(root, "add", "--", "logo.png")
            combined, rules = gate.build_matchers(TERMS, manifest)

            with self.assertRaises(SystemExit) as ctx:
                gate.scan(root, gate.git_tracked_paths(root), combined, rules, manifest)
            self.assertEqual(ctx.exception.code, gate.EXIT_CANNOT_CHECK)


if __name__ == "__main__":
    unittest.main()

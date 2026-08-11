"""Declaration tests for scripts/check-clean-tree.py.

Split out of scripts/test_check_clean_tree.py purely to keep both files under
this repo's file-size limit, the same way clean_tree_test_support.py was.

The division: that file drives the SCANNER, planting a term in a throwaway
tree and asserting the gate rejects it. This one holds the tree the scanner
actually ships against to its DECLARATIONS: every declared path exists, every
declaration states a reason, no hand-written file of this gate's own names a
term.

ci/scan-secrets.yaml discovers all four with the pattern
`test_check_clean_tree*.py`. That wildcard is the whole reason this file is
safe to exist: an exact-name pattern is how a test file in this repository has
already gone unrun, and the sibling file's docstring records it.

No identity term is written into this file; see clean_tree_test_support.py.

    python3 -m unittest discover -s scripts -p "test_check_clean_tree*.py"
"""

import unittest

from clean_tree_test_support import BUCKETS, PLANTABLE, REPO_ROOT, TERMS
from clean_tree_test_support import baseline, declared_buckets, gate, manifest, report


class TestDeclarations(unittest.TestCase):
    def test_every_declared_path_exists(self):
        declared = [path for path, _reason in manifest.LOAD_BEARING]
        declared += [path for path, _rule, _count, _reason in manifest.OPEN_PATTERN_SITES]
        declared += [path for path, _symbol, _extraction, _reason in manifest.IDENTITY_TERM_SOURCES]
        for rel_path in declared:
            with self.subTest(rel_path=rel_path):
                self.assertTrue((REPO_ROOT / rel_path).is_file(), f"{rel_path} is declared but absent")

    def test_every_baseline_path_is_tracked(self):
        tracked = set(gate.git_tracked_paths(REPO_ROOT))
        for rel_path, _count, _per_term in baseline.BASELINE:
            with self.subTest(rel_path=rel_path):
                self.assertIn(rel_path, tracked)

    def test_every_declaration_states_a_reason(self):
        entries = list(manifest.LOAD_BEARING) + list(manifest.DEFERRED_PREFIXES) + list(manifest.NOT_CHECKED)
        entries += [(path, reason) for path, _rule, _count, reason in manifest.OPEN_PATTERN_SITES]
        entries += [(label, reason) for _sel, label, _status, reason in declared_buckets.OPEN_DECISION_BUCKETS]
        for subject, reason in entries:
            with self.subTest(subject=subject):
                self.assertTrue(subject)
                self.assertGreater(len(reason.strip()), 40, "a one-word reason is not a reason")

    def test_the_undecodable_file_gap_is_declared_rather_than_silent(self):
        # The audit finding this covers: scan() dropped every file that did not
        # decode as UTF-8 and the run still printed "nothing outside the
        # declarations", with no declaration saying so. An undeclared skip in a
        # guard is indistinguishable from coverage. Asserted against
        # NOT_CHECKED rather than against prose, so deleting the note fails
        # here rather than quietly restoring the silent skip.
        subjects = " ".join(subject for subject, _reason in manifest.NOT_CHECKED).lower()
        reasons = " ".join(reason for _subject, reason in manifest.NOT_CHECKED)

        self.assertIn("utf-8", subjects)
        self.assertIn("FORBIDDEN_ON_SCREEN", reasons, "the declaration has to name what covers it")

    def test_no_load_bearing_path_is_also_in_the_baseline(self):
        recorded = {path for path, _count, _per_term in baseline.BASELINE}
        for path, _reason in manifest.LOAD_BEARING:
            self.assertNotIn(path, recorded)

    def test_a_load_bearing_declaration_that_matches_nothing_fails(self):
        reported, _new, _grew, stale, _improved, _swapped = gate.classify({}, {}, manifest, ())

        self.assertEqual(len(reported), len(manifest.LOAD_BEARING))
        self.assertEqual(len(stale), len(manifest.LOAD_BEARING))

    def test_the_bucket_catch_all_is_last_and_every_prefix_bucket_is_reachable(self):
        declared = declared_buckets.OPEN_DECISION_BUCKETS
        selectors = [selector for selector, _label, _status, _reason in declared]

        self.assertEqual(
            selectors[-1],
            (declared_buckets.BY_PREFIX, ""),
            "OPEN_DECISION_BUCKETS must end with a catch-all",
        )
        self.assertNotIn((declared_buckets.BY_PREFIX, ""), selectors[:-1])
        self.assertEqual(report.bucket_for("some/other/file.ts", BUCKETS)[0], declared[-1][1])
        for (kind, value), label, _status, _reason in declared[:-1]:
            if kind != declared_buckets.BY_PREFIX:
                continue
            with self.subTest(prefix=value):
                self.assertEqual(report.bucket_for(value, BUCKETS)[0], label)

    def test_every_bucket_carries_a_status_the_report_prints_under_a_heading(self):
        # The split that made a closed bucket possible put the status in one
        # module and the headings in another, and nothing on sys.path joins
        # them. This is that join: a status added over there with no heading
        # over here would otherwise print under nothing at all.
        headings = {status for status, _heading in report.STATUS_HEADINGS}
        for _selector, label, status, _reason in declared_buckets.OPEN_DECISION_BUCKETS:
            with self.subTest(label=label):
                self.assertIn(status, headings)

    def test_every_baseline_row_lands_in_a_bucket_and_the_closed_one_is_not_empty(self):
        # Two properties in one pass over the real baseline. First: no row
        # falls through, because a row nobody grouped is a row nobody counted.
        # Second: a CLOSED bucket that selects nothing is a stale claim in
        # exactly the way a load-bearing declaration matching nothing is, and
        # it is the one bucket whose emptiness would look like success.
        matched = set()
        for path, _count, _per_term in baseline.BASELINE:
            label, _status, _reason = report.bucket_for(path, BUCKETS)
            self.assertNotEqual(label, "ungrouped", f"{path} fell out of every bucket")
            matched.add(label)
        closed = {
            label
            for _matches, label, status, _reason, _where in BUCKETS
            if status == report.CLOSED
        }

        self.assertTrue(closed & matched, "no closed bucket selects anything in the baseline")

    def test_every_prefix_selector_names_a_path_that_exists(self):
        # The assertion above is satisfied by ONE populated closed bucket, and
        # a cross-model audit pointed out what that hides: two of the three
        # closed declarations legitimately select zero baseline rows, because
        # the CI files carry no identity term. So their selectors could be
        # pointed at a path that does not exist and nothing would notice.
        # Rename the pipeline root's selector to a .bak that is not there and
        # every other test in this file still passes, while real matches in the
        # real file quietly fall through to the catch-all.
        #
        # This checks the selector against the TREE rather than against itself.
        # The existing reachability check feeds each selector its own declared
        # prefix, which is circular: it proves the string matches the string.
        tracked = set(gate.git_tracked_paths(REPO_ROOT))
        for (kind, value), label, _status, _reason in declared_buckets.OPEN_DECISION_BUCKETS:
            if kind != declared_buckets.BY_PREFIX or not value:
                continue  # the catch-all's empty prefix matches everything by design
            with self.subTest(label=label):
                self.assertTrue(
                    any(path == value or path.startswith(value) for path in tracked),
                    f"{label!r} selects prefix {value!r}, which matches no tracked file. "
                    "Either the path moved and the declaration did not, or the declaration "
                    "is describing something that is no longer here.",
                )

    def test_the_name_selector_needs_both_the_name_and_the_place(self):
        # The selector that could not be written as a literal without naming a
        # term, so it asks the harvest instead. Both halves are asserted,
        # because the bounding regex is what stops a term that is an ordinary
        # word from pulling an unrelated file into a settled bucket. PLANTABLE
        # is harvested at run time; no term is typed here.
        home = "node/redash/query_runner/"
        closed = report.bucket_for(f"{home}{PLANTABLE}.py", BUCKETS)
        beside_it = report.bucket_for(f"{home}test_{PLANTABLE}.py", BUCKETS)
        elsewhere = report.bucket_for(f"src/lib/{PLANTABLE}.ts", BUCKETS)

        self.assertEqual(closed[1], report.CLOSED)
        self.assertEqual(beside_it[0], closed[0], "a connector and its test belong in one bucket")
        self.assertNotEqual(elsewhere[0], closed[0])

    def test_a_dotted_qualifier_does_not_inherit_the_closed_verdict(self):
        # A cross-model audit found the stem comparison split on the first dot
        # and threw the rest away, so `<term>.private.py` was reported as
        # settled public-connector material. Such a file always FAILED as a new
        # row, so nothing shipped through it, but the failure line named it
        # closed, and a maintainer who trusted that line could baseline a
        # genuinely open customer-named file as decided.
        #
        # Only the bare stem and the `.test` form may close. Everything else in
        # that position is somebody's file, not a connector module.
        home = "node/redash/query_runner/"
        for qualifier in ("private", "backup", "schema", "local", "old"):
            with self.subTest(qualifier=qualifier):
                label, status, _reason = report.bucket_for(
                    f"{home}{PLANTABLE}.{qualifier}.py", BUCKETS
                )
                self.assertNotEqual(
                    status,
                    report.CLOSED,
                    f"a .{qualifier}. file inherited the connector bucket's settled verdict",
                )
                self.assertNotEqual(label, "ungrouped", "it still has to land somewhere")
        self.assertEqual(report.bucket_for(f"{home}connector_base.py", BUCKETS)[1], report.OPEN)

    def test_an_unknown_bucket_selector_kind_cannot_pass_silently(self):
        # A kind nobody implemented would otherwise return None and fail as a
        # TypeError somewhere unrelated. It exits 2, the same "cannot check"
        # code every other broken declaration reaches.
        with self.assertRaises(SystemExit) as raised:
            gate.compile_buckets(((("no-such-kind", "x"), "l", "open", "r"),), TERMS)

        self.assertEqual(raised.exception.code, 2)

    def test_the_hand_written_gate_files_name_no_harvested_term(self):
        # The central rule of this gate, asserted rather than trusted: nothing
        # it adds to the tree may name an identity term. SELF_REL_PATHS is not
        # scanned by the gate itself, so without this nothing would check it.
        # The generated baseline is covered by the test below instead. This
        # file and clean_tree_report.py are NOT in SELF_REL_PATHS, so the gate
        # scans them for real; they are listed here anyway, because a term
        # reaching one of them should fail as a broken rule and not merely as
        # a new baseline row.
        combined, _rules = gate.build_matchers(TERMS, manifest)
        hand_written = tuple(
            path for path in manifest.SELF_REL_PATHS if not path.endswith("identity_baseline.py")
        ) + (
            "scripts/clean_tree_identity_buckets.py",
            "scripts/clean_tree_report.py",
            "scripts/clean_tree_harvest.py",
            "scripts/clean_tree_baseline_writer.py",
            "scripts/clean_tree_test_support.py",
            "scripts/test_check_clean_tree_declarations.py",
            "scripts/test_check_clean_tree_ratchet.py",
        )
        for rel_path in hand_written:
            with self.subTest(rel_path=rel_path):
                text = (REPO_ROOT / rel_path).read_text(encoding="utf-8")
                self.assertEqual([m.group() for m in combined.finditer(text)], [])

    def test_the_generated_baseline_names_terms_only_inside_tracked_paths(self):
        # The baseline's rows are file paths, and three connector modules are
        # named after a term, so its text does match. That is not a new
        # disclosure: the filename is already in the tree and `git ls-files`
        # prints it. What would be a disclosure is a term appearing anywhere
        # else in that file, so strip the recorded paths and require nothing
        # to be left.
        combined, _rules = gate.build_matchers(TERMS, manifest)
        text = (REPO_ROOT / "scripts/clean_tree_identity_baseline.py").read_text(encoding="utf-8")
        for rel_path, _count, _per_term in baseline.BASELINE:
            text = text.replace(rel_path, "")

        self.assertEqual([m.group() for m in combined.finditer(text)], [])


if __name__ == "__main__":
    unittest.main()

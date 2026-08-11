"""Ratchet tests for scripts/check-clean-tree.py.

Split out of scripts/test_check_clean_tree.py for file size, alongside the
patterns and declarations files, and discovered by the same
`test_check_clean_tree*.py` wildcard in ci/scan-secrets.yaml.

Everything here drives classify(), regeneration_is_refused() and the failure
printing with plain dicts and stubs rather than a repository: a per-path
total, the sites behind it, a baseline row, and the baseline module a
regeneration is about to overwrite. That is the whole reason those are pure.

Two audit findings live here, and both are about a record that could not
notice a change:

- The ratchet compared totals and nothing else, so a swap nets zero and a new
  identity term could enter a file that shed an old one in silence.
- --write-baseline wrote the new fingerprint without loading the old one, so
  the documented regeneration path could not notice its own vocabulary
  getting smaller.

No identity term is written into this file; see clean_tree_test_support.py.

    python3 -m unittest discover -s scripts -p "test_check_clean_tree*.py"
"""

import io
import unittest
from contextlib import redirect_stdout

from clean_tree_test_support import BUCKETS, PLANTABLE, TERMS
from clean_tree_test_support import baseline, gate, manifest, report, writer


class TestRatchet(unittest.TestCase):
    def test_a_planted_term_in_an_undeclared_path_fails_the_verdict(self):
        counts = {"src/thing.ts": 1}
        sites = {"src/thing.ts": [(3, "t2")]}
        _r, new, grew, stale, _improved, _swapped = gate.classify(
            counts, sites, manifest, (("src/other.ts", 1, ((2, 1),)),)
        )

        self.assertEqual(new, [("src/thing.ts", 1)])
        self.assertEqual(grew, [])
        self.assertIn(("src/other.ts", "baseline records 1 but the path now matches nothing"), stale)

    def test_the_report_names_the_file_and_the_term_index_but_not_the_value(self):
        # The finding is worth nothing if the operator cannot see what tripped
        # it, and worth less than nothing if the CI log then carries the
        # customer's name, so the value must NOT be in the output.
        buffer = io.StringIO()
        findings = ([("src/thing.ts", 1)], [], [], [], [], [], [])
        with redirect_stdout(buffer):
            failed = report.print_failures(
                findings, {"src/thing.ts": [(4, "t7")]}, BUCKETS
            )
        output = buffer.getvalue()

        self.assertTrue(failed)
        self.assertIn("src/thing.ts:4", output)
        self.assertIn("term #7", output)
        self.assertNotIn(PLANTABLE, output)

    def test_growth_over_the_recorded_count_fails(self):
        sites = {"src/thing.ts": [(1, "t2"), (5, "t2"), (9, "t2")]}
        _r, new, grew, _stale, improved, swapped = gate.classify(
            {"src/thing.ts": 3}, sites, manifest, (("src/thing.ts", 2, ((2, 2),)),)
        )

        self.assertEqual(new, [])
        self.assertEqual(grew, [("src/thing.ts", 2, 3)])
        self.assertEqual(improved, [])
        # `grew` already fails the run and already names the path, so the
        # per-term check does not repeat it.
        self.assertEqual(swapped, [])

    def test_a_decrease_is_reported_but_does_not_fail(self):
        sites = {"src/thing.ts": [(1, "t2")]}
        _r, new, grew, _stale, improved, swapped = gate.classify(
            {"src/thing.ts": 1}, sites, manifest, (("src/thing.ts", 2, ((2, 2),)),)
        )

        self.assertEqual((new, grew, swapped), ([], [], []))
        self.assertEqual(improved, [("src/thing.ts", 2, 1)])

    def test_a_swap_that_nets_zero_fails(self):
        # The audit finding: the ratchet compared a per-file total against the
        # recorded total, so removing one occurrence of a term the file already
        # carried and adding a reference to a DIFFERENT term elsewhere in the
        # same file summed to the same number and was absorbed in silence.
        # Recorded: 3 of term #2. Now: 2 of term #2 and 1 of term #9. Total
        # unchanged at 3.
        sites = {"src/thing.ts": [(1, "t2"), (5, "t2"), (40, "t9")]}
        _r, new, grew, _stale, improved, swapped = gate.classify(
            {"src/thing.ts": 3}, sites, manifest, (("src/thing.ts", 3, ((2, 3),)),)
        )

        self.assertEqual((new, grew, improved), ([], [], []))
        self.assertEqual(swapped, [("src/thing.ts", 9, 0, 1, 3, 3)])

    def test_a_swap_hiding_under_a_FALLING_total_fails_too(self):
        # A drop is reported as an improvement and does not fail, so a swap
        # that also sheds an occurrence would otherwise be the quietest way
        # through: recorded 4 of term #2, now 2 of #2 and 1 of #9.
        sites = {"src/thing.ts": [(1, "t2"), (5, "t2"), (40, "t9")]}
        _r, _new, _grew, _stale, improved, swapped = gate.classify(
            {"src/thing.ts": 3}, sites, manifest, (("src/thing.ts", 4, ((2, 4),)),)
        )

        self.assertEqual(improved, [("src/thing.ts", 4, 3)])
        self.assertEqual(swapped, [("src/thing.ts", 9, 0, 1, 4, 3)])

    def test_the_same_terms_at_different_lines_are_not_a_swap(self):
        # The limit, asserted rather than implied. Line numbers are not
        # recorded, because pinning them would churn every row on any edit
        # above them, so the same term moving within a file reads as no
        # change. It is the same term in the same file: not new exposure.
        sites = {"src/thing.ts": [(80, "t2"), (91, "t2")]}
        _r, new, grew, _stale, improved, swapped = gate.classify(
            {"src/thing.ts": 2}, sites, manifest, (("src/thing.ts", 2, ((2, 2),)),)
        )

        self.assertEqual((new, grew, improved, swapped), ([], [], [], []))

    def test_the_swap_report_names_the_index_and_both_totals_but_no_value(self):
        buffer = io.StringIO()
        findings = ([], [], [], [("src/thing.ts", 9, 0, 1, 3, 3)], [], [], [])
        with redirect_stdout(buffer):
            failed = report.print_failures(
                findings, {"src/thing.ts": [(40, "t9")]}, BUCKETS
            )
        output = buffer.getvalue()

        self.assertTrue(failed)
        self.assertIn("identity term #9", output)
        self.assertIn("3 to 3", output)
        self.assertNotIn(PLANTABLE, output)


class _PreviousBaseline:
    """The attributes regeneration_is_refused() reads off the module it is
    about to overwrite. A stub, so a test can say "the last one had 25 terms"
    without regenerating the real file.
    """

    TERM_FINGERPRINT = "0000000000000000"
    BASELINE = (("src/thing.ts", 2, ((2, 2),)),)

    def __init__(self, term_count):
        if term_count is not None:
            self.TERM_COUNT = term_count


class TestRegenerationRefusesAShrinkingHarvest(unittest.TestCase):
    """--write-baseline wrote the new fingerprint and counts without loading
    the old ones, so the documented regeneration path could not notice its own
    vocabulary getting smaller: a source whose extraction shape broke from ten
    terms to one still cleared MIN_HARVESTED_TERMS, still satisfied every
    per-source "at least one term" assertion, and every later run then trusted
    the fingerprint it had just written.
    """

    def _refused(self, previous, term_count, allow_shrink=False):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            refused = writer.regeneration_is_refused(previous, term_count, 40, allow_shrink)
        return refused, buffer.getvalue()

    def test_a_smaller_harvest_refuses_the_write(self):
        refused, _out = self._refused(_PreviousBaseline(25), 15)

        self.assertTrue(refused)

    def test_one_term_fewer_is_enough_to_refuse(self):
        # Any shrink, not a threshold. "Substantially smaller" is a judgement
        # this file cannot make, and being wrong in one direction costs a typed
        # flag while being wrong in the other leaves a disarmed gate.
        refused, _out = self._refused(_PreviousBaseline(25), 24)

        self.assertTrue(refused)

    def test_an_equal_or_larger_harvest_writes(self):
        for term_count in (25, 26):
            with self.subTest(term_count=term_count):
                refused, _out = self._refused(_PreviousBaseline(25), term_count)

                self.assertFalse(refused)

    def test_the_override_writes_and_says_so(self):
        refused, output = self._refused(_PreviousBaseline(25), 15, allow_shrink=True)

        self.assertFalse(refused)
        self.assertIn("SHRANK", output)
        self.assertIn("--accept-fewer-terms", output)

    def test_a_first_baseline_writes_rather_than_refusing(self):
        refused, output = self._refused(None, 25)

        self.assertFalse(refused)
        self.assertIn("no previous baseline", output)

    def test_a_previous_baseline_without_a_term_count_writes_and_says_it_cannot_compare(self):
        # The one regeneration after this landed, and only that one. It must
        # not read as a comparison that succeeded.
        refused, output = self._refused(_PreviousBaseline(None), 15)

        self.assertFalse(refused)
        self.assertIn("no TERM_COUNT", output)

    def test_the_committed_baseline_records_the_count_it_was_written_from(self):
        # Without this the shipped file could lose TERM_COUNT and every
        # regeneration would take the "cannot compare" path forever.
        self.assertEqual(baseline.TERM_COUNT, len(TERMS))


if __name__ == "__main__":
    unittest.main()

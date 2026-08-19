"""Unit tests for compose/seed_catalog_fixtures.py.

Every case here is a bug that shipped, not a hypothetical. The seed runs
unattended against an empty stack, so a wrong decision is not a failed command
somebody reads: it is a stack that comes up looking seeded and is not.

The split_statements cases are the important ones. That function reported success
having applied nothing at all, and the only thing that caught it was counting rows
in ClickHouse afterwards. Both halves of that failure are pinned here: the
statements have to survive the split, and the fixture's own comment style has to
be the input.

Stdlib unittest, no pytest, matching every other guard test in this repository:
it runs on a bare interpreter with nothing installed. ci/scan-secrets.yaml runs
it.

    python3 -m unittest discover -s compose -p "*_test.py"
"""

import sys
import unittest
from pathlib import Path

# `unittest discover -s compose` puts the top-level directory on sys.path, but
# running this file directly does not, and both have to work.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from seed_catalog_fixtures import expand, split_statements, substitute  # noqa: E402

# The exact shape of compose/fixtures/historical.sql: a commented header, then a
# commented section heading before each statement. That leading comment is what
# the first version of split_statements tripped over.
FIXTURE_SHAPED_SQL = """\
-- Captured rows, applied by seed-catalog.py.
--
-- __TABLE_x__ is substituted with the resolved table name.

-- Section one
-- and a second comment line
INSERT INTO one (a, b) VALUES
  (1, 'x'),
  (2, 'y');

-- Section two
INSERT INTO two (a) VALUES (3);
"""


class SplitStatements(unittest.TestCase):
    def test_keeps_a_statement_that_a_comment_precedes(self):
        # THE REGRESSION. Splitting on `;` first and then dropping any chunk that
        # starts with `--` drops every statement in a file written like the
        # fixture, because every one of them is preceded by a comment. The seed
        # then reported "warehouse rows loaded" over an empty warehouse.
        statements = split_statements(FIXTURE_SHAPED_SQL)
        self.assertEqual(len(statements), 2)
        self.assertTrue(statements[0].startswith("INSERT INTO one"))
        self.assertTrue(statements[1].startswith("INSERT INTO two"))

    def test_drops_the_comments_themselves(self):
        for statement in split_statements(FIXTURE_SHAPED_SQL):
            self.assertNotIn("--", statement)

    def test_a_file_of_only_comments_yields_nothing(self):
        self.assertEqual(split_statements("-- nothing here\n-- at all\n"), [])

    def test_a_trailing_semicolon_does_not_produce_an_empty_statement(self):
        self.assertEqual(split_statements("SELECT 1;\n"), ["SELECT 1"])


class Expand(unittest.TestCase):
    def test_uses_the_environment_when_set(self):
        self.assertEqual(expand("${A}", {"A": "set"}), "set")

    def test_falls_back_when_absent(self):
        self.assertEqual(expand("${A:-fallback}", {}), "fallback")

    def test_falls_back_when_present_but_empty(self):
        # compose passes every optional variable through as `${VAR:-}`, so an
        # unset one arrives here as "" rather than as absent. Letting the empty
        # string win produced a data source with an empty required option, which
        # fails validation and is never created, leaving the queries that name it
        # pointing at nothing.
        self.assertEqual(expand("${A:-fallback}", {"A": ""}), "fallback")

    def test_an_unset_variable_with_no_fallback_becomes_empty(self):
        self.assertEqual(expand("${A}", {}), "")

    def test_recurses_through_dicts_and_lists(self):
        self.assertEqual(
            expand({"k": ["${A}", {"n": "${B:-b}"}]}, {"A": "a"}),
            {"k": ["a", {"n": "b"}]},
        )

    def test_leaves_non_strings_alone(self):
        self.assertEqual(expand({"n": 5, "b": True, "z": None}, {}), {"n": 5, "b": True, "z": None})

    def test_a_fallback_stops_at_the_first_closing_brace(self):
        # Not a nicety, a documented limit: it is why the placeholder GTFS feed
        # URL in catalog.json carries no `{routes}` segment. Pinned so the day
        # somebody writes one, this says why it broke.
        self.assertEqual(expand("${A:-x{y}z}", {}), "x{yz}")


class Substitute(unittest.TestCase):
    def test_replaces_every_token(self):
        self.assertEqual(
            substitute("a __ONE__ b __TWO__", {"__ONE__": "1", "__TWO__": "2"}),
            "a 1 b 2",
        )

    def test_refuses_a_token_nothing_defines(self):
        with self.assertRaises(RuntimeError) as caught:
            substitute("__QID_missing__", {"__ADMIN_USER_ID__": "1"})
        self.assertIn("__QID_missing__", str(caught.exception))

    def test_notices_a_lowercase_token(self):
        # An uppercase-only pattern matched none of the real tokens, which all
        # carry the fixture's lowercase keys, so it reported every substitution
        # clean whatever was left in the text.
        with self.assertRaises(RuntimeError):
            substitute("__TABLE_transit_vehicles__", {})

    def test_the_table_token_does_not_eat_the_tablename_token(self):
        # The two share a prefix and are replaced in dict order. If __TABLE_x__
        # matched inside __TABLENAME_x__, feed_id would become a database-qualified
        # name and nothing would join to it.
        result = substitute(
            "__TABLE_x__ and __TABLENAME_x__",
            {"__TABLE_x__": "historical.q_x_1", "__TABLENAME_x__": "q_x_1"},
        )
        self.assertEqual(result, "historical.q_x_1 and q_x_1")


if __name__ == "__main__":
    unittest.main()

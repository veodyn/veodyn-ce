"""Unit tests for compose/seed_redash_groups.py.

`docker compose up` runs the seeder unattended on every boot, so a bad
decision there is not a failed command somebody reads, it is a stack that came
up wrong. The two decisions worth testing are the refusals, and both were
reachable with a configuration compose.yaml documents and accepts:
VEODYN_SERVICE_GROUP=admin, and a name shared by two groups.

Stdlib unittest, no pytest, matching every other guard test in this
repository: it runs on a bare `python:3.11` image with nothing installed.
ci/scan-secrets.yaml runs it.

    python3 -m unittest discover -s compose -p "seed_redash_test.py"
"""

import sys
import unittest
from pathlib import Path

# `unittest discover -s compose` puts the top-level directory on sys.path, but
# running this file directly does not, and both have to work.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from seed_redash_groups import SERVICE_GROUP_PERMISSIONS, group_refusal  # noqa: E402

# The two values redash/models/users.py gives Group.type. Written out rather
# than imported, because this test runs with no `redash` package on the path
# and reading the expectation off the thing under test proves nothing anyway.
BUILTIN = "builtin"
REGULAR = "regular"


class TestGroupRefusal(unittest.TestCase):
    def test_a_builtin_group_is_refused(self):
        # THE case. VEODYN_SERVICE_GROUP=admin selected the organisation's
        # builtin admin group and the seeder then replaced its permissions with
        # the service account's five, so an ordinary `docker compose up` left
        # the organisation with nobody able to administer it.
        refusal = group_refusal([BUILTIN], "admin", BUILTIN)

        self.assertIsNotNone(refusal)
        self.assertIn("BUILTIN", refusal)
        self.assertIn("VEODYN_SERVICE_GROUP", refusal)

    def test_the_builtin_default_group_is_refused_too(self):
        # Less dramatic and more likely: it strips every ordinary user, because
        # the default group is where new users and new data sources land.
        refusal = group_refusal([BUILTIN], "default", BUILTIN)

        self.assertIsNotNone(refusal)
        self.assertIn("BUILTIN", refusal)

    def test_a_duplicated_name_is_refused_rather_than_resolved(self):
        # groups.name has no unique constraint and POST /api/groups accepts a
        # name that already exists, so .first() rewrote whichever row was
        # inserted first.
        refusal = group_refusal([REGULAR, REGULAR], "veodyn-service", BUILTIN)

        self.assertIsNotNone(refusal)
        self.assertIn("2 groups", refusal)

    def test_a_duplicated_name_is_refused_before_the_builtin_check(self):
        # Order matters: with a builtin and a regular group sharing a name, the
        # ambiguity is the finding. Reporting "it is builtin" would send the
        # operator to rename one group when the real problem is that there are
        # two.
        refusal = group_refusal([REGULAR, BUILTIN], "admin", BUILTIN)

        self.assertIn("2 groups", refusal)

    def test_one_regular_group_is_allowed(self):
        self.assertIsNone(group_refusal([REGULAR], "veodyn-service", BUILTIN))

    def test_no_match_is_allowed_because_that_is_the_create_path(self):
        self.assertIsNone(group_refusal([], "veodyn-service", BUILTIN))

    def test_every_refusal_says_what_to_do_about_it(self):
        # A refusal an operator cannot act on stops a boot and explains
        # nothing. Both name the variable and say "seed again".
        for match_types, name in (([BUILTIN], "admin"), ([REGULAR, REGULAR], "veodyn-service")):
            with self.subTest(name=name):
                refusal = group_refusal(match_types, name, BUILTIN)

                self.assertIn("VEODYN_SERVICE_GROUP", refusal)
                self.assertIn("seed again", refusal)


class TestServicePermissions(unittest.TestCase):
    def test_the_permission_list_is_sorted_and_holds_no_admin_right(self):
        # compose/verify-seed.py compares an account's effective permissions
        # against this same set, so an ordering difference there is a false
        # failure, and an admin right here is the escalation the dedicated
        # group exists to prevent.
        self.assertEqual(SERVICE_GROUP_PERMISSIONS, sorted(SERVICE_GROUP_PERMISSIONS))
        self.assertNotIn("admin", SERVICE_GROUP_PERMISSIONS)
        self.assertNotIn("super_admin", SERVICE_GROUP_PERMISSIONS)


if __name__ == "__main__":
    unittest.main()

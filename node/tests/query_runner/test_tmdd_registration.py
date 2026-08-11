"""
The TMDD runner as a thing an operator can actually create, and as a thing
that stays read-only while it changes.

Registration is the last step of this connector for a reason: three guards
in this directory only start covering TMDD once it is in
`settings.default_query_runners`, and two of them fail in both directions.
This file adds the fourth, which is the one that says the type is reachable
at all rather than only consistent with the others.

The read-only assertion is here rather than beside the transport tests
because it is about the module set, not about any one module. TMDD's control
and command dialogs are real operations in the same WSDL bundle this
connector reads, so "we did not implement one" is a claim that has to keep
being true as the modules change, not a fact settled once when they were
written.
"""

import inspect
from unittest import TestCase

from redash import settings
from redash.query_runner import (
    query_runners,
    tmdd,
    tmdd_config,
    tmdd_decode,
    tmdd_request,
    tmdd_rows,
    tmdd_transport,
    tmdd_xml,
)
from redash.query_runner.tmdd import TMDD

TMDD_MODULE = "redash.query_runner.tmdd"

# Every module the runner is split across, not only the four that touch the
# wire. A control operation added to the row shaper or the XML helpers would
# be just as much of a write path, and a scan that skips them says so.
TMDD_MODULES = (tmdd, tmdd_config, tmdd_decode, tmdd_request, tmdd_rows, tmdd_transport, tmdd_xml)

# Two named control operations from the v3.03d bundle, plus the substring
# every operation of that family shares, so an operation nobody thought to
# name here is still caught.
BANNED_OPERATIONS = ("dlDMSControlRequest", "dlDeviceCancelControlRequest", "ControlRequest")


class TestTMDDIsRegistered(TestCase):
    def test_the_module_ships_in_the_default_runner_list(self):
        # Without this line no deployment can create a data source of this
        # type, however complete the runner is.
        self.assertIn(TMDD_MODULE, settings.default_query_runners)

    def test_the_type_resolves_to_this_runner_from_a_shipped_module(self):
        # `query_runners` is populated by import side effect, so membership
        # in it alone is true for any module some other test happened to
        # import. Reading the registered class back and checking the module
        # it came from is what makes this registration rather than collection
        # order. The import proof for a real container is in the task report;
        # this is the part a suite can hold.
        self.assertIs(query_runners.get(TMDD.type()), TMDD)
        self.assertIn(query_runners[TMDD.type()].__module__, set(settings.default_query_runners))

    def test_the_runner_is_not_deprecated(self):
        # Both halves of the db-logo guard and the query-shape family test
        # filter deprecated runners out. A TMDD that arrived deprecated would
        # be registered and yet covered by none of them.
        self.assertFalse(TMDD.deprecated)


class TestTMDDStaysReadOnly(TestCase):
    def test_no_module_contains_a_write_or_control_code_path(self):
        for module in TMDD_MODULES:
            source = inspect.getsource(module)
            for banned in BANNED_OPERATIONS:
                with self.subTest(module=module.__name__, operation=banned):
                    self.assertNotIn(banned, source)

    def test_the_scan_reads_source_a_control_operation_could_hide_in(self):
        # Vacuity guard for the assertion above, which is an absence check
        # and so passes over an empty module list or a getsource that
        # returned nothing. Both strings below are present today, and the
        # first is inside a comment, so the scan is shown to read prose as
        # well as code: a control operation named only in a docstring would
        # still be caught.
        sources = {module.__name__: inspect.getsource(module) for module in TMDD_MODULES}
        self.assertEqual(len(sources), 7)
        self.assertIn("dlFullEventUpdateRequest", sources["redash.query_runner.tmdd_request"])
        self.assertIn("deviceInformationRequestMsg", sources["redash.query_runner.tmdd_request"])

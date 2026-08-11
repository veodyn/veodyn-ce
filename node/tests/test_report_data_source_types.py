"""Exercises bin/report_data_source_types.py's actual gating logic.

The preflight runs from a Helm pre-upgrade hook and gates a deploy on its
exit code, so what matters is not just that PACK_PROVIDED_TYPES exists (see
tests/query_runner/test_legacy_types.py::test_pack_provided_types_are_reported_not_silently_dropped)
but that a row of a pack-provided type does not make the preflight exit
non-zero, while a row of a genuinely blocking type still does.

The script is not a package, so it is loaded here by file path with
importlib rather than a normal import statement. It has no module-level
database or Flask app-context dependency: main() imports redash.models
itself, deferred past module load, precisely so this file can call the pure
decision functions without a live database.
"""

import importlib.util
import os

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SCRIPT_PATH = os.path.join(_REPO_ROOT, "bin", "report_data_source_types.py")

_spec = importlib.util.spec_from_file_location("report_data_source_types", _SCRIPT_PATH)
report_data_source_types = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(report_data_source_types)


def test_pack_provided_type_is_reported_but_does_not_block():
    # A deployment without the pack still has riits_api rows; the preflight
    # must name them (an operator reading the output needs to know) but must
    # not fail the deploy over them, since a pack-installed image with those
    # same rows is in a correct state.
    counts = [("riits_api", 3)]
    blocking_reasons = report_data_source_types.build_blocking_reasons()

    assert "riits_api" not in report_data_source_types.offending_types(counts, blocking_reasons), (
        "a pack-provided type must not gate the deploy"
    )

    lines = report_data_source_types.format_report_lines(counts, blocking_reasons)
    assert any("riits_api" in line and "needs pack" in line for line in lines), (
        "a pack-provided type must still be named in the report, not silently dropped"
    )


def test_retired_type_blocks_the_deploy():
    # This is the control case: it proves the gate itself still works, so the
    # test above is showing riits_api specifically excluded rather than
    # showing a gate that has quietly stopped blocking anything at all.
    counts = [("riits_nextbus", 1)]
    blocking_reasons = report_data_source_types.build_blocking_reasons()

    offending = report_data_source_types.offending_types(counts, blocking_reasons)
    assert "riits_nextbus" in offending, "a retired type must still block the deploy"

    lines = report_data_source_types.format_report_lines(counts, blocking_reasons)
    assert any("riits_nextbus" in line and "BLOCKS DEPLOY" in line for line in lines)


def test_needs_manual_migration_type_blocks_the_deploy():
    # The other blocking bucket: a lossy rename, not a retirement. Both feed
    # blocking_reasons and both must gate; this covers the branch retired
    # types alone would not.
    counts = [("riits_gtfsrt", 1)]
    blocking_reasons = report_data_source_types.build_blocking_reasons()

    assert "riits_gtfsrt" in report_data_source_types.offending_types(counts, blocking_reasons)


def test_main_exit_code_matches_offending_types_being_empty_or_not():
    # main()'s actual return value (what sys.exit() receives, and what the
    # Helm hook checks) is exactly bool(offending_types(...)). Pinning that
    # relationship here means a future edit that stops wiring
    # offending_types into main()'s return value, or that starts returning
    # non-zero for a non-blocking type, gets caught even though this test
    # never touches a database.
    blocking_reasons = report_data_source_types.build_blocking_reasons()

    clean_counts = [("riits_api", 3), ("pg", 10)]
    assert report_data_source_types.offending_types(clean_counts, blocking_reasons) == []

    dirty_counts = [("riits_api", 3), ("riits_nextbus", 1)]
    assert report_data_source_types.offending_types(dirty_counts, blocking_reasons) == ["riits_nextbus"]

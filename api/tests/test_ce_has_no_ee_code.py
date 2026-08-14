"""The community tree contains no enterprise code, and does not reach for any.

Four claims, each failing for a different reason, because no one of them is
enough:

1. **No community module imports a moved one.** Read off the import graph. This
   is the claim that a build with no pack installed can start.
2. **The file list matches a committed allowlist exactly.** A ratchet. Claim 1
   is blind to a module nobody imports, and an enterprise service sitting
   unimported in a public tree is still enterprise code in a public tree.
3. **The app really starts with the pack absent.** In a subprocess with
   `veodyn_enterprise` made unimportable, because claims 1 and 2 are static and
   the one dynamic import in the package (`extras.load_extra_modules`) is
   invisible to both.
4. **The published schema names no enterprise path or schema key.** The wire, as
   the only artifact a client ever sees.

What replaced what: the first draft of claim 1 was a substring grep for
"Report", "Kpi" and "SharedLink" over the source. It was guaranteed red on
`telemetry.py:42` ("Report a failure") and `models/favorite.py:17`, neither of
which this task touched, and its banned list left out `ai_annotations`,
`kpi_eval`, `report_blocks`, `report_lifecycle` and `report_snapshot`, so five
enterprise services could have stayed and it would have passed. `tests/ce_imports.py`
says how the replacement works and where it is deliberately incomplete.
"""

import json
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Any

import pytest

from tests.ce_imports import PACKAGE, ce_python_files, ce_test_files, module_file, module_name, resolved_imports

API_DIR = PACKAGE.parent
ALLOWLIST = Path(__file__).parent / "ce_module_allowlist.json"

EE_PATH_PREFIXES = ("/kpis", "/reports", "/public", "/admin/shared-links", "/ai/digest", "/ai/outline")

# The bare "/public" above stays deny-by-default, and community's exceptions to
# it are listed here EXACTLY rather than by prefix.
#
# `routers/public_feeds.py` is community and mounts `/public/feeds/<slug>`, the
# anonymous feed-serving endpoint the feeds CE/EE split design puts there on
# purpose, so the prefix alone would fail the build. Narrowing the prefix to
# "/public/reports" was the obvious repair and it is the wrong one: that module
# is retained, so an enterprise route added INSIDE it -- `/public/feeds/{slug}/
# tokens` is the concrete one, since the same design reserves feed-token
# issuance for enterprise -- would then pass this assertion, the module
# allowlist and the import check all three. An exact-match exception keeps the
# deny-by-default and costs one line whenever community genuinely adds a public
# route, which is the trade this guard exists to make.
CE_PUBLIC_PATHS = frozenset({"/public/feeds/{slug}"})
EE_SCHEMA_PREFIXES = ("Kpi", "Report", "SharedLink", "Public", "Digest", "Outline", "Annotation")
EE_SCHEMA_KEEP = frozenset(
    {
        # Converse proposal shapes. They live in schemas/ai_create.py, which is
        # community: a converse turn can converge on a proposed KPI or report on
        # a build that has no endpoint to create one. Named here rather than
        # loosening the prefixes, so the exception is a decision and not a gap.
        "KpiProposalOut",
        "ReportProposalOut",
        "ReportOutlineOut",
        "OutlineSectionOut",
    }
)


def allowlist() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(ALLOWLIST.read_text())
    return loaded


def test_no_ce_module_imports_a_moved_module() -> None:
    """Asserted against the import graph, not against substrings."""
    moved = set(allowlist()["moved"])
    offences = [
        f"{path.relative_to(API_DIR)}: imports {name}"
        for path in [*ce_python_files(), *ce_test_files()]
        for name in sorted(resolved_imports(path))
        if name in moved
    ]

    assert offences == []


def test_the_import_graph_check_can_see_an_offending_import(tmp_path: Path) -> None:
    """The control. Every assertion above is that a list is empty, and a walk
    that had quietly stopped finding anything would satisfy it. A file that does
    import a moved module has to be found."""
    moved = sorted(allowlist()["moved"])[0]
    offender = tmp_path / "offender.py"
    offender.write_text(f"from {moved} import something\n")

    assert moved in resolved_imports(offender)


def test_the_ce_module_list_matches_the_committed_allowlist_exactly() -> None:
    """A ratchet. Growth fails and so does the baseline going stale, so a file
    cannot be quietly re-added and the allowlist cannot rot."""
    assert sorted(str(path.relative_to(PACKAGE)) for path in ce_python_files()) == allowlist()["retained"]


def test_every_moved_module_is_really_gone_from_this_package() -> None:
    """The other half of the ratchet, and the one that makes `moved` live rather
    than a comment. A module re-added under its old name fails here as well as in
    the retained list, and it fails naming itself."""
    still_here = [module for module in allowlist()["moved"] if module_file(module) is not None]

    assert still_here == []


def test_the_two_allowlist_halves_do_not_overlap() -> None:
    retained_modules = {module_name(PACKAGE / relative) for relative in allowlist()["retained"]}

    assert retained_modules & set(allowlist()["moved"]) == set()


PROBE = textwrap.dedent(
    """
    import importlib.abc
    import importlib.machinery
    import json
    import sys


    class Blocked(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path=None, target=None):
            if fullname == "veodyn_enterprise" or fullname.startswith("veodyn_enterprise."):
                raise ImportError("veodyn_enterprise is not installed in this interpreter")
            return None


    sys.meta_path.insert(0, Blocked())

    from veodyn_api.main import create_app

    app = create_app()
    print(
        json.dumps(
            {
                "paths": sorted(app.openapi()["paths"]),
                "enterprise_modules_loaded": sorted(
                    name for name in sys.modules if name.startswith("veodyn_enterprise")
                ),
                "moved_modules_loaded": sorted(name for name in sys.modules if name in set(json.loads(sys.argv[1]))),
            }
        )
    )
    """
)


def run_probe() -> dict[str, Any]:
    completed = subprocess.run(
        [sys.executable, "-c", PROBE, json.dumps(allowlist()["moved"])],
        capture_output=True,
        text=True,
        cwd=str(API_DIR),
    )
    assert completed.returncode == 0, f"the community app did not start without the pack:\n{completed.stderr}"
    loaded: dict[str, Any] = json.loads(completed.stdout)
    return loaded


def test_the_ce_app_starts_with_the_pack_uninstalled() -> None:
    """A subprocess with `veodyn_enterprise` blocked from the path, not a mock.

    The failure mode this exists for is an import that only works because the
    development machine happens to have the pack installed, and no assertion
    taken inside this pytest process can see it: this process has the pack, and
    once anything has imported it every later check reads a `sys.modules` that
    already contains it.

    The meta-path finder RAISES rather than returning None for a missing module,
    so a `try: import veodyn_enterprise except ImportError` in the host would
    still be caught and the app would still have to start.
    """
    result = run_probe()

    assert result["paths"], "the app built no routes at all"
    assert result["enterprise_modules_loaded"] == []
    assert result["moved_modules_loaded"] == []


def test_the_probe_can_tell_a_started_app_from_a_crashed_one() -> None:
    """The control for the probe. `subprocess.run` with `check=False` and an
    assertion on stdout would pass a run that printed nothing, so this shows the
    same harness failing when the thing it imports does not exist."""
    completed = subprocess.run(
        [sys.executable, "-c", "import veodyn_api.routers.kpis"],
        capture_output=True,
        text=True,
        cwd=str(API_DIR),
    )

    assert completed.returncode != 0
    assert "ModuleNotFoundError" in completed.stderr


def openapi() -> dict[str, Any]:
    schema: dict[str, Any] = json.loads((API_DIR / "openapi.json").read_text())
    return schema


def test_the_ce_openapi_names_no_ee_path() -> None:
    schema = openapi()

    named = [path for path in schema["paths"] if path.startswith(EE_PATH_PREFIXES) and path not in CE_PUBLIC_PATHS]
    assert named == []
    # A positive control: an empty document would satisfy the line above.
    assert "/tags/{object_type}/{object_id}" in schema["paths"]
    # And a second one for the exception itself, so a community build that
    # stopped serving feeds publicly cannot leave CE_PUBLIC_PATHS quietly
    # excusing a path nothing declares any more.
    assert CE_PUBLIC_PATHS <= schema["paths"].keys()


def test_the_ce_openapi_names_no_ee_schema_key() -> None:
    schema = openapi()
    named = [
        key
        for key in schema["components"]["schemas"]
        if key.startswith(EE_SCHEMA_PREFIXES) and key not in EE_SCHEMA_KEEP
    ]

    assert named == []
    # The four exceptions are real keys, not a list that has gone stale. Delete
    # one from schemas/ai_create.py and this is what says so.
    assert EE_SCHEMA_KEEP <= set(schema["components"]["schemas"])


@pytest.mark.parametrize("artifact", ["openapi.json"])
def test_the_committed_artifact_is_what_the_generator_produces(artifact: str) -> None:
    """The same check the gate runs. Kept here so a local run catches a stale
    artifact before CI does, and because every assertion above reads that file
    rather than the app."""
    dumped = subprocess.run(
        [sys.executable, "-m", "veodyn_api.openapi"],
        check=True,
        capture_output=True,
        text=True,
        cwd=str(API_DIR),
    ).stdout

    assert dumped == (API_DIR / artifact).read_text(), (
        f"{artifact} is stale: regenerate with `uv run python -m veodyn_api.openapi > openapi.json`"
    )

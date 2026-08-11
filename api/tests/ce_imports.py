"""Reading the community package's import graph off the source.

Static, not runtime, and that is the point. A runtime check walks `sys.modules`
after something has already imported the world, so it sees whatever the test
session happened to load; and a build with the pack installed would look exactly
like a build without it as soon as one test imported the pack. The graph here is
what the files say, which is what a deployment with no pack will do.

Two things it deliberately is not:

- **Not a substring scan.** The first draft of the guard grepped source for
  "Report", which appears in `telemetry.py` ("Report a failure"),
  `models/favorite.py` and `models/feed_expectation.py`, so it was red on files
  nobody had touched, and its banned list had holes in it (`ai_annotations`,
  `kpi_eval`, `report_blocks`, `report_lifecycle`, `report_snapshot`) large
  enough to let five enterprise modules stay. An import edge is the thing that
  actually breaks a community build, and it is what is measured.
- **Not complete.** `ast` cannot see `importlib.import_module(name)` with a
  computed name, and `veodyn_api/extras.py` uses exactly that: it is the seam a
  pack arrives through. That call is the one dynamic import in the package and
  it takes its argument from an environment variable, so nothing static could
  resolve it and nothing should. The runtime half of the guard covers what this
  cannot: `test_the_ce_app_starts_with_the_pack_uninstalled` builds the app in an
  interpreter where the pack is unimportable and then asserts on `sys.modules`.

`from veodyn_api.services import kpi_repo` is why every `from X import a, b` also
contributes `X.a` and `X.b` as candidate module names: without that the most
common way this package imports a service would be invisible.
"""

import ast
from pathlib import Path

import veodyn_api

PACKAGE = Path(veodyn_api.__file__).parent
TESTS = Path(__file__).parent
ROOT = "veodyn_api"


def ce_python_files() -> list[Path]:
    """Every source file in the community package, in path order."""
    return sorted(PACKAGE.rglob("*.py"))


def ce_test_files() -> list[Path]:
    """Every file in the test suite. They are checked too: a test module that
    imports a moved module fails collection in CI, where the pack is absent, and
    it fails the whole run rather than one test."""
    return sorted(TESTS.rglob("*.py"))


def module_name(path: Path) -> str:
    parts = list(path.relative_to(PACKAGE).with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join([ROOT, *parts])


def module_file(module: str) -> Path | None:
    """Where a `veodyn_api.*` module lives, or None if this build has no such
    module. Returning None rather than raising is what lets the same helper
    answer "is it gone" and "what does it import"."""
    if module != ROOT and not module.startswith(f"{ROOT}."):
        return None
    relative = module.removeprefix(f"{ROOT}.").replace(".", "/")
    for candidate in (PACKAGE / f"{relative}.py", PACKAGE / relative / "__init__.py"):
        if candidate.exists():
            return candidate
    return None


def imported_module_names(tree: ast.AST) -> set[str]:
    """Every dotted name an import statement in this file could be naming.

    A `from X import a` contributes both `X` and `X.a`, because `a` may be a
    submodule and there is no way to tell from the syntax. Resolution decides
    which it was, by asking whether a file exists.

    Relative imports are skipped: this package has none, and inventing a
    resolution for a form that does not occur would be untested code inside a
    guard.
    """
    named: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            named.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module is not None:
            named.add(node.module)
            named.update(f"{node.module}.{alias.name}" for alias in node.names)
    return named


def imports_of(path: Path) -> set[str]:
    return imported_module_names(ast.parse(path.read_text()))


def resolved_imports(path: Path) -> set[str]:
    """Every `veodyn_api.*` module this file names, resolved AND as written.

    Both, and the second half is the one that matters for the guard. Walking up
    to the nearest module that exists is what turns
    `veodyn_api.services.tags.tags_for` into `veodyn_api.services.tags`. Applied
    alone it also turns `veodyn_api.services.report_blocks`, a module that has
    been deleted, into `veodyn_api.services`, which is a real community package
    and is not on anybody's banned list. The import that a community build would
    actually crash on would have resolved itself into something harmless.

    So the name as written is kept as well. It costs a few dotted strings that
    are attributes rather than modules (`veodyn_api.services.tags.tags_for`),
    and none of those can collide with a moved module name, because a moved
    module name is a module.
    """
    resolved: set[str] = set()
    for name in imports_of(path):
        if name != ROOT and not name.startswith(f"{ROOT}."):
            continue
        resolved.add(name)
        candidate: str = name
        while candidate and module_file(candidate) is None:
            candidate = candidate.rpartition(".")[0]
        if candidate:
            resolved.add(candidate)
    return resolved


def reachable_from(module: str) -> set[str]:
    """Every community module reachable by following import statements."""
    seen: set[str] = set()
    pending = [module]
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        found = module_file(current)
        if found is not None:
            pending.extend(resolved_imports(found))
    return seen

#!/usr/bin/env python3
import importlib.util
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
BASELINE_PATH = SCRIPTS_DIR / "comment_baseline.py"
SCANNER_PATH = SCRIPTS_DIR / "comment_scanner.py"
EXIT_CANNOT_CHECK = 2
MAX_LISTED = 40
MIN_SCANNED_FILES = 200
NOT_WRITTEN_BY_HAND = (
    ("app/src/types/generated/", "pnpm gen:api-types regenerates it from the sidecar's openapi.json"),
    ("app/src/components/ui/", "shadcn writes these, comments and all, and re-writes them on an update"),
    ("node/migrations/versions/", "alembic templates every new revision with a header it owns"),
    ("helm/charts/flow/contrib-helm-chart/", "the vendored upstream chart, updated by replacement"),
)

USAGE = """check-comment-ratchet: comment lines may fall, never rise.

    python3 scripts/check-comment-ratchet.py
    python3 scripts/check-comment-ratchet.py --write-baseline

The global rule is zero comments in code. The tree predates it, so this is a
ratchet rather than a gate: a file may not gain comment lines, and a file with
none may not grow any. Toolchain directives are counted like any other comment,
because a count that argued about intent would need the judgement call the rule
exists to remove; what matters is that the number cannot go up.

Regenerate after a deliberate cleanup, and say in the commit message what left.

Four prefixes are not scanned, each because a tool writes the file and would
otherwise fail the ratchet for a correct change: see NOT_WRITTEN_BY_HAND. That
list is for generators, not for code somebody found inconvenient to clean.

One baseline serves both trees, so it holds no row a tree could disagree with:
the paths public_tree_parity_exceptions declares divergent or community-only
are skipped, and a recorded path the running tree does not have is passed over
rather than called stale. Regenerate from veodyn-de, which has every shared
path plus the deploy-only ones.
"""


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def excluded_prefixes():
    return tuple(prefix for prefix, _reason in NOT_WRITTEN_BY_HAND)


def paths_that_differ_between_the_trees():
    module_path = SCRIPTS_DIR / "public_tree_parity_exceptions.py"
    if not module_path.is_file():
        return frozenset()
    exceptions = load_module("public_tree_parity_exceptions", module_path)
    declared = list(exceptions.COMMUNITY_ONLY_PATHS) + list(exceptions.DIVERGENT_PATHS)
    return frozenset(path for path, _reason in declared)


def tracked_paths():
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "ls-files", "-z"],
        capture_output=True,
        check=True,
        text=True,
    )
    return [path for path in result.stdout.split("\0") if path]


def scan(scanner):
    counts = {}
    seen = set()
    unreadable = []
    per_tree = paths_that_differ_between_the_trees()
    for relative in tracked_paths():
        if not scanner.supports(relative) or relative.startswith(excluded_prefixes()):
            continue
        if relative in per_tree:
            continue
        absolute = REPO_ROOT / relative
        if not absolute.is_file():
            continue
        try:
            text = absolute.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as error:
            unreadable.append(f"{relative}: {type(error).__name__}")
            continue
        seen.add(relative)
        total = scanner.count(relative, text)
        if total:
            counts[relative] = total
    return counts, seen, unreadable


def write_baseline(counts, scanned):
    rows = "".join(f'    "{path}": {counts[path]},\n' for path in sorted(counts))
    BASELINE_PATH.write_text(
        "BASELINE = {\n"
        f"{rows}"
        "}\n"
        "\n"
        f"FILES_WITH_COMMENTS = {len(counts)}\n"
        f"COMMENT_LINES = {sum(counts.values())}\n"
        f"FILES_SCANNED = {scanned}\n",
        encoding="utf-8",
    )


def classify(counts, baseline, seen=None):
    new, grew, zeroed, improved = [], [], [], []
    for path, total in sorted(counts.items()):
        recorded = baseline.get(path)
        if recorded is None:
            new.append((path, total))
        elif total > recorded:
            grew.append((path, total, recorded))
        elif total < recorded:
            improved.append((path, total, recorded))
    for path, recorded in sorted(baseline.items()):
        if path in counts:
            continue
        if seen is not None and path not in seen:
            continue
        zeroed.append((path, recorded))
    return new, grew, zeroed, improved


def report(new, grew, zeroed):
    if new:
        print(f"FAIL new: {len(new)} file(s) carry comment lines and are not in the baseline.")
        for path, total in new[:MAX_LISTED]:
            print(f"    {path}: {total} comment line(s)")
        if len(new) > MAX_LISTED:
            print(f"    ... and {len(new) - MAX_LISTED} more")
        print()
    if grew:
        print(f"FAIL grew: {len(grew)} file(s) gained comment lines.")
        for path, total, recorded in grew[:MAX_LISTED]:
            print(f"    {path}: {recorded} -> {total}")
        if len(grew) > MAX_LISTED:
            print(f"    ... and {len(grew) - MAX_LISTED} more")
        print()
    if zeroed:
        print(f"FAIL stale: {len(zeroed)} recorded file(s) now have none, or are gone.")
        for path, recorded in zeroed[:MAX_LISTED]:
            print(f"    {path}: recorded {recorded}, now none")
        if len(zeroed) > MAX_LISTED:
            print(f"    ... and {len(zeroed) - MAX_LISTED} more")
        print()
    print(
        "The rule is zero comments in code, and cleanup is on-touch: delete the comments on\n"
        "lines you are already editing. Put an external reason (a spec requirement, an\n"
        "empirical threshold, a cross-repo invariant) in a doc, and let a name, a type, a\n"
        "named constant or a test carry the rest. A file that legitimately drops to zero, or\n"
        "leaves the tree, is recorded by regenerating:\n\n"
        "    python3 scripts/check-comment-ratchet.py --write-baseline\n"
    )


def main(argv):
    scanner = load_module("comment_scanner", SCANNER_PATH)
    counts, seen, unreadable = scan(scanner)
    scanned = len(seen)
    for line in unreadable:
        print(f"check-comment-ratchet: skipped, could not read {line}", file=sys.stderr)
    if scanned < MIN_SCANNED_FILES:
        print(
            f"check-comment-ratchet: only {scanned} file(s) opened and read, below the floor of "
            f"{MIN_SCANNED_FILES}. Refusing to report a tree clean of something it never looked "
            "at.",
            file=sys.stderr,
        )
        return EXIT_CANNOT_CHECK

    if "--write-baseline" in argv:
        write_baseline(counts, scanned)
        print(
            f"check-comment-ratchet: wrote {len(counts)} row(s), "
            f"{sum(counts.values())} comment line(s) across {scanned} scanned file(s)."
        )
        return 0

    if not BASELINE_PATH.is_file():
        print(
            "check-comment-ratchet: no baseline. Write one with --write-baseline.",
            file=sys.stderr,
        )
        return EXIT_CANNOT_CHECK

    baseline = load_module("comment_baseline", BASELINE_PATH).BASELINE
    new, grew, zeroed, improved = classify(counts, baseline, seen)
    if new or grew or zeroed:
        report(new, grew, zeroed)
        return 1

    total = sum(counts.values())
    recorded_total = sum(value for path, value in baseline.items() if path in seen)
    print(
        f"check-comment-ratchet: clean. {total} comment line(s) across {len(counts)} of "
        f"{scanned} scanned file(s), against {recorded_total} recorded."
    )
    print("not scanned, because a tool writes them:")
    for prefix, reason in NOT_WRITTEN_BY_HAND:
        print(f"    {prefix}: {reason}")
    if improved:
        print(
            f"{len(improved)} file(s) below their recorded count, {recorded_total - total} line(s) "
            "gone. Run --write-baseline to lock that in, or the ratchet still allows them back."
        )
        for path, total_now, recorded in improved[:MAX_LISTED]:
            print(f"    {path}: {recorded} -> {total_now}")
    return 0


if __name__ == "__main__":
    if "--help" in sys.argv or "-h" in sys.argv:
        print(USAGE)
        sys.exit(0)
    sys.exit(main(sys.argv[1:]))

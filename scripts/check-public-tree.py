#!/usr/bin/env python3
"""Fail if anything on the forbidden-paths manifest is back in the tree.

Run it with no arguments, from anywhere:

    python3 scripts/check-public-tree.py

The public/private split here is a branch split, not a repository split, and
git enforces none of it: `git merge main` restores all 81 deleted files in
one commit with no conflict and no prompt, several of them holding live
deploy credentials.

The list of paths lives in scripts/public_tree_forbidden_paths.py so a change
to it can be reviewed without reading any matching logic; this module holds
only the matching and the reporting.

Two surfaces are inspected. Tracked files (`git ls-files`) are the
publication surface and what a merge changes. Untracked files git is not
ignoring (`--others --exclude-standard`) are one `git add -A` from being
tracked. Ignored paths are not inspected at all, since git already refuses to
publish them. Both are fatal and reported separately, because a tracked hit
needs `git rm -r` and an untracked one needs the file moved or ignored.

It never opens a matched file: it prints the path and the manifest's reason
and nothing else, so its output is safe in a public CI log. Same rule as
scripts/scan-secrets.py: name a position, never a value.

Stdlib only, no pytest, no third-party imports, so it runs on a bare
`python:3.11` image with git installed and nothing else. Tests live in
scripts/test_check_public_tree.py and run under stdlib unittest.
"""

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_MODULE_PATH = Path(__file__).resolve().parent / "public_tree_forbidden_paths.py"

# 1 means the guard found something and did its job; 2 means it could not do
# its job at all, which must never read as a clean tree. Same split as
# scripts/scan-secrets.py.
EXIT_FOUND = 1
EXIT_CANNOT_CHECK = 2


def _load_by_path(name, path):
    """Load a module by file path rather than by package import, so this
    script needs nothing on sys.path. Same as scripts/scan-secrets.py.
    """
    import importlib.util

    if not path.is_file():
        print(
            f"check-public-tree: cannot find {name} at {path}. Without the manifest this "
            "script has nothing to check and must not exit clean.",
            file=sys.stderr,
        )
        sys.exit(EXIT_CANNOT_CHECK)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _git_paths(root, *args):
    """Return the repo-relative paths one `git ls-files` variant lists.

    `-z` and a NUL split rather than splitlines(): a filename may legally
    contain a newline, and without `-z` git would also quote non-ASCII names,
    which would then not compare equal to any manifest entry.
    """
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z", *args],
            capture_output=True,
            check=True,
        )
    except FileNotFoundError:
        print(
            "check-public-tree: no `git` binary on PATH. This script reads the tree through "
            "git and cannot fall back to walking the filesystem, because the distinction "
            "between tracked, untracked and ignored is the whole check.",
            file=sys.stderr,
        )
        sys.exit(EXIT_CANNOT_CHECK)
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode("utf-8", "replace").strip()
        print(
            f"check-public-tree: `git ls-files {' '.join(args)}` failed in {root}: {detail}",
            file=sys.stderr,
        )
        sys.exit(EXIT_CANNOT_CHECK)
    return [chunk.decode("utf-8", "replace") for chunk in completed.stdout.split(b"\0") if chunk]


def path_matches(rel_path, entry):
    """The manifest's matching rule: a trailing `/` means "anything under
    here", anything else means that exact path. See the manifest module's
    docstring for why the second half is exact rather than a prefix.
    """
    if entry.endswith("/"):
        return rel_path.startswith(entry)
    return rel_path == entry


def find_matches(rel_paths, forbidden_paths):
    """Map each manifest entry that matched to the paths that matched it.

    Returns a list of (entry, reason, [matched paths]) in manifest order, so
    the report reads in the order a human curated rather than in whatever
    order git happened to list files.
    """
    matches = []
    for entry, reason in forbidden_paths:
        matched = sorted(rel_path for rel_path in rel_paths if path_matches(rel_path, entry))
        if matched:
            matches.append((entry, reason, matched))
    return matches


def check_tree(root, forbidden_paths):
    """Inspect one checkout. Returns (tracked_matches, untracked_matches).

    Exits 2 rather than returning if git lists no tracked files at all: that
    is a broken invocation, and a guard that passes having looked at nothing
    reports success.
    """
    tracked = _git_paths(root)
    if not tracked:
        print(
            f"check-public-tree: git lists zero tracked files under {root}. That is a broken "
            "check, not a clean tree, so this is a failure rather than a pass.",
            file=sys.stderr,
        )
        sys.exit(EXIT_CANNOT_CHECK)
    untracked = _git_paths(root, "--others", "--exclude-standard")
    return find_matches(tracked, forbidden_paths), find_matches(untracked, forbidden_paths)


def _print_matches(heading, matches, remedy):
    print(f"\n{heading}")
    for entry, reason, matched in matches:
        print(f"\n  {entry}")
        print(f"    why it must not ship: {reason}")
        for rel_path in matched:
            print(f"    found: {rel_path}")
    print(f"\n  {remedy}")


def _print_deferred(deferred_paths):
    """Print the known exclusions on every run, including a clean one.

    The run that says "clean" is the one that has to keep saying what it is
    not looking at.
    """
    if not deferred_paths:
        return
    print("\ncheck-public-tree: deliberately NOT checked, with an expiry:")
    for entry, reason in deferred_paths:
        print(f"  {entry}: {reason}")


def _parse_args(argv):
    """`--root <dir>` and `--export`, both for checking an EXPORT rather than this tree.

    `--root` because the community edition lives in its own repository now, so
    the tree to check is not the tree this script lives in.

    `--export` because DEFERRED_PATHS means "not checked HERE, yet", and that
    permission does not travel. Promoting the deferral to FORBIDDEN instead
    would redden this repository's own gate on the branch the export is cut
    from, which is the one place the directory has to keep existing.

    The public repository starts private and is made public later, so its whole
    HISTORY publishes at the flip: a deferred path committed now and deleted
    before then is still published. The initial commit is the only safe place
    to exclude it, and it is what this flag is checked against.
    """
    root, export = REPO_ROOT, False
    rest = list(argv)
    while rest:
        arg = rest.pop(0)
        if arg == "--export":
            export = True
        elif arg == "--root":
            if not rest:
                print("check-public-tree: --root needs a directory", file=sys.stderr)
                sys.exit(EXIT_CANNOT_CHECK)
            root = Path(rest.pop(0)).resolve()
        else:
            print(f"check-public-tree: unknown argument {arg}", file=sys.stderr)
            sys.exit(EXIT_CANNOT_CHECK)
    if not root.is_dir():
        print(f"check-public-tree: no directory at {root}", file=sys.stderr)
        sys.exit(EXIT_CANNOT_CHECK)
    return root, export


def main(argv=None):
    root, export = _parse_args(sys.argv[1:] if argv is None else argv)
    manifest = _load_by_path("public_tree_forbidden_paths", MANIFEST_MODULE_PATH)
    forbidden = tuple(manifest.FORBIDDEN_PATHS)
    if export:
        forbidden += tuple(manifest.DEFERRED_PATHS)
    tracked_matches, untracked_matches = check_tree(root, forbidden)

    if tracked_matches:
        _print_matches(
            "check-public-tree: FORBIDDEN PATHS ARE TRACKED IN THIS TREE.",
            tracked_matches,
            "Remove them with `git rm -r`, not `rm`. If they arrived in a merge from a "
            "private branch, remove them in the merge commit itself rather than in a "
            "follow-up, so the public branch never holds a commit that contains them.",
        )
    if untracked_matches:
        _print_matches(
            "check-public-tree: forbidden paths are present but untracked.",
            untracked_matches,
            "Git is not ignoring these, so `git add -A` would commit them. Move them out "
            "of the tree, or add them to .gitignore if they are local working files that "
            "belong here but not in a commit.",
        )
    if tracked_matches or untracked_matches:
        print(
            "\nIf one of these paths genuinely belongs in the public tree now, that is a "
            "decision to record: remove its entry from scripts/public_tree_forbidden_paths.py "
            "in the same commit, with the reasoning. Do not add an exclusion to silence it."
        )
        return EXIT_FOUND

    if not export:
        _print_deferred(manifest.DEFERRED_PATHS)
    else:
        print(
            "\ncheck-public-tree: --export, so the deferred paths were CHECKED rather than "
            "skipped. A deferral is this repository's permission to still hold something; "
            "it does not travel to the export, whose history publishes in full at the flip."
        )
    print(f"\ncheck-public-tree: clean, none of the {len(forbidden)} forbidden paths exist under {root}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

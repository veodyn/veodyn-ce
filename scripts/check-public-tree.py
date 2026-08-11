#!/usr/bin/env python3
"""Fail if anything on the forbidden-paths manifest is back in the tree.

Run it with no arguments, from anywhere:

    python3 scripts/check-public-tree.py

Why this exists: the public/private split in this repository is a branch
split, not a repository split. `main` keeps the deployment configuration and
the internal working documents; the public branch had them deleted. Git
enforces none of that. `git merge main` restores all 81 deleted files in a
single commit with no conflict to resolve and no prompt, several of them
holding live deploy credentials, and the public branch silently stops being
publishable. A documented review step does not close that: the whole failure
mode is that nobody looks. This does, because a job fails.

The list of paths lives in scripts/public_tree_forbidden_paths.py, on
purpose: reviewing a change to the list should not require reading any
matching logic, and the list is what people will actually edit. This module
holds only the matching and the reporting.

What it inspects, and why both:

- **Tracked files** (`git ls-files`). This is the publication surface and
  the thing a merge from `main` changes. It is the check that matters.
- **Untracked files that git is not ignoring**
  (`git ls-files --others --exclude-standard`). One `git add -A` away from
  being tracked. Ignored paths are deliberately not inspected: git already
  refuses to publish those, so failing on them would only train people to
  weaken this script.

Both are fatal, but they are reported separately, because the fix differs: a
tracked hit needs `git rm -r`, an untracked hit needs the file moved out of
the tree or added to .gitignore.

It never opens a matched file. It reports the path and the manifest's stated
reason and nothing else, so its output stays safe to paste into a public CI
log even when what it found was a file full of secrets. Same rule as
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

# Exit codes. 1 means the guard found something and did its job; 2 means the
# guard could not do its job at all, which must never be confused with a
# clean tree. scripts/scan-secrets.py uses the same two-code split for the
# same reason.
EXIT_FOUND = 1
EXIT_CANNOT_CHECK = 2


def _load_by_path(name, path):
    """Load a module by file path rather than by package import, so this
    script needs nothing on sys.path and no package layout around it. Same
    approach, and the same reasoning, as scripts/scan-secrets.py.
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
    is a broken invocation (wrong directory, no repository, a `git ls-files`
    that silently returned nothing), and a guard that passes because it
    looked at nothing is worse than no guard, since it reports success.
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

    An exclusion that is only visible to whoever opens the manifest is an
    exclusion that gets forgotten. Printing it on the passing path is the
    point: the run that says "clean" is the one that has to keep saying
    "clean, and here is what it is not looking at".
    """
    if not deferred_paths:
        return
    print("\ncheck-public-tree: deliberately NOT checked, with an expiry:")
    for entry, reason in deferred_paths:
        print(f"  {entry}: {reason}")


def _parse_args(argv):
    """`--root <dir>` and `--export`, both for checking an EXPORT rather than this tree.

    The export is the tree pushed to the public repository, which is no longer
    this repository: the community edition lives in its own repo now, produced
    from this one. Two things follow, and they are why these flags exist.

    `--root` because the tree to check is not the tree the script lives in.

    `--export` because DEFERRED_PATHS means "not checked HERE, yet", and that
    answer does not survive the trip. A deferred path is one this monorepo is
    still allowed to hold, docs/superpowers/ being the whole of it: the specs
    and plans the remaining work is executed against, which cannot be deleted
    here without deleting the instructions for their own deletion. None of that
    reasoning applies to the exported tree, which needs none of it and must not
    carry it.

    The flag is what keeps both facts true at once, and it is the reason the
    deferral is NOT simply promoted to FORBIDDEN. Promoting it would redden this
    repository's own gate on the branch the export is cut from, which is the one
    place the directory has to keep existing.

    It matters more under a private-first flip than it would have otherwise.
    The public repository starts private and is made public later, so its whole
    HISTORY publishes at that moment, not just its final tree. A deferred path
    committed now and deleted before the flip is still there in history. The
    only safe time to exclude it is the initial commit, which is what this flag
    is checked against.
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

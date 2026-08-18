#!/usr/bin/env python3
"""Produce the tree that goes to the public community-edition repository.

Builds the tree that repository starts from: every tracked file at a given
ref, minus the paths that must not travel, validated by the same three guards
that run in CI. It imports scripts/public_tree_forbidden_paths.py rather than
restating it, so the export cannot disagree with the guard.

Two categories are excluded, and the difference matters:

  FORBIDDEN_PATHS  must not exist in this tree at all. One found here is a
                   guard failure, which this reports rather than dropping.

  DEFERRED_PATHS   may exist HERE and must not travel. All of it is
                   docs/superpowers/, which cannot be deleted from this
                   repository without deleting the instructions for its own
                   deletion. That permission is local and does not travel.

The deferral is why the export needs a script rather than a `git push`. The
public repository starts PRIVATE and is made public later, so its whole
HISTORY publishes at that moment: a deferred path committed to the export and
deleted before the flip is published anyway. The initial commit is the only
safe place to exclude it.

This excludes what MUST NOT ship and nothing else. `.gitlab-ci.yml` and
`ci/*.yaml` travel on purpose: the GitHub workflows are ports that each cite
their GitLab original as the record of why their steps exist. Worth revisiting
at the flip, once that rationale lives in the workflows themselves.

Stdlib only, same as the guards, so it runs anywhere they do.

Usage:
    scripts/export-ce-tree.py <output-dir> [--ref REF]
"""

import argparse
import importlib.util
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = REPO_ROOT / "scripts"
MANIFEST_MODULE_PATH = SCRIPTS / "public_tree_forbidden_paths.py"

EXIT_FOUND = 1
EXIT_CANNOT_EXPORT = 2


def _load_manifest():
    spec = importlib.util.spec_from_file_location("public_tree_forbidden_paths", MANIFEST_MODULE_PATH)
    if spec is None or spec.loader is None:
        print(f"export-ce-tree: cannot load {MANIFEST_MODULE_PATH}", file=sys.stderr)
        sys.exit(EXIT_CANNOT_EXPORT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _git(*args, cwd=REPO_ROOT):
    return subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True)


def path_excluded(rel_path, entries):
    """Same matching rule as the guard: a trailing slash is a prefix, otherwise exact.

    Duplicated rather than imported because check-public-tree.py's filename has
    a hyphen and is not importable without a loader dance. The rule is two
    lines and pinned by a test; the LIST is what must not be duplicated.
    """
    return any(
        rel_path.startswith(entry) if entry.endswith("/") else rel_path == entry
        for entry in entries
    )


def tracked_at(ref):
    out = _git("ls-tree", "-r", "--name-only", "-z", ref).stdout
    return [p for p in out.split("\0") if p]


def export(out_dir, ref):
    manifest = _load_manifest()
    forbidden = tuple(entry for entry, _ in manifest.FORBIDDEN_PATHS)
    deferred = tuple(entry for entry, _ in manifest.DEFERRED_PATHS)

    files = tracked_at(ref)
    if not files:
        print(f"export-ce-tree: `git ls-tree {ref}` listed no files. Refusing to export nothing.", file=sys.stderr)
        sys.exit(EXIT_CANNOT_EXPORT)

    # A forbidden path present at the ref is a guard failure, not something to
    # silently drop.
    present_forbidden = sorted({f for f in files if path_excluded(f, forbidden)})
    if present_forbidden:
        print(
            f"export-ce-tree: {len(present_forbidden)} FORBIDDEN path(s) are tracked at {ref}.\n"
            "These should never have reached a commit. Fix the tree, do not re-run with them dropped:",
            file=sys.stderr,
        )
        for path in present_forbidden[:20]:
            print(f"  {path}", file=sys.stderr)
        sys.exit(EXIT_FOUND)

    keep = [f for f in files if not path_excluded(f, deferred)]
    dropped = len(files) - len(keep)
    if deferred and dropped == 0:
        print(
            "export-ce-tree: the manifest defers "
            f"{', '.join(deferred)} but nothing at {ref} matched it.\n"
            "Either the deferral is stale or the ref is wrong. Refusing to export on an "
            "assumption nobody checked.",
            file=sys.stderr,
        )
        sys.exit(EXIT_CANNOT_EXPORT)

    out_dir = Path(out_dir).resolve()
    if out_dir.exists() and any(out_dir.iterdir()):
        print(f"export-ce-tree: {out_dir} exists and is not empty. Refusing to write into it.", file=sys.stderr)
        sys.exit(EXIT_CANNOT_EXPORT)
    out_dir.mkdir(parents=True, exist_ok=True)

    # git archive with an explicit pathspec list, so the output is exactly the
    # files decided above and cannot pick up the ignored state a developer
    # checkout carries.
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "ce.tar"
        with archive.open("wb") as handle:
            proc = subprocess.run(
                ["git", "-C", str(REPO_ROOT), "archive", "--format=tar", ref, "--", *keep],
                stdout=handle,
                stderr=subprocess.PIPE,
                check=False,
            )
        if proc.returncode != 0:
            print(f"export-ce-tree: git archive failed: {proc.stderr.decode()[:500]}", file=sys.stderr)
            sys.exit(EXIT_CANNOT_EXPORT)
        with tarfile.open(archive) as tar:
            tar.extractall(out_dir, filter="data")

    return out_dir, len(keep), dropped, deferred


def validate(out_dir):
    """Run the guards against the export, using the EXPORT's own copies of them.

    scan-secrets.py and check-clean-tree.py take no root argument: each derives
    the tree to scan from its own __file__. Run from this repository they would
    scan this repository, pass, and report a clean export nothing looked at.
    Running the export's copies also exercises the guards the new repository
    will run, against the tree it will run them on.

    check-public-tree is the one that does take --root, and it is given
    --export so the deferred paths are checked rather than skipped.
    """
    _git("init", "-q", cwd=out_dir)
    _git("add", "-A", cwd=out_dir)

    exported_scripts = out_dir / "scripts"
    missing = [
        name
        for name in ("check-public-tree.py", "scan-secrets.py", "check-clean-tree.py")
        if not (exported_scripts / name).is_file()
    ]
    if missing:
        print(
            f"export-ce-tree: the export is missing its own guard(s): {', '.join(missing)}.\n"
            "Validating with this repository's copies instead would check the wrong tree, "
            "so this refuses rather than falling back.",
            file=sys.stderr,
        )
        sys.exit(EXIT_CANNOT_EXPORT)

    checks = (
        ("check-public-tree", [sys.executable, str(exported_scripts / "check-public-tree.py"), "--export"]),
        ("scan-secrets", [sys.executable, str(exported_scripts / "scan-secrets.py")]),
        ("check-clean-tree", [sys.executable, str(exported_scripts / "check-clean-tree.py")]),
    )
    failed = []
    for name, cmd in checks:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=out_dir)
        status = "ok" if result.returncode == 0 else f"FAILED (exit {result.returncode})"
        print(f"  {name}: {status}")
        if result.returncode != 0:
            failed.append((name, result.stdout[-2000:], result.stderr[-1000:]))
    return failed


def main():
    parser = argparse.ArgumentParser(description="Build the public community-edition tree.")
    parser.add_argument("out_dir", help="directory to write the export into; must not exist or must be empty")
    parser.add_argument("--ref", default="HEAD", help="git ref to export (default: HEAD)")
    args = parser.parse_args()

    out_dir, kept, dropped, deferred = export(args.out_dir, args.ref)
    print(f"export-ce-tree: exported {kept} file(s) from {args.ref} to {out_dir}")
    print(f"export-ce-tree: withheld {dropped} file(s) under {', '.join(deferred)}")
    print("export-ce-tree: validating the export, with deferred paths checked:")

    failed = validate(out_dir)
    if failed:
        for name, out, err in failed:
            print(f"\n----- {name} -----\n{out}\n{err}", file=sys.stderr)
        print(
            f"\nexport-ce-tree: {len(failed)} guard(s) failed against the EXPORT. "
            "Nothing here is safe to push. Fix the source tree, delete the export, and re-run.",
            file=sys.stderr,
        )
        return EXIT_FOUND

    print(f"\nexport-ce-tree: clean. {out_dir} is the tree the public repository starts from.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

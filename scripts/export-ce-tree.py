#!/usr/bin/env python3
"""Produce the tree that goes to the public community-edition repository.

The community edition is moving to a repository of its own, created private and
made public later. This builds the tree that repository starts from: every
tracked file at a given ref, minus the paths that must not travel, validated by
the same three guards that run in CI.

Why a script and not a documented `cp` recipe. The set of paths that must not
travel is already written down once, in
scripts/public_tree_forbidden_paths.py, and it is enforced on every commit. A
recipe would be a second copy of that list, and the copy nobody runs is the one
that drifts. This imports the manifest instead, so there is exactly one list and
the export cannot disagree with the guard.

Two categories are excluded, and the difference matters:

  FORBIDDEN_PATHS  must not exist in this tree at all. None of them should be
                   found here; if one is, that is a guard failure and this
                   script says so rather than quietly dropping it.

  DEFERRED_PATHS   may exist HERE and must not travel. The whole of it is
                   docs/superpowers/, the specs and plans the remaining
                   migration work is executed against, which cannot be deleted
                   from this repository without deleting the instructions for
                   their own deletion. That reasoning is local to this
                   repository and does not survive the trip.

The deferral is the reason the export needs a script rather than a `git push`.
The public repository starts PRIVATE and is made public later, so its whole
HISTORY becomes public at that moment, not just its final tree. A deferred path
committed to the export and deleted before the flip is published anyway. The
initial commit is the only safe place to exclude it.

What this script excludes is what MUST NOT ship, and nothing else. Anything
safe to publish but arguably unwanted in the new repository is a product
decision, and burying one in an exclusion list here would be the wrong place to
make it.

The live example is GitLab CI. `.gitlab-ci.yml` and `ci/*.yaml` travel, and
that is a decision rather than an oversight. Three reasons, and a trigger for
revisiting it:

  - The GitHub workflows are ports, and each one cites its GitLab original as
    the record of why its steps exist ("Read ci/redash-test.yaml for why each
    step exists"). Dropping the originals turns every one of those into a
    dangling reference, which costs more than the dead config does.
  - The new repository is PRIVATE until the flip, so this is reversible in a
    way publication is not.
  - Removing them later is a few lines here, and the guards already pass on
    them, so nothing is at risk by waiting.

Revisit at the flip. The argument on the other side is real and does not go
away: GitLab CI configuration in a GitHub-native public repository is dead
weight that tells a contributor the wrong thing about where CI runs. If the
port's rationale has by then been folded into the workflows themselves, the
originals should go with the same commit.

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

    Deliberately duplicated in behaviour rather than imported, because
    check-public-tree.py's filename has a hyphen in it and is not importable as
    a module without the loader dance the guard's own tests use. The rule is two
    lines and pinned by a test; the LIST is what must not be duplicated, and it
    is not.
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
    # silently drop. The guard runs on every commit precisely so this list is
    # empty; if it is not, the interesting fact is that it is not.
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
    # files decided above rather than a copy of a working directory. A developer
    # checkout carries ignored state a clone does not; this cannot pick it up.
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

    Not this repository's copies, and the distinction is the difference between
    a check and a decoration. scan-secrets.py and check-clean-tree.py take no
    root argument: each derives the tree to scan from its own __file__. Invoked
    from here with the export's path appended they ignore it, scan this
    repository, pass, and report a clean export that nothing looked at. That is
    the shape of failure this project has shipped before, so it is worth naming:
    the guard runs, exits 0, and is answering about the wrong tree.

    Running the export's own copies is also the stronger check. scripts/ travels
    in the export, so this exercises the guards the new repository will actually
    run, against the tree it will actually run them on. A guard broken by the
    export is then caught here rather than on the first pipeline over there.

    check-public-tree is the one that does take --root, and it is given --export
    so the deferred paths are checked rather than skipped. It is invoked from
    the export as well, for the same reason as the other two.
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

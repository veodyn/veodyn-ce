"""Monorepo-coverage sentinel for scripts/scan-secrets.py.

Split out of scan-secrets.py purely to keep that script under this repo's
file-size limit; scan-secrets.py loads this by file path, the same way it
loads scan_secrets_extra_allowlist.py (see that module's own docstring for
why: by-path loading, not package import, is what lets scan-secrets.py run
standalone with no dependency on any package layout). Unlike
scan_secrets_extra_allowlist.py, this module declares no credential-shaped
or password-shaped literal of its own (no long hex/base64/UUID run, and it
is not a deploy-config file the password-shaped detector even looks
inside), so it is not added to scan-secrets.py's SELF_REL_PATHS: there is
nothing here for the scan to self-match on.

Why this exists: discover_tracked_text_files() silently falls back to
walking only the node/ checkout whenever `git` is missing or `.git` is
unreachable, and that fallback returns a non-empty file list, so a bare
"zero files" guard would not catch it. A scan reporting "clean" after
walking a fraction of the repo is worse than no scan, so this module makes
that narrowing fail loudly instead.

Every top-level area of this monorepo that can plausibly hold a credential
is covered, not just `app/` and `docs/`: those two alone let a sparse
checkout or a discovery regression that dropped `api/`, `node/`, `helm/`,
and `scripts/` still pass. `ROOT_LABEL` stands in for files with no
directory component at all (`CLAUDE.md`, `.gitlab-ci.yml`, ...), checked the
same way.

That claim was false until `ci/` and `compose/` were added to the tuple
below. `compose/` is the worse of the two omissions and it is the newer
directory: it holds the seeding scripts that GENERATE credentials and write
them to disk, so a discovery regression that dropped it would have narrowed
the scan away from the one place in this tree whose job is producing
secrets. This module's own docstring asserted full coverage the whole time,
which is why the list and the claim are now checked rather than described:
scan_secrets_test_support.MONITORED_PREFIXES reads this tuple instead of
restating it.

A single scanned file under a prefix is not proof of coverage either: a
scan that discovers 500 files under `app/` but only opens one of them is
still a severely narrowed scan that happened to leave a lone match
standing. Requiring a fixed count (say, "at least 20") would rot as the
tree grows or shrinks, so the bar is instead a proportion of what this same
run's own discovery step found under that prefix.

WHAT THE RATIO MEASURES, and why the denominator is not "discovered"
--------------------------------------------------------------------
The bar is scanned / SCANNABLE, where scannable is the files discovered
under a prefix minus the ones whose CONTENT is not text (see
read_text_or_binary below). It was scanned / discovered until
scripts/export-ce-tree.py exposed that as a measurement of the wrong thing:
the export withholds docs/superpowers/, 90 markdown files, and what is left
of `docs/` is majority screenshots, so the export read 41/93 = 0.44 and the
guard refused a tree in which every single scannable file had been scanned.

A PNG in the denominator is not a coverage gap. No credential can be typed
into it as text, so counting it against coverage measures the tree's
screenshot-to-prose ratio and calls the result "coverage". That number moves
whenever the shape of a directory changes, which is exactly what happened.

The denominator subtracts ONLY files proven non-text by content, and that
distinction is load-bearing in three directions:

  Explicitly excluded files STAY in the denominator. `is_excluded` is a
  policy decision, and an over-broad exclusion pattern that starts skipping
  real source files is precisely the regression this floor catches;
  subtracting its hits would make that regression invisible. Today that
  keeps 13 genuinely-text files counting against `app/` (9 `.mjs` scripts, a
  `.jsonc`, a `.geojson`, an `.svg`, and `pnpm-lock.yaml`), all skipped on
  the extension allowlist rather than on their content.

  Which is why the split is NOT "did is_excluded skip it". That was the
  obvious reading and it is wrong on this tree: `.png` is not in the fork's
  TEXT_EXTENSIONS, so screenshots never reach the content sniff at all, they
  are dropped by `is_excluded` one branch earlier. Splitting on the branch
  that skipped a file would have left the export at 41/93 and still failing,
  while quietly excusing those 9 `.mjs` files. The question asked is about
  the bytes, so the bytes are what gets asked.

  Unreadable is not binary. A path that discovery listed and that is not on
  disk, or cannot be opened at all, stays in the denominator: that is a
  discovery/checkout regression, and it is one of the two failures this
  sentinel was built for. read_text_or_binary probes the open separately
  rather than reading "returned None" as "binary".

Measured per-prefix scanned/scannable, this repo at feat/m4-actions-port and
the export produced from it (only `docs/` differs, and it is the whole
reason for this change):

                 this repo              CE export
    app/       1207/1220  0.99      1207/1220  0.99
    docs/       147/150   0.98        41/44    0.93
    api/        146/149   0.98       146/149   0.98
    node/       390/401   0.97       390/401   0.97
    helm/        49/51    0.96        49/51    0.96
    scripts/     25/27    0.93        25/27    0.93
    ci/           5/5     1.00         5/5     1.00
    compose/      7/7     1.00         7/7     1.00
    <root>        8/8     1.00         8/8     1.00

The floor is 0.93 in both trees, so MIN_SCAN_COVERAGE_RATIO of 0.5 leaves
real headroom for legitimate exclusions while still catching a discovery or
filtering regression that silently narrows a prefix. These are ratios of
scannable files, not of discovered files: the numbers above are NOT
comparable to the ones this table carried before, which had screenshots in
their denominators.

CLOSING THE HOLE THE NEW DENOMINATOR OPENS
------------------------------------------
The denominator now depends on the content sniff, so if the sniff regresses
and starts calling text files binary, the denominator shrinks with the
numerator and the ratio stays near 1.0: the guard goes quiet exactly when it
should shout. (A TOTAL collapse is still caught, by scan-secrets.py's
existing "zero files actually scanned" refusal. It is a partial regression,
the kind that reclassifies one shape of file, that this has to catch.)

MAX_TEXT_EXTENSION_BINARY_SHARE closes it by cross-checking the content
verdict against the fork's independent, name-based one. TEXT_EXTENSIONS is a
deliberately narrow positive list of suffixes a credential could be typed
into; of the discovered files carrying one of those suffixes, at most this
share may sniff as binary. Measured today: 1/1966 = 0.0005 here and 1/1860
in the export, the single file being app/src/features/slots.tsx, which uses
a literal NUL byte as a map-key separator and has therefore never been
scanned. So the bar sits at 100x the observed value.

A ceiling on each group's binary share was the other candidate and is worse
on both counts. It rots: `docs/` moved from 0.25 binary to 0.53 binary just
by withholding docs/superpowers/, so any ceiling with headroom above today's
tree has to sit near 0.9, and a per-prefix table of them is the magic-number
rot this change exists to remove. And it is blunt: at 0.9 it only fires on a
near-total collapse, which is already caught. The cross-check compares two
signals that regress independently, and 100x headroom means a sniff that
starts misreading even a few percent of known-text files trips it.
"""

import math
import sys
from pathlib import Path

SENTINEL_PREFIXES = ("app/", "docs/", "api/", "node/", "helm/", "scripts/", "ci/", "compose/")
ROOT_LABEL = "<repo-root files>"
MIN_SCAN_COVERAGE_RATIO = 0.5
MAX_TEXT_EXTENSION_BINARY_SHARE = 0.05


def sentinel_group(rel_path):
    """Return the sentinel group `rel_path` belongs to (a prefix, or
    ROOT_LABEL for a file with no directory component), or None if it falls
    outside every monitored area (e.g. `.harness/`, `.claude/`: not
    plausible credential locations, and not this scan's job to prove).
    """
    for prefix in SENTINEL_PREFIXES:
        if rel_path.startswith(prefix):
            return prefix
    if "/" not in rel_path:
        return ROOT_LABEL
    return None


def new_group_counter():
    return dict.fromkeys(SENTINEL_PREFIXES + (ROOT_LABEL,), 0)


def read_text_or_binary(full_path, read_text_if_plausibly_text):
    """Return (text, is_binary) for one discovered file.

    `read_text_if_plausibly_text` is the fork's own single source of truth
    for "is this text", passed in rather than imported so this module keeps
    no second opinion about it. It answers None for two different facts
    though, binary content and an unreadable file, and only the first is
    safe to take out of a coverage denominator. So a None is probed once
    more: a file that will not even open is reported as neither text nor
    binary, and keeps counting against coverage.
    """
    text = read_text_if_plausibly_text(full_path)
    if text is not None:
        return text, False
    try:
        with open(full_path, "rb"):
            pass
    except OSError:
        return None, False
    return None, True


class CoverageCounts:
    """Per-group discovered/scanned/binary tallies, plus the global
    text-extension cross-check population. Built by scan-secrets.py's scan
    loop as it walks the discovered paths, then handed to enforce_coverage.
    """

    def __init__(self, text_extensions):
        self._text_extensions = text_extensions
        self.discovered = new_group_counter()
        self.scanned = new_group_counter()
        self.binary = new_group_counter()
        self.text_extension_discovered = 0
        self.text_extension_binary = 0

    def count_discovered(self, group, rel_path):
        self.discovered[group] += 1
        if Path(rel_path).suffix in self._text_extensions:
            self.text_extension_discovered += 1

    def count_binary(self, group, rel_path):
        self.binary[group] += 1
        if Path(rel_path).suffix in self._text_extensions:
            self.text_extension_binary += 1

    def count_scanned(self, group):
        self.scanned[group] += 1


def _refuse(message):
    print(f"scan-secrets: {message}", file=sys.stderr)
    sys.exit(2)


def _enforce_binary_sniff_sanity(counts):
    """Refuse if the content sniff disagrees with the fork's extension
    allowlist on more than MAX_TEXT_EXTENSION_BINARY_SHARE of the files that
    allowlist calls text. See this module's docstring: the coverage
    denominator trusts the sniff, so the sniff is what has to be checked.
    """
    total = counts.text_extension_discovered
    if total == 0:
        return
    share = counts.text_extension_binary / total
    if share > MAX_TEXT_EXTENSION_BINARY_SHARE:
        _refuse(
            f"{counts.text_extension_binary}/{total} discovered files whose extension is on the "
            f"scan's text-extension allowlist read as BINARY content ({share:.1%}, above the "
            f"permitted {MAX_TEXT_EXTENSION_BINARY_SHARE:.0%}). Those two judgements are supposed "
            "to agree, and the coverage denominator below subtracts whatever the content sniff "
            "calls binary, so a sniff that misreads text as binary would hide a narrowed scan "
            "behind a healthy-looking ratio. Refusing to pass on a ratio computed from a sniff "
            "that looks broken."
        )


def enforce_coverage(counts):
    """Exit(2) with a stated reason if the binary sniff looks broken, or if
    discovery or scanning narrowed to less than a plausible fraction of any
    monitored area. Returns normally when every monitored area was covered.
    """
    _enforce_binary_sniff_sanity(counts)
    for group, discovered_count in counts.discovered.items():
        if discovered_count == 0:
            _refuse(
                f"zero files were discovered under {group!r} at all; this monorepo always tracks "
                "files there, so discovery itself narrowed (a sparse checkout, or the redash-only "
                "fallback with no `git` binary or no reachable .git). Refusing to pass having "
                "checked only part of the monorepo."
            )
        binary_count = counts.binary[group]
        scannable_count = discovered_count - binary_count
        if scannable_count <= 0:
            _refuse(
                f"all {discovered_count} file(s) discovered under {group!r} read as binary content, "
                "so there is nothing there this scan could have inspected as text. A monitored area "
                "of this monorepo is never wholly binary; either discovery narrowed to its assets or "
                "the text sniff is broken. Refusing to pass having inspected nothing there."
            )
        required = max(1, math.ceil(scannable_count * MIN_SCAN_COVERAGE_RATIO))
        scanned_count = counts.scanned[group]
        if scanned_count < required:
            _refuse(
                f"only {scanned_count}/{scannable_count} scannable files discovered under "
                f"{group!r} were actually scanned, below the required {required} "
                f"({MIN_SCAN_COVERAGE_RATIO:.0%} of scannable). Scannable excludes the "
                f"{binary_count} of {discovered_count} discovered file(s) whose content is not text "
                "at all, so this is not screenshots: either real text files there were excluded or "
                "unreadable far more than usual, or discovery itself narrowed after listing the "
                "paths by name. Refusing to pass having checked only part of the monorepo."
            )

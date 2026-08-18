"""Monorepo-coverage sentinel for scripts/scan-secrets.py.

Loaded by file path from scan-secrets.py, so that script keeps running with
no package layout around it. This module declares no credential-shaped
literal of its own, so it is not in scan-secrets.py's SELF_REL_PATHS.

discover_tracked_text_files() falls back to walking only the node/ checkout
when `git` is missing or `.git` is unreachable, and that fallback returns a
non-empty file list, so a bare "zero files" guard would not catch it. This
module fails a run whose discovery or scanning narrowed to part of the tree.
scan_secrets_test_support.MONITORED_PREFIXES reads SENTINEL_PREFIXES below
rather than restating it.

The bar is scanned / SCANNABLE per prefix, where scannable is the files
discovered under a prefix minus the ones whose CONTENT is not text (see
read_text_or_binary). Two cases stay in the denominator on purpose: a file
`is_excluded` skipped, because an over-broad exclusion pattern that starts
skipping real source files is the regression this floor catches; and a path
discovery listed that will not open, which is a checkout regression rather
than a binary. Only content proven non-text is subtracted, since no
credential can be typed into a PNG as text.

Measured scanned/scannable at feat/m4-actions-port, in this repo and in the
CE export produced from it: the lowest prefix is 0.93 in both trees
(scripts/ here, scripts/ and docs/ in the export, which withholds
docs/superpowers/ and is left majority screenshots under docs/). So
MIN_SCAN_COVERAGE_RATIO of 0.5 leaves real headroom.

MAX_TEXT_EXTENSION_BINARY_SHARE cross-checks the content sniff against the
fork's independent, name-based TEXT_EXTENSIONS, because the denominator
trusts the sniff: a sniff that started calling text files binary would
shrink numerator and denominator together and hold the ratio near 1.0.
Measured 1/1966 = 0.0005 here and 1/1860 in the export, the single file
being app/src/features/slots.tsx, which uses a literal NUL byte as a map-key
separator. The bar sits at 100x the observed value.
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

    `read_text_if_plausibly_text` is the fork's own source of truth for "is
    this text", passed in rather than imported. It answers None for both
    binary content and an unreadable file, and only the first may leave the
    coverage denominator, so a None is probed once more: a file that will not
    open is neither text nor binary and keeps counting against coverage.
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
    allowlist calls text. The coverage denominator trusts the sniff.
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

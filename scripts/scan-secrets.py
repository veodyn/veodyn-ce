#!/usr/bin/env python3
"""Monorepo-wide scan for credential-shaped literals.

The two guards under `node/tests/query_runner/` run inside the pytest suite
for `node/`, whose container and CI job (`ci/redash-test.yaml`) build only
from `node/`, so neither can see `docs/`, `app/`, `helm/` or anything else in
this monorepo. A live vendor API key was found reproduced verbatim in a plan
doc under `docs/superpowers/plans/`, outside what either covers. This script
closes that gap and runs standalone, with no dependency on the fork's
container, database or pytest suite.

Detection has one source of truth: this script imports
`node/tests/query_runner/credential_scan.py` (plain stdlib, no pytest
dependency) and calls its `discover_tracked_text_files`, `is_excluded`,
`read_text_if_plausibly_text` and `_is_allowlisted` rather than redefining
any of them. The one thing it does NOT reuse is that module's offender
message, which embeds the matched literal: this script's output only ever
names a location and a shape, never the value or anything derived from it
(see credential_scan_known_exceptions.py's docstring for why a hash of the
value is not safe either).

Three helpers are loaded by path, split out for file size:
scan_secrets_extra_allowlist.py for false positives the fork's allowlist was
never scoped to know about, scan_secrets_coverage.py for whether discovery
and scanning actually reached every area that can hold a credential, and
scan_secrets_exceptions.py for KNOWN_EXCEPTIONS bookkeeping and its report.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CREDENTIAL_SCAN_MODULE_PATH = REPO_ROOT / "node" / "tests" / "query_runner" / "credential_scan.py"
EXTRA_ALLOWLIST_MODULE_PATH = Path(__file__).resolve().parent / "scan_secrets_extra_allowlist.py"
COVERAGE_MODULE_PATH = Path(__file__).resolve().parent / "scan_secrets_coverage.py"
EXCEPTIONS_MODULE_PATH = Path(__file__).resolve().parent / "scan_secrets_exceptions.py"

# This scan's own sources, as they appear in `git ls-files`. Excluded for the
# same reason credential_scan.py excludes itself: an allowlist spells out the
# exact literals it excuses, so it always self-matches. Anything further split
# off either file belongs in this tuple on the same commit.
# (scan_secrets_coverage.py declares no literal of its own to self-match.)
SELF_REL_PATHS = (
    "scripts/scan-secrets.py",
    "scripts/scan_secrets_extra_allowlist.py",
)

_UUID_SHAPE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_HEX_SHAPE = re.compile(r"^[0-9a-fA-F]{24,}$")


def _load_by_path(name, path):
    """Load a module by file path, not package import: nothing of this repo
    needs to be on sys.path, which is what lets this script run standalone.
    """
    import importlib.util

    if not path.is_file():
        print(
            f"scan-secrets: cannot find {name} at {path}; this script has nothing to reuse "
            "and must not silently skip the scan",
            file=sys.stderr,
        )
        sys.exit(2)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_credential_scan_module():
    return _load_by_path("credential_scan", CREDENTIAL_SCAN_MODULE_PATH)


def _load_extra_allowlist_module():
    return _load_by_path("scan_secrets_extra_allowlist", EXTRA_ALLOWLIST_MODULE_PATH)


def _load_coverage_module():
    return _load_by_path("scan_secrets_coverage", COVERAGE_MODULE_PATH)


def _load_exceptions_module():
    return _load_by_path("scan_secrets_exceptions", EXCEPTIONS_MODULE_PATH)


_extra_allowlist = _load_extra_allowlist_module()
_is_extra_allowlisted = _extra_allowlist.is_extra_allowlisted
_is_gravatar_hash = _extra_allowlist.is_gravatar_hash
_coverage = _load_coverage_module()
_exceptions = _load_exceptions_module()


def _shape_description(literal):
    """Describe a matched literal's shape without ever repeating the value."""
    if _UUID_SHAPE.match(literal):
        return "uuid-shaped literal"
    if _HEX_SHAPE.match(literal):
        return f"hex-shaped literal, {len(literal)} chars"
    return f"base64-like literal, {len(literal)} chars"


def scan(credential_scan):
    root, rel_paths = credential_scan.discover_tracked_text_files()
    if not rel_paths:
        print(
            f"scan-secrets: file discovery under {root} returned zero files; "
            "that is a broken discovery step, not a clean repo, refusing to pass vacuously",
            file=sys.stderr,
        )
        sys.exit(2)

    # The coverage sentinel counts files actually opened and scanned, over the
    # discovered files whose CONTENT is text, so it needs all three tallies.
    # Hence a file inside a monitored area is opened even when it is going to
    # be skipped: whether its bytes are text is what the denominator asks.
    # See scan_secrets_coverage.py.
    counts = _coverage.CoverageCounts(credential_scan.TEXT_EXTENSIONS)

    findings = []
    exception_report = _exceptions.new_exception_report(credential_scan)
    scanned_count = 0
    for rel_path in rel_paths:
        group = _coverage.sentinel_group(rel_path)
        if group is not None:
            counts.count_discovered(group, rel_path)
        skipped = rel_path in SELF_REL_PATHS or credential_scan.is_excluded(rel_path)
        if skipped and group is None:
            # Skipped, and outside every monitored area, so its content
            # feeds no coverage tally: no reason to open it. # silent-ok
            continue
        text, is_binary = _coverage.read_text_or_binary(
            root / rel_path, credential_scan.read_text_if_plausibly_text
        )
        if is_binary and group is not None:
            counts.count_binary(group, rel_path)
        if skipped or text is None:
            # Skipped, binary, or unreadable: nothing a credential could have
            # been typed into as text. Already tallied above. # silent-ok
            continue

        scanned_count += 1
        if group is not None:
            counts.count_scanned(group)

        known_exception = credential_scan.known_exception_for(rel_path)
        for lineno, line in enumerate(text.splitlines(), start=1):
            # finditer, not search: an allowlisted literal earlier on the line
            # must not hide a real credential later on the same line.
            for match in credential_scan.CREDENTIAL_SHAPED.finditer(line):
                literal = match.group()
                if credential_scan._is_allowlisted(rel_path, literal):
                    continue
                if _is_extra_allowlisted(rel_path, literal):
                    continue
                if _is_gravatar_hash(literal, line):
                    continue
                shape = f"credential-shaped: {_shape_description(literal)}"
                if known_exception is not None:
                    exception_report[rel_path]["suppressed_positions"].append((lineno, shape))
                    continue
                findings.append(f"{rel_path}:{lineno}: {_shape_description(literal)}")

        # Second detector: assignment shape (a password/secret/token-named key
        # given a literal value) rather than value shape, because a
        # human-chosen password is neither hex, a UUID, nor 40+ base64-ish
        # characters. See credential_scan_password_shaped.py. Line number and
        # length, never a hash, identify a suppressed literal here.
        for lineno, description, length in credential_scan.password_shaped_lengths_in_text(rel_path, text):
            shape = f"password-shaped: {description}, {length} chars"
            if known_exception is not None:
                exception_report[rel_path]["suppressed_positions"].append((lineno, shape))
                continue
            findings.append(f"{rel_path}:{lineno}: password-shaped {description}")

    if scanned_count == 0:
        print(
            f"scan-secrets: {len(rel_paths)} file(s) discovered under {root}, but zero were "
            "actually opened and scanned (all excluded or unreadable); refusing to pass having "
            "inspected nothing.",
            file=sys.stderr,
        )
        sys.exit(2)
    _coverage.enforce_coverage(counts)

    return root, findings, exception_report


def main():
    credential_scan = _load_credential_scan_module()
    root, findings, exception_report = scan(credential_scan)
    guard_failures = _exceptions.print_exception_report(exception_report)

    if findings:
        print(f"\nscan-secrets: {len(findings)} credential-shaped literal(s) found under {root}:")
        for finding in findings:
            print(finding)
        print(
            "\nRedact the value. If it is a known-benign literal (a public id, a test "
            "fixture, a commit SHA), add it to EXTRA_ALLOWLISTED_LITERALS in this file "
            "(or, for a node/ literal, to ALLOWLISTED_LITERALS in "
            "node/tests/query_runner/credential_scan.py) with a stated reason."
        )
        return 1
    if guard_failures:
        return 1
    print(f"\nscan-secrets: clean, no credential-shaped literals found under {root} outside known exceptions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

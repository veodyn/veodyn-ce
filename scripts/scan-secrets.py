#!/usr/bin/env python3
"""Monorepo-wide scan for credential-shaped literals.

Why this exists: the AST-based guard in
`node/tests/query_runner/test_no_embedded_credentials.py` only ever looks
at `node/redash/query_runner/*.py`, and that fork's own repo-wide text scan
(`node/tests/query_runner/credential_scan.py`) runs inside the pytest
suite for `node/`. That suite's container and CI job
(`ci/redash-test.yaml`) build only from `node/`, so neither guard can see
`docs/`, `app/`, `helm/`, or anything else in this monorepo. A live
vendor API key was in fact found reproduced verbatim in a plan doc under
`docs/superpowers/plans/`, a file location outside what either Redash-scoped
guard covers, and has since been redacted. This script is the monorepo-level
guard that closes that gap: it runs standalone, with no dependency on the
Redash fork's container, database, or pytest suite, so it can run in a
lightweight CI job that needs no services.

Single source of truth for detection: this script does not redefine the
detection regex or the fork's own exclusion/allowlist rules. It imports them
directly from `node/tests/query_runner/credential_scan.py` (a plain-stdlib
module with no pytest dependency, so importing it standalone is safe) and
calls that module's `discover_tracked_text_files`, `is_excluded`,
`read_text_if_plausibly_text`, and `_is_allowlisted`. Two independently
maintained copies of "what counts as a leaked secret" would be worse than
one; if the shape of a real credential
ever changes, it changes in exactly one place. The only thing this script
does NOT reuse from that module is its human-readable offender message,
because that message embeds the actual matched literal, which is fine inside
a local pytest failure but not fine printed into a CI log. This script's own
output only ever names a location and a shape, never the value, and never
anything derived from the value (see credential_scan_known_exceptions.py's
docstring for why a hash of the value is not safe to keep either, once this
tree is headed for a public release).

Extra, monorepo-scoped allowlisting: running this scan repo-wide surfaces
false positives the fork's own allowlist was never scoped to know about,
because the fork's test suite never sees `docs/`, `app/`, or the
non-redash `helm/` charts in CI. Those extra exclusions live in
scan_secrets_extra_allowlist.py (split out for file size, not added to the
fork's `credential_scan.py`: this task is explicit that the fork's existing
guard stays exactly as it is).

Coverage sentinel: whether discovery and scanning actually reached every
top-level area that can hold a credential (not just narrowed to a subset of
the tree) lives in scan_secrets_coverage.py, also split out for file size.
See that module's docstring for the coverage-ratio rationale.

KNOWN_EXCEPTIONS bookkeeping and its printed report live in
scan_secrets_exceptions.py, also split out for file size. See that module,
and node/tests/query_runner/credential_scan_known_exceptions.py's own
docstring, for why an exception's identity check is a (line, shape) pair
and not a hash of the suppressed literal.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CREDENTIAL_SCAN_MODULE_PATH = REPO_ROOT / "node" / "tests" / "query_runner" / "credential_scan.py"
EXTRA_ALLOWLIST_MODULE_PATH = Path(__file__).resolve().parent / "scan_secrets_extra_allowlist.py"
COVERAGE_MODULE_PATH = Path(__file__).resolve().parent / "scan_secrets_coverage.py"
EXCEPTIONS_MODULE_PATH = Path(__file__).resolve().parent / "scan_secrets_exceptions.py"

# This scan's own sources, relative to REPO_ROOT, as they appear in `git
# ls-files`. Excluded for the same reason credential_scan.py excludes itself:
# an allowlist necessarily spells out the exact literal values it is excusing,
# so it always self-matches. The allowlist module is named here too: it was
# split out of this one only for the file-size hook, and that split moved
# every allowlisted literal into a path the scan was still walking, turning a
# clean run into eight self-matches. Anything further split off either file
# for size belongs in this tuple on the same commit. (scan_secrets_coverage.py
# is not in this tuple: it declares no literal of its own to self-match.)
SELF_REL_PATHS = (
    "scripts/scan-secrets.py",
    "scripts/scan_secrets_extra_allowlist.py",
)

_UUID_SHAPE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_HEX_SHAPE = re.compile(r"^[0-9a-fA-F]{24,}$")


def _load_by_path(name, path):
    """Load a module by file path, not package import: avoids needing this
    repo's packages on sys.path or their dependencies installed, which is
    what lets this script run standalone (see module docstring).
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

    # See scan_secrets_coverage.py: the coverage sentinel is checked against
    # files this script actually opened and scanned, not merely discovered
    # by name, and its denominator is the discovered files whose CONTENT is
    # text, so it needs the discovered, scanned and binary tallies together.
    # That module's docstring has the full rationale for the denominator,
    # including why an is_excluded() hit still counts against coverage and a
    # PNG does not. The consequence here: a file inside a monitored area is
    # opened even when it is going to be skipped, because whether its bytes
    # are text is the question the denominator asks.
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
            # Deliberately skipped, binary, or unreadable: nothing here a
            # credential could have been typed into as text, or nothing this
            # scan is willing to read. Already tallied above. # silent-ok
            continue

        scanned_count += 1
        if group is not None:
            counts.count_scanned(group)

        known_exception = credential_scan.known_exception_for(rel_path)
        for lineno, line in enumerate(text.splitlines(), start=1):
            # Evaluate every match on the line independently: an
            # allowlisted literal earlier on the line must not hide a real
            # credential later on the same line, which a single search()
            # would have done.
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

        # Second detector: assignment shape (a password/secret/token-named
        # key given a literal value) rather than value shape. Closes the gap
        # CREDENTIAL_SHAPED above cannot: a human-chosen password like
        # `SuperSecretPassword` is neither hex, a UUID, nor 40+ base64-ish
        # characters. See credential_scan_password_shaped.py. Its own
        # description never carries the matched value; pairing it with the
        # line number and length (not a hash: see
        # credential_scan_known_exceptions.py's docstring for why) is what
        # this script needs to identify a suppressed literal without ever
        # holding the value, or anything derived from it, itself.
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

#!/usr/bin/env python3
"""Print the suppressed_positions tuple for a KNOWN_EXCEPTIONS entry.

Run this after a legitimate change to a file listed in
node/tests/query_runner/credential_scan_known_exceptions.py (a credential
rotated with the same shape, or one added/removed on purpose), then paste
its output into that file's `suppressed_positions` tuple for the matching
path. Never hand-write an entry: it must come from actually re-scanning the
file's current content, the same way scripts/scan-secrets.py will at scan
time, or the two can drift apart silently.

This script never prints a credential value, or anything derived from one.
It records identity by position and shape (line number, detector, and
length), not a hash: see credential_scan_known_exceptions.py's own
docstring for why a hash of the value was tried first and reverted (an
unsalted digest of a short, human-chosen password is practically
brute-forceable, and this repository is headed for a public release, where
that digest would sit crackable in the first public commit forever).

It takes one or more repo-relative paths (defaulting to every path already
in KNOWN_EXCEPTIONS) so a single new exception can be computed without
needing every existing one recomputed alongside it.

Usage:
    python3 scripts/compute_known_exception_positions.py [path ...]
"""

import importlib.util
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CREDENTIAL_SCAN_MODULE_PATH = REPO_ROOT / "node" / "tests" / "query_runner" / "credential_scan.py"
EXTRA_ALLOWLIST_MODULE_PATH = Path(__file__).resolve().parent / "scan_secrets_extra_allowlist.py"

# Same shape descriptions scripts/scan-secrets.py itself prints in a
# finding: duplicated rather than imported, the same call that script's own
# _shape_description makes (see its module docstring on why re-deriving a
# tiny piece of presentation logic beats adding an import for it).
_UUID_SHAPE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_HEX_SHAPE = re.compile(r"^[0-9a-fA-F]{24,}$")


def _load_by_path(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _shape_description(literal):
    if _UUID_SHAPE.match(literal):
        return "uuid-shaped literal"
    if _HEX_SHAPE.match(literal):
        return f"hex-shaped literal, {len(literal)} chars"
    return f"base64-like literal, {len(literal)} chars"


def main():
    credential_scan = _load_by_path("credential_scan", CREDENTIAL_SCAN_MODULE_PATH)
    extra_allowlist = _load_by_path("scan_secrets_extra_allowlist", EXTRA_ALLOWLIST_MODULE_PATH)

    paths = sys.argv[1:] or [exception["path"] for exception in credential_scan.KNOWN_EXCEPTIONS]

    for rel_path in paths:
        full_path = REPO_ROOT / rel_path
        text = credential_scan.read_text_if_plausibly_text(full_path)
        if text is None:
            print(f"# {rel_path}: unreadable or not plausibly text, skipping", file=sys.stderr)
            continue

        positions = []
        for lineno, line in enumerate(text.splitlines(), start=1):
            for match in credential_scan.CREDENTIAL_SHAPED.finditer(line):
                literal = match.group()
                if credential_scan._is_allowlisted(rel_path, literal):
                    continue
                if extra_allowlist.is_extra_allowlisted(rel_path, literal):
                    continue
                if extra_allowlist.is_gravatar_hash(literal, line):
                    continue
                positions.append((lineno, f"credential-shaped: {_shape_description(literal)}"))
        for lineno, description, length in credential_scan.password_shaped_lengths_in_text(rel_path, text):
            positions.append((lineno, f"password-shaped: {description}, {length} chars"))

        print(f'    "{rel_path}": (')
        for position in positions:
            print(f"        {position!r},")
        print("    ),")


if __name__ == "__main__":
    main()

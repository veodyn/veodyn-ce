"""Shared fixtures for scripts/test_scan_secrets.py.

Split out purely for the file-size hook: not itself a test file (does not
match unittest discover's `test_scan_secrets.py` pattern, so it is never
collected on its own), just support code test_scan_secrets.py imports.
Loaded the same by-path way scan-secrets.py loads its own helper modules,
so it works standalone with no `scripts` package needed on sys.path.
"""

import importlib.util
import re
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parent.parent
CREDENTIAL_SCAN_PATH = REPO_ROOT / "node" / "tests" / "query_runner" / "credential_scan.py"

# Same shape descriptions scripts/scan-secrets.py's own _shape_description
# produces; duplicated here rather than imported so a fixture-built exception
# entry can be composed the same way a real one is, without a test needing to
# reach into scan-secrets.py's private helper.
_UUID_SHAPE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_HEX_SHAPE = re.compile(r"^[0-9a-fA-F]{24,}$")


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_credential_scan_real = load(CREDENTIAL_SCAN_PATH, "credential_scan_under_test")
# Loaded once here, not once per test module: scan-secrets.py loads its own
# scan_secrets_coverage.py/scan_secrets_exceptions.py submodules at import
# time, so a second independent load would just be redundant work, not
# extra isolation (both test modules only ever call pure functions on it).
scan_secrets = load(REPO_ROOT / "scripts" / "scan-secrets.py", "scan_secrets_under_test")

# One real file under every monitored prefix, plus a root-level file: the
# minimum tree that satisfies the coverage sentinel with room to spare (a
# single file per group is below the ratio bar once a group has more than one
# or two discovered files, so tests that need to pass the sentinel use more
# than one file per prefix; see full_coverage_tree below).
#
# Read off the real module rather than hand-copied. It used to be a literal
# tuple with a comment saying keeping the two in sync by hand was cheaper than
# loading the module, and that was wrong twice over: scan-secrets.py loads the
# coverage module at import time, so it is already here for free, and the
# hand-copy is exactly how the fixture would keep passing after a prefix was
# added to the real list, which is a fixture that no longer covers what it
# claims to.
MONITORED_PREFIXES = scan_secrets._coverage.SENTINEL_PREFIXES


def shape_description(literal):
    if _UUID_SHAPE.match(literal):
        return "uuid-shaped literal"
    if _HEX_SHAPE.match(literal):
        return f"hex-shaped literal, {len(literal)} chars"
    return f"base64-like literal, {len(literal)} chars"


def fake_credential_scan(root, rel_paths, excluded=frozenset(), known_exceptions=(), read_text=None):
    """A stand-in for the real credential_scan module exposing only what
    scan-secrets.py's scan() calls: discover_tracked_text_files(),
    is_excluded(), read_text_if_plausibly_text(), _is_allowlisted(),
    CREDENTIAL_SHAPED, TEXT_EXTENSIONS, password_shaped_lengths_in_text(),
    KNOWN_EXCEPTIONS, and known_exception_for(). read_text_if_plausibly_text
    and password_shaped_lengths_in_text are the real implementations, not
    stubs, so is_excluded()/unreadable-file/binary behavior and the second
    detector's own exclusions and length-counting are exercised for real in
    these tests, not simulated. TEXT_EXTENSIONS is the real set for the same
    reason: the coverage sentinel cross-checks the content sniff against it
    (see scan_secrets_coverage.py), and a stubbed-down set would make that
    cross-check pass on a population this repo does not have. `read_text` is
    the one seam a caller may override, so a test can simulate a REGRESSED
    binary sniff without a regressed sniff having to exist.
    """

    def known_exception_for(rel_path):
        for exception in known_exceptions:
            if rel_path == exception["path"]:
                return exception
        return None

    return SimpleNamespace(
        discover_tracked_text_files=lambda: (root, rel_paths),
        is_excluded=lambda rel_path: rel_path in excluded,
        read_text_if_plausibly_text=read_text or _credential_scan_real.read_text_if_plausibly_text,
        _is_allowlisted=lambda rel_path, literal: False,
        CREDENTIAL_SHAPED=_credential_scan_real.CREDENTIAL_SHAPED,
        TEXT_EXTENSIONS=_credential_scan_real.TEXT_EXTENSIONS,
        password_shaped_lengths_in_text=_credential_scan_real.password_shaped_lengths_in_text,
        KNOWN_EXCEPTIONS=known_exceptions,
        known_exception_for=known_exception_for,
    )


def full_coverage_tree(root, extra_rel_paths=()):
    """Write two real, readable files under every monitored prefix and one
    at repo root, satisfying both the "at least one" and the coverage-ratio
    bars. Returns the full rel_paths list, with any extra paths appended.
    """
    rel_paths = []
    for prefix in MONITORED_PREFIXES:
        (root / prefix).mkdir(parents=True, exist_ok=True)
        for n in (1, 2):
            rel = f"{prefix}real{n}.txt"
            (root / rel).write_text(f"nothing credential-shaped here, file {n}\n")
            rel_paths.append(rel)
    (root / "root-file.txt").write_text("nothing credential-shaped here\n")
    rel_paths.append("root-file.txt")
    rel_paths.extend(extra_rel_paths)
    return rel_paths


def write_screenshots(root, prefix, count):
    """Write `count` files that are binary by CONTENT (a NUL byte in the
    first sniffed chunk, exactly what a PNG carries) and return their rel
    paths. Named `.png` because that is how a screenshot really reaches the
    scan: the fork's extension allowlist drops it before the content sniff
    ever runs, so a fixture that only made the CONTENT binary would be
    testing a path this tree does not have.
    """
    (root / prefix).mkdir(parents=True, exist_ok=True)
    rel_paths = []
    for n in range(count):
        rel = f"{prefix}shot{n}.png"
        (root / rel).write_bytes(b"\x89PNG\r\n\x1a\n" + bytes(64) + b"IEND")
        rel_paths.append(rel)
    return rel_paths


def write_prose(root, prefix, count, on_disk=True):
    """Write (or, with on_disk=False, deliberately do NOT write) `count`
    markdown files under `prefix` and return their rel paths. on_disk=False
    is how a path that discovery listed but that is not in the checkout is
    simulated.
    """
    (root / prefix).mkdir(parents=True, exist_ok=True)
    rel_paths = []
    for n in range(count):
        rel = f"{prefix}page{n}.md"
        if on_disk:
            (root / rel).write_text(f"# page {n}\n\nnothing credential-shaped here\n")
        rel_paths.append(rel)
    return rel_paths

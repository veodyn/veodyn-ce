"""Shared fixtures for scripts/test_scan_secrets.py.

Not a test file: it does not match unittest discover's `test_scan_secrets.py`
pattern, so it is never collected on its own. Loads its dependencies the same
by-path way scan-secrets.py does, so it needs no `scripts` package on
sys.path.
"""

import importlib.util
import re
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parent.parent
CREDENTIAL_SCAN_PATH = REPO_ROOT / "node" / "tests" / "query_runner" / "credential_scan.py"

# Same shape descriptions as scan-secrets.py's _shape_description, duplicated
# so a fixture-built exception entry composes the way a real one does without
# reaching into that script's private helper.
_UUID_SHAPE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_HEX_SHAPE = re.compile(r"^[0-9a-fA-F]{24,}$")


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_credential_scan_real = load(CREDENTIAL_SCAN_PATH, "credential_scan_under_test")
# Loaded once here, not once per test module: both test modules only call pure
# functions on it, so a second load would be work rather than isolation.
scan_secrets = load(REPO_ROOT / "scripts" / "scan-secrets.py", "scan_secrets_under_test")

# Read off the real module rather than hand-copied, or the fixture would keep
# passing after a prefix was added to the real list. A single file per group is
# below the ratio bar once a group has more than one or two discovered files,
# so see full_coverage_tree below for what the sentinel actually needs.
MONITORED_PREFIXES = scan_secrets._coverage.SENTINEL_PREFIXES


def shape_description(literal):
    if _UUID_SHAPE.match(literal):
        return "uuid-shaped literal"
    if _HEX_SHAPE.match(literal):
        return f"hex-shaped literal, {len(literal)} chars"
    return f"base64-like literal, {len(literal)} chars"


def fake_credential_scan(root, rel_paths, excluded=frozenset(), known_exceptions=(), read_text=None):
    """A stand-in for the real credential_scan module exposing only what
    scan-secrets.py's scan() calls.

    read_text_if_plausibly_text, password_shaped_lengths_in_text and
    TEXT_EXTENSIONS are the real implementations rather than stubs: the binary
    sniff, the second detector's own exclusions and length counting, and the
    sentinel's cross-check against the extension allowlist all have to run
    against the real population. `read_text` is the one seam a caller may
    override, so a test can simulate a REGRESSED binary sniff.
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
    """Write `count` files that are binary by CONTENT (a NUL byte in the first
    sniffed chunk, as a PNG carries) and return their rel paths.

    Named `.png` because that is how a screenshot reaches the scan: the fork's
    extension allowlist drops it before the content sniff runs at all.
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

"""Repository-wide scan for credential-shaped literals.

The AST-based guard in test_no_embedded_credentials.py only ever looks at
redash/query_runner/*.py. A live AirNow key was found reproduced verbatim in
this branch's own plan doc
(docs/superpowers/plans/2026-08-04-reorg-1a-connectors.md, since redacted), a
file the AST check cannot see at all. This module walks every tracked text
file, not just Python source, so a credential quoted in a markdown "before"
example is caught the same way one hardcoded into a runner is.

"Repository-wide" means the actual git repository this checkout lives in:
redash/ is not a submodule, so `git rev-parse --show-toplevel` from here
finds the monorepo root and covers docs/, helm/, and everything else. Inside
the redash-server container (and in ci/redash-test.yaml, which builds its
image from `redash/` alone) there is no `.git` at all: only redash/ is ever
present there, so the scan falls back to walking the redash checkout
directly. Either way the guard covers everything it can actually see, and
never silently covers zero files (see scan_repo_for_credential_shaped_literals
below, which refuses to run over an empty file list).
"""

import importlib.util
import re
import subprocess
from pathlib import Path


def _load_sibling_module(stem):
    """Load `<stem>.py` from this directory by file path, not package import:
    scan-secrets.py loads *this* module by file path too, a context with no
    `tests` package on sys.path for a normal import to resolve.
    """
    path = Path(__file__).resolve().parent / f"{stem}.py"
    spec = importlib.util.spec_from_file_location(stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_allowlist = _load_sibling_module("credential_scan_allowlist")
_known_exceptions = _load_sibling_module("credential_scan_known_exceptions")
_file_filters = _load_sibling_module("credential_scan_file_filters")
_password_shaped = _load_sibling_module("credential_scan_password_shaped")
ALLOWLISTED_LITERALS = _allowlist.ALLOWLISTED_LITERALS
_is_allowlisted = _allowlist._is_allowlisted
KNOWN_EXCEPTIONS = _known_exceptions.KNOWN_EXCEPTIONS
known_exception_for = _known_exceptions.known_exception_for
EXCLUDE_DIR_NAMES = _file_filters.EXCLUDE_DIR_NAMES
LOCKFILE_NAMES = _file_filters.LOCKFILE_NAMES
TEXT_EXTENSIONS = _file_filters.TEXT_EXTENSIONS
read_text_if_plausibly_text = _file_filters.read_text_if_plausibly_text
# Second detector: assignment shape (a password/secret/token-named key given
# a literal value), not value shape. See credential_scan_password_shaped.py;
# re-exported here for the same reason ALLOWLISTED_LITERALS and
# KNOWN_EXCEPTIONS are, so this stays the one place both
# test_no_embedded_credentials.py and scripts/scan-secrets.py import from.
password_shaped_matches_in_text = _password_shaped.password_shaped_matches_in_text
password_shaped_offenders_in_text = _password_shaped.password_shaped_offenders_in_text
# Same reason as the two functions above, plus one more: a length, not a
# hash of the suppressed literal, so scripts/scan-secrets.py's
# KNOWN_EXCEPTIONS guard can flag a same-line substitution that changes
# length (see credential_scan_known_exceptions.py for what it can and
# cannot catch) without this module ever handing a credential value, or
# anything a brute force could turn back into one, to a caller.
password_shaped_lengths_in_text = _password_shaped.password_shaped_lengths_in_text

# A value shaped like a key: a long unbroken run of hex, a UUID, or a run of
# base64-ish characters with no `/`. `/` is excluded (unlike the narrower
# AST-scoped SECRET_SHAPED pattern) because free-form text and code is full
# of long `/`-joined import and URL paths that would otherwise match; a real
# path segment is not 40+ chars on its own. The base64-ish branch also
# requires at least one digit, so a forty-plus-letter PascalCase identifier
# (a test class name, for one) does not trip it: a real key or token almost
# always mixes letters and digits.
CREDENTIAL_SHAPED = re.compile(
    r"""(?:
        [0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}
        | [0-9a-fA-F]{24,}
        | (?=[A-Za-z0-9+=]*[0-9])[A-Za-z0-9+=]{40,}
    )""",
    re.VERBOSE,
)

# Deploy-configuration directories used to be excluded here as "pre-existing
# deploy secrets, tracked and rotated separately from this branch; out of
# scope for a connector rename." That framing does not hold for a repository
# being prepared for publication: a scanner that reports clean while
# knowingly skipping a directory it expects to hold secrets is worse than no
# scanner at all. There is deliberately no path-based exclusion for deploy
# configuration anymore; such a file is scanned exactly like any other
# tracked text file, and a real credential in one fails the scan rather than
# vanishing from it. What to do about a file that trips it (rotate it, or
# move it to a private deploy repo) stays a separate decision; only the
# scanner's blind spot is closed here.

# This guard's own source, including the allowlist/known-exceptions/
# file-filters/password-shaped modules it was split into for file size: its
# allowlist necessarily spells out the exact literal values it is excusing,
# and would always self-match without this, no matter how the allowlist is
# scoped. credential_scan_file_filters.py declares no literal of its own (it
# only classifies filenames) but is listed anyway for the same reason
# credential_scan_password_shaped.py is: a future edit growing either file's
# docstrings or comments should not have to remember to add itself here.
SELF_PATHS = (
    "tests/query_runner/credential_scan.py",
    "tests/query_runner/credential_scan_allowlist.py",
    "tests/query_runner/credential_scan_known_exceptions.py",
    "tests/query_runner/credential_scan_file_filters.py",
    "tests/query_runner/credential_scan_password_shaped.py",
    "tests/query_runner/credential_scan_password_shaped_core.py",
    "tests/query_runner/test_no_embedded_credentials.py",
)


def is_excluded(rel_path):
    return _file_filters.is_excluded(rel_path, SELF_PATHS)


def credential_shaped_offenders_in_text(rel_path, text):
    offenders = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        # Evaluate every match on the line independently: an allowlisted
        # literal earlier on the line must not hide a real credential later
        # on the same line, which a single search() would have done.
        for match in CREDENTIAL_SHAPED.finditer(line):
            if _is_allowlisted(rel_path, match.group()):
                continue
            offenders.append(f"{rel_path}:{lineno}: credential-shaped literal {match.group()!r}")
    return offenders


def discover_tracked_text_files():
    """Return (root, [relative posix paths]) covering every file the scan
    should consider, before extension/exclude filtering.

    Tries `git ls-files` from the real repository root first. Falls back to
    a plain filesystem walk of the redash checkout when no `.git` is
    reachable (true inside the redash-server container, where only redash/
    is bind-mounted, and true of ci/redash-test.yaml's build context too).
    """
    redash_root = Path(__file__).resolve().parents[2]
    try:
        toplevel = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=redash_root,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        toplevel = None

    if toplevel is not None and toplevel.returncode == 0 and toplevel.stdout.strip():
        root = Path(toplevel.stdout.strip())
        listed = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True, timeout=60)
        rel_paths = [line for line in listed.stdout.splitlines() if line]
        return root, rel_paths

    rel_paths = [p.relative_to(redash_root).as_posix() for p in redash_root.rglob("*") if p.is_file()]
    return redash_root, rel_paths


def scan_repo_for_credential_shaped_literals(discover=discover_tracked_text_files):
    root, rel_paths = discover()
    assert rel_paths, (
        f"the repo-wide credential scan found zero files under {root}; that is a broken "
        "discovery step, not a clean repo, and must not let this guard pass vacuously"
    )
    offenders = []
    for rel_path in rel_paths:
        if is_excluded(rel_path):
            continue
        text = read_text_if_plausibly_text(root / rel_path)
        if text is None:
            # Binary or unreadable file: not something a credential could
            # have been typed or pasted into as text. Skipping it is the
            # intended behaviour of a best-effort text scan, not a masked
            # failure. # silent-ok
            continue
        if known_exception_for(rel_path) is not None:
            # A stated, tracked exception (credential_scan_known_exceptions.py),
            # not a silent skip. scripts/scan-secrets.py is the entry point
            # that prints and count-guards these; this guard just must not
            # fail on them.
            continue
        offenders.extend(credential_shaped_offenders_in_text(rel_path, text))
    return offenders

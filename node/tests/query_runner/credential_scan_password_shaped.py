"""Second credential detector: assignment shape, not value shape.

CREDENTIAL_SHAPED in credential_scan.py matches by what the VALUE looks like:
hex 24+, a UUID, or 40+ base64-ish characters with a digit in them. Every
credential that shape was written for is machine-generated. A human-chosen
password is not: `SuperSecretPassword`, a six-character password, or a
developer's own shell-script default all sail past it.

This module matches by what the ASSIGNMENT looks like instead: a key whose
name reads as "this holds a secret" (password, secret, token, an API key),
written as a literal value, in the three forms this repo actually uses:
YAML `key: value`, shell `KEY=value` (including a `${N:-default}` /
`${VAR:-default}` parameter-default expansion), and a CLI `--flag value` /
`--flag=value`. The regexes and the literal-resolution pipeline that do the
actual matching live in credential_scan_password_shaped_core.py, split out
purely for the file-size hook; see that module's docstring.

Nothing found here ever carries the matched value past this module, and
never anything *derived* from the value either: every public function
returns only a key name, a location, and (for password_shaped_lengths_in_text)
a length, never the value and never a hash of it. scripts/scan-secrets.py's
KNOWN_EXCEPTIONS guard first tried a sha256 digest of the value here and
rejected it: an unsalted hash of a short, human-chosen password is
practically reversible by brute force (a lowercase-plus-digit six-character
password's keyspace is minutes on a GPU), and this scan runs against a
tree headed for a public repository, where the digest would sit in the
first public commit forever. A length is not reversible to anything; see
credential_scan_known_exceptions.py for what identifying a suppressed
literal by line and shape instead of by its hash can and cannot catch.

Added to credential_scan.py's SELF_PATHS for the same reason as its core
module: this docstring's own words (password, secret, token) would otherwise
self-match.
"""

import importlib.util
from pathlib import Path


def _load_core_module():
    """Load credential_scan_password_shaped_core.py by file path, not
    package import: this module is itself loaded by file path from
    credential_scan.py (see that module's _load_sibling_module), a context
    with no `tests` package on sys.path for a normal import to resolve.
    """
    path = Path(__file__).resolve().parent / "credential_scan_password_shaped_core.py"
    spec = importlib.util.spec_from_file_location("credential_scan_password_shaped_core", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_core = _load_core_module()
looks_like_deploy_config_file = _core.looks_like_deploy_config_file
_password_shaped_findings_in_line = _core.password_shaped_findings_in_line


def password_shaped_matches_in_line(line):
    """Yield a short description of every password-shaped finding on
    `line`, once per matched span, never the value itself.
    """
    for description, _literal in _password_shaped_findings_in_line(line):
        yield description


def password_shaped_matches_in_text(rel_path, text):
    """Return [(lineno, description), ...] for every password-shaped
    finding in `text`. `.example` files are skipped outright: they exist to
    show an empty/placeholder shape, and are exactly the files most likely
    to spell out a key name like `DB_PASSWORD=` with no real value attached.
    """
    if rel_path.endswith(".example"):
        return []
    if not looks_like_deploy_config_file(rel_path):
        return []
    matches = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        for description in password_shaped_matches_in_line(line):
            matches.append((lineno, description))
    return matches


def password_shaped_offenders_in_text(rel_path, text):
    return [
        f"{rel_path}:{lineno}: password-shaped {description}"
        for lineno, description in password_shaped_matches_in_text(rel_path, text)
    ]


def password_shaped_lengths_in_text(rel_path, text):
    """Return [(lineno, description, literal_length), ...] for every
    password-shaped finding in `text`. See this module's docstring for why
    a length, not a hash: scripts/scan-secrets.py's KNOWN_EXCEPTIONS guard
    needs enough to tell "the same excused credential" apart from "something
    else landed on this line", without deriving anything from the value that
    a brute force could turn back into it.
    """
    if rel_path.endswith(".example"):
        return []
    if not looks_like_deploy_config_file(rel_path):
        return []
    lengths = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        for description, literal in _password_shaped_findings_in_line(line):
            lengths.append((lineno, description, len(literal)))
    return lengths

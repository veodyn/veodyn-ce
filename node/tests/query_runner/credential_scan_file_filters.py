"""Which tracked files the credential scan looks at, and how it decides a
file is text worth scanning at all.

Split out of credential_scan.py purely to keep that module under this
repo's file-size limit; credential_scan.py imports EXCLUDE_DIR_NAMES,
LOCKFILE_NAMES, TEXT_EXTENSIONS, read_text_if_plausibly_text, and
is_excluded from here and re-exports the two functions under their original
names, so nothing outside this pair of files needs to know the split
happened. SELF_PATHS itself stays in credential_scan.py: it names this file
alongside the others, but the exclusion list is one small tuple, not worth
its own module.
"""

from pathlib import Path

EXCLUDE_DIR_NAMES = {"node_modules", ".git", "__pycache__", ".superpowers", ".claude"}

LOCKFILE_NAMES = {
    "poetry.lock",
    "yarn.lock",
    "package-lock.json",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "Gemfile.lock",
    "composer.lock",
}

# Only scan file types a credential would plausibly be typed or pasted into.
# This is what keeps binary and generated content (a vendored CA bundle's
# base64 PEM body, for one) from drowning the scan in content nobody typed.
TEXT_EXTENSIONS = {
    ".py",
    ".md",
    ".mdx",
    ".txt",
    ".yml",
    ".yaml",
    ".json",
    ".toml",
    ".cfg",
    ".ini",
    ".sh",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".less",
    ".css",
    ".sql",
    ".rst",
    ".conf",
    ".html",
}


def _is_text_by_filename(name):
    """True for filenames that plausibly carry credentials but whose
    pathlib `.suffix` does not land in TEXT_EXTENSIONS, for files that DO
    have a suffix pathlib recognizes as one (see is_excluded for the
    separate, content-sniffed handling of files with no suffix at all).

    A dotenv example file's suffix, as pathlib sees it, is the trailing
    ".example" (".env.local.example" splits to stem ".env.local" + suffix
    ".example"), which does not read as "this is an env file" from the
    extension alone, and is a template of exactly the KEY=value shape a real
    .env file has.
    """
    if name.startswith(".env") and name.endswith(".example"):
        return True
    return False


def _is_untracked_dotenv(name):
    """True for a real `.env` file (not a `.example` template): `.env`,
    `.env.local`, `.env.production`, and so on.

    Such a file is gitignored by convention and never meant to be
    committed. Excluding it here matters because
    discover_tracked_text_files() falls back to a plain filesystem walk
    (inside the redash-server container, where there is no `.git` to ask),
    and that walk is not gitignore-aware: it can turn up a real local `.env`
    sitting in the checkout next to the tracked files. Content-sniffing
    alone (see _looks_binary/read_text_if_plausibly_text) would happily
    scan it since it is plain text, so it needs its own, explicit
    exclusion, matched by name the same way the `.example` template is
    matched by name for the opposite reason: that one must always be
    scanned, this one must never be.
    """
    return name.startswith(".env") and not name.endswith(".example")


def _looks_binary(full_path):
    """True if `full_path` does not look like something a human typed or
    pasted text into.

    Sniffs the first chunk of the file rather than trusting its name: a NUL
    byte anywhere in that chunk is a binary signal cheap enough to check
    before attempting a full read, and a failed UTF-8 decode catches the
    rest. This is what lets an extensionless file be scanned by content
    instead of by a filename list, which is the thing that let a tracked
    credentials file slip past this guard silently: a filename list can only
    ever be extended one known name at a time, and an unknown extensionless
    file has nothing in it to extend.
    """
    try:
        with open(full_path, "rb") as fh:
            chunk = fh.read(8192)
    except OSError:
        return True
    if b"\x00" in chunk:
        return True
    try:
        chunk.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False


def read_text_if_plausibly_text(full_path):
    """Return `full_path`'s decoded text, or None if it looks binary.

    Single source of truth for "is this file text" used by both this
    module's own scan and scripts/scan-secrets.py's, so a binary detection
    fix only ever has to happen in one place.
    """
    if _looks_binary(full_path):
        return None
    try:
        with open(full_path, "r", encoding="utf-8") as fh:
            return fh.read()
    except (UnicodeDecodeError, OSError):
        return None


def is_excluded(rel_path, self_paths):
    if rel_path.endswith(self_paths):
        return True
    parts = set(Path(rel_path).parts)
    if parts & EXCLUDE_DIR_NAMES:
        return True
    if Path(rel_path).name in LOCKFILE_NAMES:
        return True
    if _is_untracked_dotenv(Path(rel_path).name):
        return True
    suffix = Path(rel_path).suffix
    # A file with a suffix keeps the allowlist behaviour: TEXT_EXTENSIONS is
    # a deliberately narrow positive list (a vendored CA bundle's base64 PEM
    # body has a recognized suffix, .pem, that is intentionally NOT on the
    # list, so it stays excluded here rather than drowning the scan in
    # content nobody typed). A file with NO suffix at all used to fall into
    # this same branch and be excluded outright, which is exactly the blind
    # spot that let a tracked credentials file go unscanned. It is no longer
    # excluded here; read_text_if_plausibly_text() decides by content
    # whether it is worth scanning.
    if suffix and suffix not in TEXT_EXTENSIONS and not _is_text_by_filename(Path(rel_path).name):
        return True
    return False

"""Named, stated exceptions to the credential scan in credential_scan.py.

Split out of credential_scan.py (rather than folded into it) purely to keep
that module under this repo's file-size limit; both scripts/scan-secrets.py
and credential_scan.py import from here, so this is still a single source of
truth for the exception list.

These entries excuse whole files that fail the scan for a real secret, not a
benign look-alike literal. ALLOWLISTED_LITERALS in credential_scan.py
excuses a specific literal by writing its exact value into source; that is
fine for a benign id, but writing a real credential's actual value into
source to excuse it would defeat the point of the scanner. These entries
instead name the whole path, a one-line reason, and what removes the need
for the exception. Every run of the scan prints which exceptions it
applied and how many literals each suppressed: this replaces the old
invisible skip of extensionless files (see scripts/scan-secrets.py's module
docstring), so a run that suppresses findings must say so, not report clean
while walking past a known secret silently.

`suppressed_positions` records, for every credential-shaped or
password-shaped literal this path suppressed when the exception was
written, a (line number, shape descriptor) pair: the descriptor is the same
value-free shape text the scan already prints in a finding (detector,
length, and for password-shaped, the key name, which is public: it is text
in the tracked file, not the secret). It deliberately is NOT a hash of the
literal.

That was tried first and reverted: an unsalted sha256 digest of a short,
human-chosen password is not a one-way function in any practical sense (a
lowercase-plus-digit six-character keyspace is minutes to brute-force on a
GPU), and this repository is headed for a public release, where a committed
digest of a live weak credential would sit crackable in the first public
commit forever. Publishing that digest is worse than the substitution hole
it was meant to close: the hole needs an insider making a specific edit,
the digest is exploitable by anyone who clones the repo.

Position-and-shape is a strictly weaker identity check than a hash, and
that is the deliberate tradeoff. What it catches and what it does not:

- CAUGHT: a credential added to, removed from, or moved to a different line
  within an excepted file (its old (line, shape) stops appearing, or a new
  one nobody recorded shows up). A substitution that changes the literal's
  length or shape on the same line (a 6-character password swapped for a
  40-character token) is also caught, because the shape descriptor changes.
- NOT CAUGHT: a same-line substitution that keeps the same shape and the
  same length (one 19-character postgres password swapped for a different
  19-character postgres password on the same line). That edit leaves every
  recorded (line, shape) pair matching and the scan stays clean.

That residual gap is accepted, not overlooked. It was written when this
list named seven deployment files carrying live credentials, all of which
have since left this tree; what remains is one CI-only compose file whose
literals authenticate nothing outside a throwaway test container. A
same-line, same-length substitution there would swap one disposable CI
password for another, which is not a leak this scanner exists to catch.
Any entry added here later that does hold a live credential brings the gap
back with it, and should be treated as short-lived rather than a permanent
control.

Regenerate an entry's `suppressed_positions` with:
    python3 scripts/compute_known_exception_positions.py <path>
after a legitimate change to that file's suppressed literals (a credential
rotated with the same shape, or one added/removed on purpose); never
hand-edit the list, and never add a value or anything derived from a value
(a hash, a checksum, a prefix) to this file.
"""

KNOWN_EXCEPTIONS = (
    # Seven entries stood here for the deployment files under helm/envs/ and
    # helm/depends/. Those files are gone from this tree, so the entries were
    # deleted rather than left behind as dead config, which is exactly what
    # test_known_exception_paths_still_exist in
    # scripts/scan_secrets_known_exceptions_test.py exists to force. Nothing
    # about their credentials is recorded here, and nothing needs to be: the
    # scan has no path to suppress any more.
    #
    # ci/veodyn-api-test.yaml had an entry here and no longer needs one. Its
    # POSTGRES_PASSWORD sat beside POSTGRES_HOST_AUTH_METHOD: trust, which
    # turns authentication off, so the value authenticated nothing and the
    # connection URL two lines below never carried it. It was deleted rather
    # than excused. Every entry in this list should get that question first:
    # a credential that does no work is removed, not recorded here.
    {
        "path": "node/.ci/compose.ci.yaml",
        "reason": "CI-only Postgres password and Redash cookie secret for the ephemeral test compose stack, "
        "not used outside CI",
        "removed_by": "not removed: this file is the fork's own backend test harness, kept and run by "
        "ci/redash-test.yaml, not part of the client toolchain. Its two literals are rotated only if "
        "this compose stack is ever reused outside CI.",
        "suppressed_positions": (
            (14, "password-shaped: assignment for key 'POSTGRES_PASSWORD', 32 chars"),
            (15, "password-shaped: connection URI password (user 'postgres'), 32 chars"),
            (16, "password-shaped: assignment for key 'REDASH_COOKIE_SECRET', 32 chars"),
        ),
    },
)


def known_exception_for(rel_path):
    """Return the KNOWN_EXCEPTIONS entry matching `rel_path`, or None.

    Matched by exact path, not by suffix like ALLOWLISTED_LITERALS: these
    entries name a specific tracked file, not a pattern, so an unrelated
    file that happens to share a suffix must not pick up the exception.
    """
    for exception in KNOWN_EXCEPTIONS:
        if rel_path == exception["path"]:
            return exception
    return None

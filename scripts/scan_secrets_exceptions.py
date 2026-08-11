"""KNOWN_EXCEPTIONS bookkeeping and reporting for scripts/scan-secrets.py.

Split out of scan-secrets.py purely to keep that script under this repo's
file-size limit; scan-secrets.py loads this by file path, the same way it
loads scan_secrets_coverage.py and scan_secrets_extra_allowlist.py. This
module declares no credential-shaped or password-shaped literal of its own,
so it is not added to scan-secrets.py's SELF_REL_PATHS.

An exception's identity check is (line number, shape descriptor), not a
hash of the suppressed literal: see
node/tests/query_runner/credential_scan_known_exceptions.py's docstring for
why a hash was tried first and reverted (an unsalted digest of a short,
human-chosen password is practically brute-forceable, and this tree is
headed for a public repository) and for exactly what position-and-shape
does and does not catch.
"""


def new_exception_report(credential_scan):
    """One entry per KNOWN_EXCEPTIONS path, suppressed-position list
    starting empty.

    Built up front so that a run prints every declared exception, including
    one whose path was not found among the scanned files at all (nothing
    suppressed), rather than only the exceptions a finding happened to hit.
    """
    return {
        exception["path"]: {
            "suppressed_positions": [],
            "recorded_positions": exception["suppressed_positions"],
            "reason": exception["reason"],
            "removed_by": exception["removed_by"],
        }
        for exception in credential_scan.KNOWN_EXCEPTIONS
    }


def print_exception_report(exception_report):
    """Print every KNOWN_EXCEPTIONS entry and what it suppressed, on every
    run, regardless of the run's other findings: a suppressed finding must be
    stated, not silent. Returns the list of paths that must fail the run: a
    (line, shape) pair not present when the exception was recorded (a
    credential added, removed, moved to a different line, or changed shape
    or length on the same line), or a once-populated exception that now
    suppresses nothing at all (stale, left in place, able to absorb whatever
    lands in the file next). A same-line substitution that keeps the same
    shape and length is NOT caught; see credential_scan_known_exceptions.py's
    docstring for why that gap is an accepted tradeoff, not an oversight.
    """
    import sys

    guard_failures = []
    for path, info in exception_report.items():
        suppressed = info["suppressed_positions"]
        recorded = info["recorded_positions"]
        print(
            f"scan-secrets: known exception applied: {path} "
            f"({info['reason']}; removed by {info['removed_by']}): "
            f"suppressed {len(suppressed)} credential-shaped literal(s)"
        )
        unknown_positions = set(suppressed) - set(recorded)
        if unknown_positions:
            guard_failures.append(path)
            print(
                f"scan-secrets: FAIL: {path} now suppresses {len(unknown_positions)} "
                "credential-shaped literal(s) at a line/shape not present when this exception's "
                "suppressed_positions was recorded. A credential-shaped literal appears to have "
                "been added, moved, or substituted with a different length in an already-excepted "
                "file; investigate before regenerating suppressed_positions with "
                "scripts/compute_known_exception_positions.py.",
                file=sys.stderr,
            )
        elif not suppressed and recorded:
            guard_failures.append(path)
            print(
                f"scan-secrets: FAIL: {path} now suppresses nothing recorded in "
                "suppressed_positions; this exception is stale and must not stay in place to "
                "silently absorb whatever lands in the file next. Delete this KNOWN_EXCEPTIONS "
                "entry.",
                file=sys.stderr,
            )
        elif set(suppressed) != set(recorded):
            print(
                f"scan-secrets: note: {path} no longer matches every position recorded in "
                "suppressed_positions (some, not all, of the recorded literals are gone); the "
                "recorded list is stale, regenerate it with "
                "scripts/compute_known_exception_positions.py."
            )
    return guard_failures

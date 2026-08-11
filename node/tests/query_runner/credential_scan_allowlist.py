"""The credential scan's literal allowlist.

Split out of credential_scan.py purely to keep that module under this repo's
file-size limit; credential_scan.py imports ALLOWLISTED_LITERALS and
_is_allowlisted from here, so this stays the single source of truth for it.

(file suffix, exact literal) pairs that are known to match CREDENTIAL_SHAPED
but are not credentials. Each is scoped to the specific file it appears in,
not exempted repo-wide, so the same shape landing somewhere else still trips
the guard.
"""

ALLOWLISTED_LITERALS = (
    # A public Google Sheets document id, used as a test fixture; spreadsheet
    # ids are not secrets, Google Sheets shares them by design.
    ("redash/query_runner/google_spreadsheets.py", "1S0mld7LMbUad8LYlo13Os9f7eNjw57MqVC0YiCd1Jis"),
    # MongoDB ObjectIds used as test fixtures, not credentials.
    ("tests/query_runner/test_mongodb.py", "6569ee53d53db7930aaa0cc0"),
    # A hash this test computes and asserts on, not a credential.
    ("tests/query_runner/test_query_results.py", "1c5f1acad40f99b968836273d74baa89"),
    # A commit-SHA-pinned upstream doc link, inherited from the getredash fork,
    # predating this branch.
    #
    # Two more entries stood here, for viz-lib/README.md and
    # client/app/components/HelpTrigger.less. Both files left this tree with
    # the fork's React client, so the entries excused nothing. They are removed
    # rather than kept: entries match by path suffix, so a file recreated at
    # either suffix carrying the same literal would be allowlisted without
    # anyone deciding that, and an allowlist entry naming a path that does not
    # exist only reads as if the file were still here. Same expiry discipline
    # KNOWN_EXCEPTIONS is held to.
    ("README.md", "8e820cd02c73a8ddf4f946a9d293c54fd3fb08b9"),
    # An Intercom CDN asset filename's content hash (cache-busting, baked
    # into the filename itself), not a credential. Surfaced only once .html
    # joined TEXT_EXTENSIONS; inherited upstream getredash email template.
    ("redash/templates/emails/layout.html", "1a595be287f73c0d02f548f513bfc831"),
)


def _is_allowlisted(rel_path, literal):
    return any(rel_path.endswith(suffix) and literal == value for suffix, value in ALLOWLISTED_LITERALS)

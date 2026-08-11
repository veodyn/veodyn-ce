"""Monorepo-scoped extra allowlist for scripts/scan-secrets.py.

Split out of scan-secrets.py purely to keep that script under this repo's
file-size limit; scan-secrets.py loads this by file path (see its own
_load_credential_scan_module for why: by-path loading, not package import,
is what lets it run standalone with no dependency on any package layout).

Running the credential scan repo-wide surfaces false positives the fork's
own allowlist (node/tests/query_runner/credential_scan.py) was never
scoped to know about, because the fork's test suite never sees `docs/`,
`app/`, or the non-redash `helm/` charts in CI. Those extra exclusions
are declared here rather than added to the fork's credential_scan.py: this
task is explicit that the fork's existing guard stays exactly as it is, and
these findings (Gravatar avatar hashes, PostHog's public write-only project
key, a commit-SHA doc link in the flow helm chart, an internal
PostHog organization row id quoted in a runbook) are monorepo concerns, not
redash ones.
"""

import re

# (file suffix, exact literal) pairs found by scanning the whole monorepo
# that are not credentials. Scoped to the exact file each appears in, not
# exempted repo-wide, so the same shape landing somewhere else still trips
# the guard.
EXTRA_ALLOWLISTED_LITERALS = (
    # Three entries stood here, scoped to docs/superpowers/: two PostHog
    # project keys (phc_ prefix, which PostHog documents as write-only client
    # keys safe to ship in a frontend bundle) and a PostHog organization row
    # id quoted in an admin SQL runbook. None was a secret, and the entries
    # were correct while they lasted.
    #
    # They are gone because the community edition became a SEPARATE
    # repository. scripts/export-ce-tree.py withholds docs/superpowers/ from
    # it, and this module is not withheld, so those three entries would have
    # shipped there scoped to files that do not exist. That is precisely the
    # state scan_secrets_known_exceptions_test.py exists to refuse, and it
    # refused it: the failure arrived on the new repository's first CI run.
    # Its own comment says not to loosen the path check but to delete the
    # entry, "which takes the value out of the tree with it", and that is
    # what happened here.
    #
    # The literals were replaced in those three documents with named
    # placeholders in the same commit, so nothing needs excusing any more.
    # An allowlist entry is a liability the moment the thing it excuses is
    # gone: the module is skipped by SELF_REL_PATHS precisely because an
    # allowlist always self-matches, so a stale entry parks a
    # credential-shaped string in the one file the scan never reads.
    #
    # Two earlier entries for the same key, in helm/envs/frontend-dev/ and
    # helm/envs/veodyn-api-dev/, went the same way when those deployment
    # values files left this tree.
    #
    # The flow helm chart. A link into getredash/redash at a pinned commit,
    # sitting in a values.yaml comment and inherited from the chart this one
    # was forked from. Not a credential: it is a commit SHA in a URL, and it is
    # hex-shaped only because a SHA is.
    #
    # A second entry stood beside this one for the chart's generated README.md,
    # which carried the same link from the same source. It went out with the
    # README when that documentation was dropped from this tree, because an
    # entry that outlives its file is exactly what
    # scan_secrets_known_exceptions_test.py's expiry guard refuses.
    ("helm/charts/flow/contrib-helm-chart/values.yaml", "e6ebef1e5ab866ce1e706eaee6260edaffdc2bd7"),
)


def is_extra_allowlisted(rel_path, literal):
    return any(rel_path.endswith(suffix) and literal == value for suffix, value in EXTRA_ALLOWLISTED_LITERALS)


# Gravatar avatar URLs embed the MD5 hash of an email address as a path
# segment: `gravatar.com/avatar/<32 hex chars>`. That hash is 32 hex
# characters, which matches CREDENTIAL_SHAPED's hex-run branch, but a
# Gravatar hash is not a credential: Gravatar's entire API contract is that
# the hash is sent unauthenticated to fetch a public image, the same way a
# MongoDB ObjectId identifies a row rather than authorizing anything. Scoped
# to the URL context (the literal must sit right after
# "gravatar.com/avatar/" on the same line), not exempted by shape alone, so
# an unrelated 32-char hex secret elsewhere still trips the guard.
_GRAVATAR_AVATAR_URL = re.compile(r"gravatar\.com/avatar/([0-9a-fA-F]{32})\b")


def is_gravatar_hash(literal, line):
    match = _GRAVATAR_AVATAR_URL.search(line)
    return bool(match) and match.group(1) == literal

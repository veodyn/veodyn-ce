"""What the identity gate looks for, where it is allowed to find it, and why.

The manifest half of `scripts/check-clean-tree.py`, in its own module so a
change to the declarations can be reviewed without reading any matching
logic. Three guards share this repository and do not overlap:
`scripts/scan-secrets.py` owns credentials, `scripts/check-public-tree.py`
owns forbidden paths, and check-clean-tree.py owns identity: the reference
tenant's name and vocabulary, our own internal hostnames and domains,
internal registry and namespace identifiers, and email addresses at a tenant
domain.

**This file names no identity term**, because a manifest spelling out the
customer's name would publish the customer's name. A digest is no better:
the search space of "transit agencies" is a few thousand entries, so an
unsalted hash of one is recoverable (`credential_scan_known_exceptions.py`
reached the same conclusion for short human-chosen strings).

The term list is harvested at runtime from the places in this tree that
already carry it for their own reasons; `IDENTITY_TERM_SOURCES` below names
them. Once those sources are scrubbed at the cutover the gate reports that
it has nothing left to check rather than passing (MIN_HARVESTED_TERMS in
check-clean-tree.py).

The gate's output obeys the same rule: a path, a line number and a term's
index in its source list, never the value. Its CI log is public.
"""

# Where the terms come from. (path, symbol, extraction, reason).
#
# `extraction` is the shape check-clean-tree.py knows how to read:
#   "regex-array"  a TS array of /.../flags literals
#   "string-array" a TS array of '...' literals
#
# Both files are guards in their own right and both are on LOAD_BEARING
# below: scrubbing either disarms itself and this gate together.
IDENTITY_TERM_SOURCES = (
    (
        "app/e2e-docs/docs-screens.ts",
        "FORBIDDEN_ON_SCREEN",
        "regex-array",
        "The docs-screenshot run's publication guard: the terms Plan 4A's audit found "
        "painted on screen when the captures ran against the tenant pack, generalised to "
        "the surrounding real-world network. It is the only curated identity vocabulary "
        "this repository has, it is maintained by the people who would know, and its own "
        "comment records what was deliberately left out of it and why.",
    ),
    (
        "app/src/lib/mock-data/packs/neutral/neutral.debranding.test.ts",
        "domain list in the second test",
        "string-array",
        "The neutral demo pack's publication guard. Its domain list is the tenant's and "
        "our own real domains, which the screen guard above does not carry in full "
        "domain form. Harvesting it means the two lists cannot drift apart into one "
        "guard knowing a domain the other does not.",
    ),
)

# Value-free detectors: a shape, not a term, so they name nothing.
# (rule_id, regex, what it means, remedy). Each was confirmed to fire on this
# tree before being added.
#
# TERMS_TOKEN is substituted with an alternation over the harvested terms that
# could occur in a hostname. Plain string replacement rather than str.format,
# because these are regexes and half of them contain braces of their own.
TERMS_TOKEN = "<<TERMS>>"

PATTERN_RULES = (
    (
        "tenant-email",
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*(?:<<TERMS>>)[A-Za-z0-9.-]*\.[A-Za-z]{2,}",
        "An email address at a domain that contains a harvested identity term, so a real "
        "mailbox at the tenant or at our own infrastructure rather than a documentation "
        "example.",
        "Replace it with an address at a reserved documentation domain (example.com, or a "
        "name under .test / .invalid), which can never resolve.",
    ),
    (
        "ci-token-clone",
        r"gitlab-ci-token:",
        "A git clone authenticated with the pipeline's own job token. The URL it clones "
        "names an internal git host and an internal group, and no fork outside that "
        "installation can run the job at all.",
        "Decide whether the job belongs in the public tree. If it does, the host and group "
        "have to come from CI variables; if it does not, the file leaves with the rest of "
        "the private deployment configuration.",
    ),
    (
        "registry-namespace",
        r"\$\{[A-Z_]*REGISTRY[A-Z_]*\}/[A-Za-z0-9._-]+",
        "A container image path whose registry host is a CI variable but whose next segment "
        "is a literal. That segment is the internal organisation's namespace in the private "
        "registry, so parameterising the host alone did not make the path publishable.",
        "Move the namespace segment into a CI variable beside the host, or drop the file with "
        "the rest of the deployment configuration.",
    ),
)

# Declared exceptions to PATTERN_RULES, (path, rule_id, count, reason). The
# count is enforced exactly: one more occurrence than is recorded fails the
# run, and a declaration matching nothing fails as stale. Everything else a
# rule finds is fatal, with no baseline to absorb it.
#
# EMPTY is the answer here, not an omission: both rules reached zero sites.
# The two files that cloned a private repository over the pipeline's job token
# are forbidden by scripts/public_tree_forbidden_paths.py, so a merge from the
# private branch cannot restore them.
OPEN_PATTERN_SITES = ()

# Paths where a harvested term is supposed to appear. Each is reported every
# run with its reason and hit count, and a declaration that stops matching
# FAILS: a stale claim here is an unguarded path. Not a skip list, and not a
# place to put a directory: this gate found a tenant mailbox in a node/ test
# fixture.
LOAD_BEARING = (
    (
        "app/e2e-docs/docs-screens.ts",
        "The primary term source (see IDENTITY_TERM_SOURCES). Every term is here by "
        "definition; that is what the file is.",
    ),
    (
        "scripts/comment_baseline.py",
        "The comment ratchet's per-file counts, and every occurrence here is a PATH rather "
        "than a value: the six that match are the public connector modules and their tests "
        "under node/*/query_runner/, whose file names are themselves harvested terms. That "
        "is the closed public-connectors question below, reached by a file that has to name "
        "the path it counted or it is recording nothing. A counted row would be the wrong "
        "mechanism for the same reason it was wrong for test_report_data_source_types: the "
        "number moves when one of those files gains or loses its last comment, which says "
        "nothing about identity, and blocking on it would stop a correct cleanup.",
    ),
    (
        "app/src/lib/mock-data/packs/neutral/neutral.debranding.test.ts",
        "The neutral pack's own de-branding guard, and the second term source. Its matches "
        "ARE the assertion that the pack is clean. A gate that flagged this file would be "
        "flagging its own ally.",
    ),
    (
        "app/public/db-logos/README.md",
        "Documents the twelve legacy data-source type names whose PNGs are kept, so that a "
        "logo asset is not deleted out from under a data source still carrying the old "
        "type. The names are the record of why each file stays.",
    ),
    (
        "node/redash/query_runner/legacy_types.py",
        "TYPE_RENAMES, RETIRED_TYPES and NEEDS_MANUAL_MIGRATION. Nine live production "
        "data-source rows resolve their type through this map. Scrubbing the strings does "
        "not de-brand anything, it breaks real data sources.",
    ),
    (
        "node/tests/query_runner/test_legacy_types.py",
        "Asserts the exact contents of the map above. It has to name the same strings or it "
        "is testing nothing.",
    ),
    (
        "node/tests/test_report_data_source_types.py",
        "The same reasoning as the file above, one layer out. It asserts which of those same "
        "type keys the deploy preflight blocks on and which it only reports: a pack-provided "
        "type must be named and must not gate the deploy, a retired one must gate it. Both "
        "cases have to spell the key out, because the key IS what the preflight matches on. "
        "It carried a counted baseline rather than this declaration until the count grew and "
        "failed, which was the wrong mechanism for it: a number going up here means somebody "
        "added a case to a test whose whole job is naming these strings, so raising the "
        "number would have recorded nothing and blocking on it stops a correct change.",
    ),
    (
        "node/migrations/versions/e369133dda9a_rename_connector_types.py",
        "An applied migration. Its literals are the from-side of a rename that already ran "
        "against production; editing them changes what a replayed history does.",
    ),
    (
        "node/migrations/versions/29f3e1144ec5_rename_regional_connector_types.py",
        "Second applied migration, same reasoning.",
    ),
)

# Not scanned at all, with an expiry. Carried as data rather than as a
# comment so the note cannot be deleted without deleting the decision, and
# printed on every run including a clean one.
DEFERRED_PREFIXES = (
    (
        "docs/superpowers/",
        "The internal working documents the remaining reorg phases are executed against. "
        "They are dense with tenant references and always were. scripts/check-public-tree.py "
        "defers this same prefix for the same span and the same reason: deleting them now "
        "would delete the instructions for the deletion. EXPIRES at the Phase 5 cutover, "
        "on that phase's checklist, alongside the sibling guard's entry.",
    ),
)

# This gate's own sources, excluded because scanning them makes the gate
# report itself: the baseline's rows are file paths, some containing a
# connector name that is a harvested term. Same reasoning as SELF_REL_PATHS in
# scripts/scan-secrets.py, and none of these goes unchecked:
# test_check_clean_tree_declarations.py asserts every hand-written one names
# no term.
SELF_REL_PATHS = (
    "scripts/check-clean-tree.py",
    "scripts/clean_tree_identity_manifest.py",
    "scripts/clean_tree_identity_baseline.py",
    "scripts/test_check_clean_tree.py",
    "scripts/test_check_clean_tree_patterns.py",
)

# How the baseline is grouped in the report: scripts/clean_tree_identity_buckets.py
# holds OPEN_DECISION_BUCKETS, the selector kinds and each group's reason.

# What this gate does not cover, recorded as data rather than as a comment so
# the note cannot be deleted without deleting the decision. Not an escape
# hatch, and read the way public_tree_forbidden_paths.py's DEFERRED_PATHS is.
NOT_CHECKED = (
    (
        "words painted into a file that does not decode as UTF-8 (screenshots, PDFs, any binary)",
        "The scan reads bytes and decodes them; a word RENDERED into an image is not in those "
        "bytes at all, so nothing here can see it. This is the larger of the two gaps and it is "
        "not hypothetical: this tree ships 49 captures of the running product under "
        "docs/static/img/screenshots/, and the plan immediately before this gate landed "
        "recaptured 39 of them precisely because the tenant was legible on screen. What covers "
        "that case is FORBIDDEN_ON_SCREEN in app/e2e-docs/docs-screens.ts, the capture harness's "
        "own publication guard: it reads the text a browser actually painted and fails the "
        "capture, before any image is written. It is also this gate's primary term source, so "
        "the vocabulary the two enforce cannot drift apart. Its limit is that it only covers "
        "images this repository generates, so a screenshot added by hand is checked by its NAME "
        "and by nothing else. No expiry: reading rendered text out of an image is not something "
        "a stdlib-only gate is going to start doing.",
    ),
    (
        "email addresses at domains unrelated to any harvested term",
        "The tenant-email rule above only fires on a domain containing a harvested term. A "
        "general 'is this a real mailbox' rule would need an allowlist of the fictional and "
        "vendor domains this tree legitimately uses, and that allowlist would have to spell "
        "out real domain names in a public file, which is the thing this manifest refuses to "
        "do. It would also be useless as written: a plain address regex matches every "
        "`package@1.2.3` line in a lockfile, and the test fixtures node/ inherited from the "
        "project it was forked from use real-looking addresses this repository did not choose "
        "and should not rewrite. No expiry: this is the permanent shape of the rule, not a "
        "deferral.",
    ),
    (
        "anything that identifies a place without naming it: coordinates, road numbers, system "
        "codes, id prefixes, fare and headway figures, a two-letter metro abbreviation",
        "This gate matches a harvested list of TERMS. A latitude is not a term. Neither is a "
        "freeway number, an incident-id prefix, a transit agency's internal system code, or the "
        "short code a build uses to select a tenant pack. Every one of those was present in this "
        "tree while all three guards reported clean, and they were found by a person reading and "
        "by a cross-model review, not by any check here. They have since been swept out of the "
        "fixtures, and the sweep's own report is explicit that it closed the shapes somebody "
        "could enumerate rather than the class: a fare, a headway or a service-frequency pattern "
        "would pass exactly the same way. "
        "One member of the class is deliberately kept. The short code that selects the tenant "
        "pack is a real build-time value that a separate repository's build script sets, so "
        "changing it is a cross-repo rename rather than a scrub, and it discloses strictly less "
        "than this tree already publishes on purpose: a connector in the CLOSED bucket above is "
        "named for the region's transit authority in full. Removing the two-letter code while "
        "keeping that connector name would be theatre. "
        "No expiry, and no plan to grow one. A gate that tried to recognise this class by "
        "pattern would need a list of real places, real road numbers and real agency codes, "
        "which is the file this manifest exists to not write. What covers it is a person "
        "reading, which is why the sweep is recorded rather than automated.",
    ),
)

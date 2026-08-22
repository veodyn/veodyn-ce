"""How a finding is grouped when the run reports it, and what each group means.

Read `scripts/clean_tree_identity_manifest.py` first: its rule governs this
file too, which is that **no identity term is named here**. A bucket is
described by the KIND of file it selects, never by the strings those files
carry, and every selector below is a path shape or a question asked of the
harvest at run time rather than a literal.

The reason there is more than one bucket outside the documentation site is
that one number meaning four things overstates whichever slice is cheapest to
fix. `docs/superpowers/specs/2026-08-07-identity-rename-scoping.md` measured
the old catch-all and found four slices with nothing in common.

A bucket carries a status. `OPEN` is a question nobody has answered yet.
`CLOSED` is one that has been answered, kept here because the answer has a
size and the size has to keep being checked.

**A closed bucket is not an exemption.** Nothing about it is skipped: its
files are scanned like any others, a new one fails as a new baseline row, and
a recorded count that moves in either direction fails as `grew`, `swapped` or
`stale`. The status changes only which heading the run prints it under.
"""

# How a bucket selects its files. `bucket_for` takes the first bucket whose
# selector matches, so ORDER IS MEANING here and the catch-all stays last.
#
#   BY_PREFIX          a path prefix, matched from the left. For a bucket that
#                      is a PLACE: a directory sharing one decision.
#   BY_PATH_SHAPE      a regex over the whole path. For a bucket that is a KIND
#                      of file, since test files and documentation scatter
#                      across all three codebases and no prefix collects them.
#   BY_A_NAME_THAT_IS_A_TERM
#                      the file's own name, with a test prefix or suffix
#                      stripped, IS one of the harvested terms in full, and the
#                      path additionally matches the regex given as the value.
#                      Asked of the harvest because it could not be written as
#                      a literal without naming a term. Without the bounding
#                      regex, a term that is an ordinary word would pull an
#                      unrelated file into a settled bucket.
BY_PREFIX = "prefix"
BY_PATH_SHAPE = "path-shape"
BY_A_NAME_THAT_IS_A_TERM = "name-is-a-term"

OPEN = "open"
CLOSED = "closed"

# (selector, label, status, reason). The catch-all is (BY_PREFIX, "") and must
# stay last. Nothing is resolved by being listed here: the run prints the
# question, the count and who owns it every time.
OPEN_DECISION_BUCKETS = (
    (
        (BY_PREFIX, "docs/docs/"),
        "the published documentation site",
        OPEN,
        "UNRESOLVED. These are worked configuration examples that use the reference tenant: "
        "its brand, its agency, its help URL. For a white-label product that is a defensible "
        "choice and replacing them with invented values costs the examples their realism, but "
        "it is a decision somebody has to make on purpose rather than one a scrub makes by "
        "accident. One slice of this count is not that question: the connector table on the "
        "connectors page names the public data services the shipping connectors talk to, which "
        "is the closed public-connectors disclosure below reached through documentation, and it "
        "grew when the table caught up with the enabled runner list it had been missing. "
        "The use-cases section added a second reach into that same closed disclosure: the "
        "incident guide names the region's traveler-information connector beside the "
        "crowdsourced one, because running the two together is the guide's actual advice, and "
        "the connectors page already names that service as a shipping connector. A use-case "
        "page naming a connector the product ships is this slice, not a new tenant reference. "
        "Owner: the developer, at the cutover.",
    ),
    (
        (BY_PREFIX, "ci/"),
        "the GitLab pipeline",
        CLOSED,
        "DECIDED in Phase 4, and this bucket should now be empty. The question was whether any "
        "of the CI configuration belongs in a public tree given that a fork can run none of it. "
        "The answer split the directory: the test jobs stay and the image builds went to the "
        "private branch, because those push to a private registry and clone a private "
        "repository, and they took every identity term in this directory with them. Five of the "
        "six surviving jobs need a language runtime and this checkout and nothing else; the "
        "Redash gate additionally needs a runner that can run a privileged docker-in-docker "
        "service, which .gitlab-ci.yml now states instead of claiming otherwise. A row "
        "appearing under this prefix again is a new file to look at, not a recurrence of the "
        "old question.",
    ),
    (
        (BY_PREFIX, ".gitlab-ci.yml"),
        "the GitLab pipeline root",
        CLOSED,
        "DECIDED, same as ci/ above: this file keeps the test stage, the include list and the "
        "runner image, and lost the build stages and the image-name anchors. Nothing of the "
        "internal container-registry namespace remains: the runner images are public pinned "
        "tags, and OPEN_PATTERN_SITES in clean_tree_identity_manifest.py is empty, which is the "
        "answer rather than an omission. An earlier version of this text sent a reader there to "
        "audit a namespace that had already gone, where they would have found no entries and "
        "been unable to tell a deliberate zero from a missing one.",
    ),
    (
        (BY_A_NAME_THAT_IS_A_TERM, r"^node/(?:redash|tests)/query_runner/|^app/public/db-logos/"),
        "public connectors: the fork's modules, their tests and their logo assets",
        CLOSED,
        "CLOSED, and still counted. Every file this selects is NAMED after a public data "
        "service: a public traveler-information system, a regional transit schedule service and "
        "a commercial traffic-camera vendor, all three publishing under those names themselves "
        "and reachable by anyone. "
        "Naming the service a connector connects to is not leaking the identity of whoever "
        "happens to use it, and the reason these were ever counted is a borrowed lens: this "
        "gate's terms are harvested from a screenshot guard whose own comment says they were "
        "generalised to the surrounding real-world network rather than kept to the strings it "
        "saw. That generalisation is right for an image, where a vendor's name on screen "
        "reveals the customer's stack, and wrong for source code, where a connector is supposed "
        "to say what it talks to. Three further reasons the answer is not 'rename them anyway': "
        "Phase 1A moved these deliberately INTO the public connector set; three of them carry "
        "live production data-source rows resolving through TYPE_RENAMES in "
        "node/redash/query_runner/legacy_types.py, so renaming is a data migration and not a "
        "scrub; and the published connector list at docs/docs/connectors.md names these "
        "services outright as connectors this product supports, which is the same disclosure by "
        "a shorter route. An earlier version of that third reason cited the connector curation "
        "note instead, which has since left this tree; the argument did not depend on it. "
        "This is not an exemption and must not become one. Nothing here "
        "is skipped: a file this selects still has a baseline row, a new one still fails as "
        "new, and a count that moves still fails. Decided; owned by nobody, because there is "
        "no longer a question.",
    ),
    (
        (BY_PATH_SHAPE, r"(?:^|/)tests?/|(?:^|/)test_[^/]+$|[._-]test[._-]|[._-]tests?\.[A-Za-z0-9]+$"),
        "identity terms inside test files",
        OPEN,
        "SWEPT, and what is left is not fixture vocabulary. This bucket was 243 occurrences "
        "across 55 files and made the total look like a blocker: place and service names inside "
        "test files, named because whoever wrote the fixture needed somewhere to name and any "
        "other place would have served. That part is done, and it was the find-and-replace it "
        "looked like. The remainder is NOT, and the earlier claim that nothing here is a schema, "
        "an id, a contract or a stored value is false of it. Most of it asserts the exact legacy "
        "data-source type keys held in node/redash/query_runner/legacy_types.py, which this "
        "manifest already declares load-bearing: changing the test alone breaks it, and changing "
        "both is the data migration the connectors bucket ruled out. The rest reaches either "
        "that same closed connectors question through files whose own names are not terms, or "
        "the private overlay distribution by its package directory and its build-time value, "
        "which is the source residual's decision. So this count does not go to zero on its own "
        "and must not be swept to zero: it moves when those two questions are answered, and a "
        "run that finds it empty is a run where somebody edited an assertion rather than a "
        "fixture. Owner: nobody, until the residual and the connectors are settled.",
    ),
    (
        (BY_PATH_SHAPE, r"\.mdx?$"),
        "documentation outside the published site",
        OPEN,
        "SETTLED, and nothing here is asking a question any more. The question this bucket held "
        "was engineering notes whose shipping status had never been decided, and it was answered "
        "the same way twice: app/docs/ first, then the loose notes under docs/. Neither ships. "
        "Both are forbidden paths in scripts/public_tree_forbidden_paths.py, which is the guard "
        "that keeps them gone, and the content that stays useful stays on main where the people "
        "who use it are. The larger of the two counts here was the connector curation note, and "
        "it is gone with the rest: its occurrences were legacy data-source TYPE KEYS rather than "
        "the product identifier chosen as branding, so they were never the free choice an "
        "earlier version of this text implied. What is left is a single line in the root readme. "
        "Owner: nobody. The count stays so that it cannot drift.",
    ),
    (
        (BY_PREFIX, ""),
        "source residual",
        OPEN,
        "READ, site by site, and it is no longer a reading task. What is left is three things "
        "and none of them is a question. Twelve are logo assets matched by FILENAME, and they "
        "are NOT twelve of a kind: app/public/db-logos/README.md sorts them into nine deprecated "
        "type aliases each paired with a clean-named file, two that no rename covers because an "
        "operator resolves those rows by hand, and one owned by the private pack. Only the nine "
        "have a deletion condition, which is the release that drops the alias from the fork's "
        "legacy type map and not before, because deleting early blanks the logo on exactly the "
        "unmigrated rows that most need to stay identifiable. The other three outlive that "
        "release, and an earlier version of this text said all twelve were alias pairs, which "
        "would have deleted them with it. Eight are in one seeding script, and they are not one "
        "group either: the fence is on three ClickHouse table VALUES and on the saved-query "
        "`name` fields, which live instances match against, and it is not on the Python "
        "identifiers or the description prose, which are local to that file and free. Both "
        "slices are settled in place and the count holds them so that neither is quietly swept. "
        "The third is the fork's default runner list, which names three public connector modules "
        "and so belongs to the closed question above; the filename selector cannot see that, "
        "because the file is an __init__.py and its name is nobody's term. "
        "The sites that named the private overlay distribution by its exact package name were "
        "generalised on the developer's decision: they now say what the overlay IS rather than "
        "what it is called, which keeps every one of them true without waiting on a rename in "
        "another repository, and the name was of no use to a public reader anyway. Owner: "
        "nobody. The count stays so that the two settled slices cannot drift.",
    ),
)

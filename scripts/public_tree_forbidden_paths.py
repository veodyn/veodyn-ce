"""The paths that must never exist in the public tree.

Why this file exists: this repository is being split in two along a branch,
not along a repo. `main` keeps the deployment configuration and the internal
working documents; the public branch (`oss`) had them removed by the Phase 3
deletion commits. Nothing about that split is enforced by git. A routine
`git merge main` into `oss` restores every deleted file in one commit, with
no conflict, no prompt and no diff anyone is likely to read line by line,
and the public branch quietly stops being publishable. Several of the
restored files hold live deploy credentials, so the failure is both silent
and expensive.

This is the manifest half of the guard; `scripts/check-public-tree.py` is
the half that fails. Keeping the list in its own module is deliberate: the
list is the thing humans edit and reviewers read, and it should be possible
to review a change to it without reading any matching logic.

Paths only. Never a credential value, never a fragment of one, never
anything derived from one. The reason column says what kind of thing lived
at the path and why it cannot ship, in terms a reader who has never seen the
file can check. Same discipline as scripts/scan-secrets.py, and for the same
reason: this file is itself public.

Provenance: most entries below are a prefix of something the Phase 3
deletion actually removed. The exact file list is
`git diff --diff-filter=D --name-only 06a33c5..06099fa` (81 files); the
entries here are the smallest set of prefixes covering it. The two image
build files under the "Image builds" heading came later, in Phase 4, when
the developer decided which half of the pipeline ships; they are marked as
such so nobody looking for them in the Phase 3 diff concludes the manifest
has drifted. Adding an entry that never held anything is harmless, but an
entry whose reason is invented is worse than no entry, because the next
person to weigh a false positive has nothing real to weigh it against.

Matching rule, implemented in check-public-tree.py and stated here because
it governs how to write an entry: an entry ending in `/` matches any path
under that directory; an entry not ending in `/` matches that one path
exactly. Exact rather than prefix so that `docs/bugs.md` cannot be read as
also claiming `docs/bugs-triage.md`, which nobody decided anything about.
"""

# (path, reason). See the matching rule in this module's docstring.
FORBIDDEN_PATHS = (
    # --- Deployment configuration -----------------------------------------
    (
        "helm/envs/",
        "Per-environment Helm values plus the `secrets` env file: real ingress hostnames, "
        "tenant ids, and credential values in the clear.",
    ),
    (
        "helm/depends/",
        "Cluster provisioning scripts and their per-deployment values files, which carry "
        "database hosts, OAuth client configuration and other deployment-specific settings.",
    ),
    (
        "helm/deploy.sh",
        "The `helm upgrade` wrapper the deploy jobs called. It requires CLUSTER_NAME, K8S_API "
        "and CI_TOKEN and only means anything alongside the values files above.",
    ),
    (
        "ci/init-prod.yaml",
        "Production provisioning jobs: cluster credentials, namespace bootstrap and the shared "
        "secret. These are the jobs whose removal made the pipeline safe to publish.",
    ),
    (
        "ci/init-dev.yaml",
        "The development-instance jobs: cluster credentials and namespace bootstrap for the "
        "internal development deployment, the same shape as ci/init-prod.yaml above. Its four "
        "image builds were split out into ci/build-dev.yaml, which is now forbidden in its own "
        "right below, so neither half of this file can come back.",
    ),
    # --- Image builds (removed in Phase 4, not Phase 3) --------------------
    #
    # The test jobs stay. These two do not, and the line between them is
    # whether a fork outside the origin installation could run the job at
    # all: the gates need a language runtime and this checkout, while the
    # builds need push credentials to a private registry and, in two cases,
    # read access to a private repository that is not part of this tree.
    (
        "ci/build-dev.yaml",
        "The manual development-image builds, one per service. Two of them authenticate a "
        "clone of a private customer pack repository with the pipeline's own job token over "
        "an internal git host, all four push to an internal container registry under a "
        "hardcoded organisation namespace, and the comments name the reference tenant "
        "throughout. Nothing here runs outside the origin installation, and the file is the "
        "single largest concentration of tenant vocabulary left anywhere in ci/.",
    ),
    (
        "ci/veodyn-de.yaml",
        "The release image builds that run on tag pipelines, plus the per-service variable "
        "anchors ci/build-dev.yaml extends. Same internal registry namespace and same push "
        "credentials as the file above, and it encodes where a tagged release image lands, "
        "which is a deployment decision and belongs with the rest of the deployment "
        "configuration rather than in a published tree.",
    ),
    # --- Internal working documents ---------------------------------------
    (
        "docs/bug-evidence/",
        "Screenshots captured against a running internal deployment: real tenant data, internal "
        "hostnames, and a signed-in session's chrome.",
    ),
    (
        "docs/bugs.md",
        "The internal defect log. Written explicitly as an unpublished working file, and it "
        "narrates unfixed behaviour of a running instance.",
    ),
    (
        "docs/coverage.md",
        "The internal documentation-coverage tracker. Same unpublished working-file status, and "
        "its rows are keyed by a directory layout that no longer exists.",
    ),
    (
        "docs/dev-redash.md",
        "Runbook for the internal development Redash instance: its URL, how it is seeded from a "
        "copy of the production database, and how to sign in to it.",
    ),
    (
        "docs/deploying.md",
        "The deploy runbook for one deployment: its GitLab project and numeric id, its cluster "
        "namespace, the ingress hostname of every release, which two releases share a database "
        "server, and the expiry date of the token its pipeline authenticates a private clone "
        "with. Same class as docs/secret-rotation.md below and forbidden for the same reason: "
        "no credential value is in it, but it is a map of where the deployment is and where it "
        "is brittle. The publishable half of the same model is in README.md, which says how a "
        "deployment composes the packs without naming this one.",
    ),
    (
        "docs/local-la-metro-stack.md",
        "Local runbook for one specific deployment's data stack, naming its internal services "
        "and the accounts used to seed them.",
    ),
    (
        "docs/local-development.md",
        "The local development runbook for a tenant build. It names both private packs and "
        "the internal GitLab namespace they are cloned from, the reference tenant, and the "
        "image names a local three-layer build produces. A reader of the public tree has "
        "none of the three repositories it composes, so in that tree it is instructions for "
        "machinery they cannot obtain. Same class as docs/local-la-metro-stack.md above. "
        "CONTRIBUTING.md carries the community half: the loop for a clone that has only "
        "this tree.",
    ),
    (
        "scripts/dev-assemble.sh",
        "The script the runbook above is written for, forbidden for the same reason and "
        "found missing from this list while porting an unrelated change. It defaults to "
        "sibling checkouts of the enterprise pack and the tenant pack by name, refuses to "
        "run without both, prints their pinned commits, and selects the tenant's plugin. It "
        "landed in the same merge as docs/local-development.md and was left off here, which "
        "is the half that would have let it travel: the doc is blocked and the script it "
        "documents was not.",
    ),
    (
        "scripts/dev-stack.sh",
        "Brings the local stack up as one edition or the other. Forbidden for the same reason "
        "as dev-assemble.sh above: it names the enterprise pack's checkout, its overlay "
        "Dockerfiles and its compose overlay, and the ee path does not exist for a reader who "
        "has only this tree. The ce path it also carries is exactly `docker compose up` "
        "against the public compose.yaml, so nothing is lost there.",
    ),
    (
        "scripts/dev-stack/",
        "The enterprise fixture dev-stack.sh applies, holding rows for `kpi`, "
        "`kpi_history_point` and `report`. Those tables are defined in the enterprise pack, so "
        "the file is a description of a private schema. Its community counterpart is "
        "compose/fixtures/, which stays public deliberately: everything in there is a table "
        "this tree defines.",
    ),
    (
        "docs/secret-rotation.md",
        "Operational runbook for one deployment's credentials: its 1Password vault and item "
        "path, its namespace and Secret names, which of its releases share a database, and "
        "which of its credentials cannot be rotated without a re-encryption pass. It carries "
        "no credential values, but it is a map of where they are and where the deployment is "
        "brittle.",
    ),
    (
        "docs/agent-tooling-onboarding.md",
        "Onboarding for this team's agent tooling: which hooks to install from a starter "
        "repository that is not public, and how the internal reflection loop under "
        ".harness/reflections/ is run. Both of the things it onboards someone to are "
        "forbidden here or absent from a clone, so in a public tree it is instructions for "
        "machinery the reader does not have.",
    ),
    (
        "docs/product-critic-2026-07-23-outcomes.md",
        "The disposition of one internal product-critique run: 25 findings against a "
        "deployment, with the still-open ones described in enough detail to be reproduced. "
        "Same class as product-critic-output/ below, which is the raw form of the same "
        "exercise, and forbidden for the same reason.",
    ),
    (
        "docs/ai-provider.md",
        "The AI provider engineering note. It is written for whoever operates this deployment "
        "rather than for a reader of the tree: a Known Gaps section that reports which of our "
        "environments has the feature switched on, a kubectl command naming an internal "
        "release, and paths into the enterprise pack's two AI modules, which are the only "
        "references in any note here that do not resolve in the public tree. The published "
        "half is docs/docs/operations/ai-provider.md, which is written for that reader.",
    ),
    (
        "docs/connector-curation.md",
        "The connector curation record. It was written to be read publicly and was the one note "
        "here deliberately kept in the public tree, so this entry reverses a decision rather "
        "than recording an oversight. Two reasons it went. It reads the whole product as a "
        "delta from the project the query service was forked out of, which is not what this "
        "repository is any more; and its evidence is an internal count taken against two named "
        "deployments, which is the same class as everything else forbidden here. The published "
        "connector list at docs/docs/connectors.md is what a reader needs, and it is written "
        "for them.",
    ),
    (
        "docs/dead-code-audit.md",
        "The knip and vulture audit: 231 findings sorted into what was deleted, what the "
        "tools cannot see, and 18 open questions. It is a working note addressed to whoever "
        "runs those tools next here, and it narrates unfinished decisions about this "
        "repository rather than telling a reader anything about the product.",
    ),
    (
        "product-critic-output/",
        "Raw output of an internal product-critique run driven against a live deployment, "
        "including its URL and unreleased findings.",
    ),
    (
        ".harness/reflections/",
        "Committed output of the internal self-improvement loop. Each entry narrates internal "
        "incidents, internal paths, and who did what.",
    ),
    (
        "plans/",
        "The security audit and the remediation plans written against it. Every finding names "
        "an unfixed weakness in the running deployment by file and line, and the plans spell "
        "out how to reach each one. This is the same class as helm/envs/ and "
        ".harness/reflections/ above, and more directly so than either: publishing it hands a "
        "reader the exploit order for a system that has not been fixed yet. It stays forbidden "
        "while any finding is open, and the decision to publish a written-up finding is made "
        "per finding, after it is closed, not by unforbidding this directory.",
    ),
    (
        ".mcp.json",
        "Local MCP server wiring pointing at internal analytics infrastructure by hostname.",
    ),
    (
        "app/docs/superpowers/",
        "A second internal working-docs tree, separate from docs/superpowers/: specs, plans "
        "and implementation notes for completed visualization work. No remaining reorg phase "
        "reads it, so unlike docs/superpowers/ it is deleted outright rather than deferred. "
        "Now subsumed by the app/docs/ entry below and kept as the narrower tombstone, because "
        "it records a different decision made for a different reason.",
    ),
    (
        "app/docs/",
        "The frontend's engineering notes. Never had their shipping status decided, and the "
        "identity review settled it: they do not ship. Two reasons, either sufficient. One of "
        "them is a working document by this repository's own definition, which is the same "
        "class as the two internal trees above. And the whole directory was already flagged as "
        "stale beyond the scrub, so publishing it would ship notes nobody had checked against "
        "the code they describe. The content is not lost: it stays on main, where the people "
        "who use it are. Anything in here that a public reader genuinely needs belongs in the "
        "published Docusaurus site under docs/, rewritten for that audience rather than moved.",
    ),
    # --- Composition and cross-repository tooling --------------------------
    (
        "ci/assemble-sources.sh",
        "The assemble step that composes a build context. It names both private pack "
        "repositories and clones them with CI_JOB_TOKEN; the community tree is an input to "
        "it, not a place it can run. Same class as scripts/dev-assemble.sh.",
    ),
    (
        "scripts/check-tree-parity.py",
        "Compares this tree against the community one, so it only means anything from the "
        "side that has something to compare. Run in the community tree it would clone and "
        "diff a repository against itself.",
    ),
    (
        "docs/superpowers/",
        "Internal specs, plans and implementation notes: work in progress, naming internal "
        "incidents, unfixed weaknesses and private pack internals. It sat in DEFERRED_PATHS "
        "until 2026-08-18 because the reorg was executed against these documents. That "
        "deferral expired when veodyn-ce went public on 2026-08-11 and nobody closed it, so "
        "commit db9e3e4 carried five of them into an already-public repository on 2026-08-14 "
        "while check-public-tree passed, having been told to skip them.",
    ),
)

# Deliberately NOT forbidden, with an expiry. Printed on every run so it
# cannot be forgotten, and carried as data rather than as a comment so that
# nobody can delete the note without deleting the decision it records.
#
# Read this before adding anything here: an entry in this tuple is a path
# that is known to be unfit for the public tree and is being kept anyway,
# for a stated span. It is not a general escape hatch for a false positive.
# A path that simply should not have been forbidden belongs out of
# FORBIDDEN_PATHS entirely, with the reasoning recorded in the same commit.
# Empty, and the mechanism stays because the next deferral will want it. The one
# entry this ever held, docs/superpowers/, is in FORBIDDEN_PATHS above: its
# expiry passed unnoticed and five files reached a public repository in the gap.
# A deferral that outlives its own expiry is worse than no deferral, because the
# guard reports clean the whole time.
DEFERRED_PATHS = ()

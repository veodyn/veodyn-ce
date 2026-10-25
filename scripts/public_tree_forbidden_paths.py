"""The paths that must never exist in the public tree.

The public/private split here is along a branch, not a repository, and git
enforces none of it: a routine `git merge main` into `oss` restores every
deleted file in one commit with no conflict and no prompt, several of them
holding live deploy credentials.

This is the manifest half of the guard and `scripts/check-public-tree.py` is
the half that fails. The list lives in its own module so a change to it can be
reviewed without reading any matching logic.

Paths only. Never a credential value, never a fragment of one, never anything
derived from one: this file is itself public. The reason column says what kind
of thing lived at the path and why it cannot ship, in terms a reader who has
never seen the file can check. An entry that never held anything is harmless,
but an entry whose reason is invented is worse than no entry.

Provenance: most entries are a prefix of something the Phase 3 deletion
removed, `git diff --diff-filter=D --name-only 06a33c5..06099fa` (81 files).
The two under "Image builds" came later, in Phase 4, and are marked as such so
their absence from that diff does not read as drift.

Matching rule, implemented in check-public-tree.py: an entry ending in `/`
matches any path under that directory, and an entry not ending in `/` matches
that one path exactly. Exact rather than prefix, so `docs/bugs.md` cannot be
read as also claiming `docs/bugs-triage.md`.
"""

import importlib.util
from pathlib import Path


def _sibling(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(f"{name}.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


INTERNAL_DOCUMENTS = _sibling("public_tree_forbidden_documents").INTERNAL_DOCUMENTS

# (path, reason). See the matching rule in this module's docstring.
FORBIDDEN_PATHS = (
    # --- Deployment configuration -----------------------------------------
    (
        "helm/envs/",
        "Per-environment Helm values plus the `secrets` env file: real ingress hostnames, "
        "tenant ids, and credential values in the clear.",
    ),
    (
        "site/",
        "The public traveler-information site deployed beside Veodyn. Its only skin is a "
        "client's (that client's information architecture, pending brand consent), and its page set, "
        "container ids and deploy values are that deployment's. A reusable core can be split "
        "out for the community tree once a second client exists.",
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
    # The test jobs stay. The line is whether a fork outside the origin
    # installation could run the job at all: the gates need a language runtime
    # and this checkout, the builds need push credentials to a private registry
    # and, in two cases, read access to a private repository.
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
    *INTERNAL_DOCUMENTS,
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
        "scripts/carry-to-ce.py",
        "Carries commits from this tree to the community one. It has a direction, and only "
        "this side is its source; there it would push that repository into itself.",
    ),
    (
        "scripts/test_carry_to_ce.py",
        "Tests for carry-to-ce.py, forbidden above. A test whose subject is absent collects "
        "nothing and passes, which is worse than not being there.",
    ),
    (
        "scripts/compose-docs.sh",
        "Composes a tenant pack's docs-site into the community docs for an instance build. "
        "It reads a private pack checkout and only the deploy pipeline calls it.",
    ),
    (
        "scripts/test_compose_docs.py",
        "Tests for compose-docs.sh, forbidden above, for the same reason test_carry_to_ce.py is.",
    ),
    (
        "scripts/hooks/",
        "Git hooks for this side of the split. The pre-push one calls check-tree-parity and "
        "carry-to-ce, neither of which exists there.",
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
        "docs/superpowers/",
        "Internal specs, plans and implementation notes: work in progress, naming internal "
        "incidents, unfixed weaknesses and private pack internals. It sat in DEFERRED_PATHS "
        "until 2026-08-18 because the reorg was executed against these documents. That "
        "deferral expired when veodyn-ce went public on 2026-08-11 and nobody closed it, so "
        "commit db9e3e4 carried five of them into an already-public repository on 2026-08-14 "
        "while check-public-tree passed, having been told to skip them.",
    ),
)

# NOT forbidden, with an expiry. Printed on every run, and carried as data
# rather than as a comment so the note cannot be deleted without deleting the
# decision it records.
#
# An entry here is a path known to be unfit for the public tree and kept anyway
# for a stated span. Not an escape hatch for a false positive: a path that
# should never have been forbidden belongs out of FORBIDDEN_PATHS entirely,
# with the reasoning recorded in the same commit.
#
# Empty, and the mechanism stays because the next deferral will want it. The one
# entry this ever held, docs/superpowers/, is now in FORBIDDEN_PATHS above: its
# expiry passed unnoticed and five files reached a public repository in the gap,
# with the guard reporting clean the whole time.
DEFERRED_PATHS = ()

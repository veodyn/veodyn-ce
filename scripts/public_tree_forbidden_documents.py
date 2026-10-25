INTERNAL_DOCUMENTS = (
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
        "docs/internal/",
        "Documents written for one client rather than for a reader of the tree: how its "
        "dashboards and widgets are assembled on its production instance, with hostnames, query "
        "ids and public share tokens, an embedding guide for its developers, commercial "
        "proposals and pricing schedules, and a design mock-up for its public site. Kept under "
        "one directory so this public manifest does not have to name the client to keep them out.",
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
)

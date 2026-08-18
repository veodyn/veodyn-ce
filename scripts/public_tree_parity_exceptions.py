"""The paths allowed to differ between this tree and the community tree.

Companion to public_tree_forbidden_paths, and a different question. That
module answers "may this path exist publicly at all". This one answers "these
two copies are not byte-identical, is that allowed".

`scripts/check-tree-parity.py` is the half that fails. Everything tracked in
both trees and not named here must match byte for byte.

THE BAR FOR AN ENTRY is high: the difference has to be a consequence of what
the two repositories ARE, not of when someone last edited them. "The deploy
pipeline has a `default:` docker-in-docker block and the community one does
not" qualifies. "This was changed here and nobody copied it over" does not. If
the structural reason does not fit in a sentence, the honest fix is to make the
two files match.

Matching rule, same as the forbidden manifest: an entry ending in `/` matches
anything beneath it, an entry without one matches that path exactly.
"""

# (path, reason). Exists in both trees; the two copies may differ.
DIVERGENT_PATHS = (
    (
        ".gitlab-ci.yml",
        "The deploy pipeline includes the assemble and deploy jobs and carries a `default:` "
        "block with a docker-in-docker service for the image builds. The community pipeline "
        "has neither, because the jobs needing them are deploy-only by policy.",
    ),
    (
        "ci/veodyn-de-test.yaml",
        "Declares `services: []` to keep the deploy pipeline's default docker-in-docker "
        "service off a job that has no use for a privileged daemon. The override is a no-op "
        "where there is no such block, so the community copy does not carry it.",
    ),
    (
        "ci/helm-render-test.yaml",
        "The same `services: []` override, for the same reason as ci/veodyn-de-test.yaml.",
    ),
    (
        "scripts/scan_secrets_extra_allowlist.py",
        "Excuses three PostHog project keys by exact path under helm/envs/, a directory that "
        "is forbidden here and therefore absent there. Those entries cannot exist in the "
        "community copy, because the files they name cannot.",
    ),
    (
        "CLAUDE.md",
        "Describes the repository the reader is standing in. The deploy copy documents the "
        "two-repository split, the release path and the deploy-only trees; the community "
        "copy describes a tree that has none of them.",
    ),
)

# (path, reason). Exists ONLY in the community tree. Same bar as above.
COMMUNITY_ONLY_PATHS = (
    (
        ".github/workflows/docs-check.yml",
        "GitHub Actions, and the community repository is the only one of the two hosted on "
        "GitHub. This repository's pipeline runs on GitLab, where the file would never fire.",
    ),
)

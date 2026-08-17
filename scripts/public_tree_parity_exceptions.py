"""The paths allowed to differ between this tree and the community tree.

Companion to public_tree_forbidden_paths, and a different question. That
module answers "may this path exist publicly at all". This one answers "these
two copies are not byte-identical, is that allowed". Kept separate because the
two lists are edited by different changes for different reasons, and a
reviewer weighing a parity exception should not have to read a credential
manifest to do it.

`scripts/check-tree-parity.py` is the half that fails. Everything tracked in
both trees and not named here must match byte for byte.

WHY THIS GUARD EXISTS. Only docs/ was compared before, and everything else was
left to whoever remembered. It was not remembered. Six files under node/ sat
for weeks at the state of the initial community import while this tree moved
on twice: riits_gtfsrt and riits_geojson were still declared as blocking
manual migrations after their runners had moved into the pack, and a
credential-detector test file that a 300-line split created here never existed
there at all. Neither side failed anything. The community tree was in a
half-ported state rather than an old one, which is what makes this class of
drift hard to spot by reading: bin/report_data_source_types.py already
expected the new shape while legacy_types.py beside it did not.

THE BAR FOR AN ENTRY, and it is deliberately high: the difference has to be a
consequence of what the two repositories ARE, not of when someone last edited
them. "The deploy pipeline has a `default:` docker-in-docker block and the
community one does not" qualifies. "This was changed here and nobody copied it
over" does not, and is the exact failure this list must never be used to paper
over. If the structural reason does not fit in a sentence, the honest fix is
to make the two files match.

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

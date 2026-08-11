"""Two chains, and neither can be walked into the other.

The community half and the enterprise half were one linear chain, `0001`
through `0010`, in one script directory. Splitting them is not a renaming
exercise: every existing database, stage and prod included, holds a row saying
`0010`, so the ids have to survive the split exactly. What changes is which
revision each one revises, and which directory it lives in.

Three `down_revision` values move and nothing else does:

    0005  "0004" -> None    the community chain gets its own root
    0007  "0006" -> "0004"  the enterprise chain stops hanging off a community one
    0009  "0008" -> "0006"  the community chain closes the gap the move leaves

`0007` is the one that makes this more than a one-line edit. It is an
enterprise revision whose parent was a community revision, so the enterprise
chain was attached to the community chain and could not be detached by editing
community files alone.

Nothing here needs a database, which is the point: these hold before anything
has been applied anywhere. `test_migration_upgrade.py` is the half that applies
a chain for real.
"""

from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

from migrations.ownership import CE_TABLES
from tests.migration_chains import (
    CE_REVISIONS,
    EE_REVISIONS,
    EE_TABLES,
    ce_config,
    ce_version_files,
    declared_revisions,
    ee_config,
    ee_version_files,
    tables_touched,
)

ORIGINAL_IDS = frozenset(CE_REVISIONS) | frozenset(EE_REVISIONS)


def walked(config: Config, head: str) -> list[str]:
    # walk_revisions takes (base, head) in that order and yields newest first,
    # so the arguments read backwards from the result. Passing them the other
    # way round raises "does not refer to ancestor/descendant revisions along
    # the same branch" on a chain that is perfectly fine.
    script = ScriptDirectory.from_config(config)
    return [revision.revision for revision in script.walk_revisions("base", head)]


def test_the_community_chain_is_linear_from_one_root_to_one_head() -> None:
    # One head is the assertion with teeth. Alembic tolerates several in
    # silence and raises MultipleHeads later, from whatever deploy job first
    # runs `upgrade head`, which is a long way from the commit that caused it.
    script = ScriptDirectory.from_config(ce_config())

    assert list(script.get_heads()) == ["0010"], f"expected one community head, got {script.get_heads()}"
    assert list(script.get_bases()) == ["0005"], f"expected one community root, got {script.get_bases()}"
    assert walked(ce_config(), "0010") == list(CE_REVISIONS)


def test_the_enterprise_chain_is_linear_and_walks_into_no_community_revision() -> None:
    script = ScriptDirectory.from_config(ee_config())

    assert list(script.get_heads()) == ["0008"], f"expected one enterprise head, got {script.get_heads()}"
    assert list(script.get_bases()) == ["0001"], f"expected one enterprise root, got {script.get_bases()}"
    assert walked(ee_config(), "0008") == list(EE_REVISIONS)


def test_every_community_parent_is_a_community_revision() -> None:
    # The version of the walk above that survives a broken chain. Alembic
    # resolves the whole revision map before doing anything at all, so a
    # `down_revision` naming a revision that has moved to the pack fails every
    # other test in this file with the same opaque resolution error.
    declared = declared_revisions(ce_version_files())

    assert set(declared) == set(CE_REVISIONS)
    for revision, parent in sorted(declared.items()):
        assert parent is None or parent in declared, f"{revision} revises {parent}, which is not a community revision"


def test_every_enterprise_parent_is_an_enterprise_revision() -> None:
    declared = declared_revisions(ee_version_files())

    assert set(declared) == set(EE_REVISIONS)
    for revision, parent in sorted(declared.items()):
        assert parent is None or parent in declared, f"{revision} revises {parent}, not an enterprise revision"


def test_no_revision_id_changed_when_the_chain_split() -> None:
    """The stamp in every existing database is a revision id.

    Renumbering `0007` to `0005` because it is now fifth in its own directory
    would read as tidying and would leave stage and prod holding a stamp that
    names nothing, which Alembic reports as `Can't locate revision` on the next
    deploy rather than as anything about this commit.
    """
    community = set(declared_revisions(ce_version_files()))
    enterprise = set(declared_revisions(ee_version_files()))

    # An empty enterprise directory would satisfy the union on its own, since
    # the community directory held all ten before the split.
    assert len(enterprise) == len(EE_REVISIONS), "the enterprise revisions are not in the pack"
    assert community | enterprise == ORIGINAL_IDS
    assert community & enterprise == set(), "the two chains would write conflicting rows for one id"


def test_the_community_revision_files_are_exactly_the_community_chain() -> None:
    # Without the pack installed there is no enterprise directory to compare
    # against, so this is the half of the test above that still holds in CI.
    assert set(declared_revisions(ce_version_files())) == set(CE_REVISIONS)
    assert {path.name.split("_")[0] for path in ce_version_files()} == set(CE_REVISIONS)


@pytest.mark.parametrize("path", ce_version_files(), ids=lambda path: path.name)
def test_no_community_revision_touches_an_enterprise_table(path: Path) -> None:
    touched = tables_touched(path.read_text())

    assert not touched & EE_TABLES, f"{path.name} touches {sorted(touched & EE_TABLES)}"
    assert touched <= CE_TABLES, f"{path.name} touches {sorted(touched - CE_TABLES)}, which no allowlist claims"


def test_no_enterprise_revision_touches_a_community_table() -> None:
    # Not redundant with its mirror. `0007` sat between two community
    # revisions in the original chain, so it is exactly where a stray
    # community table would have been picked up, and it is the one revision
    # here that alters a table it did not create.
    paths = ee_version_files()

    assert len(paths) == len(EE_REVISIONS), "an empty directory touches nothing, which is not the claim"
    for path in paths:
        touched = tables_touched(path.read_text())

        assert not touched & CE_TABLES, f"{path.name} touches {sorted(touched & CE_TABLES)}"
        assert touched <= EE_TABLES, f"{path.name} touches {sorted(touched - EE_TABLES)}, which no allowlist claims"

"""The allowlists say what each chain owns, and `env.py` has to use them.

These need no database. What they guard is the bookkeeping around the composed
tests: an allowlist that has fallen behind the revisions, two allowlists that
have started to overlap, and a `context.configure` call that was never given
the filters at all.

What is NOT here is the comparison against the pack's own copy of `EE_TABLES`.
It was, behind a `pytest.importorskip`, and that resolves on a developer
machine and never in this pipeline, whose lock the pack is not in and must
never be in. So it ran on no CI anywhere while reading as coverage. It lives in
the pack now, at `tests/test_allowlists_agree.py`, which is the only pipeline
with both trees checked out at once.
"""

import ast
from pathlib import Path

from migrations.ownership import CE_TABLES
from tests.migration_chains import CE_MIGRATIONS, EE_TABLES, calls_named


def upgrade_body(tree: ast.AST) -> ast.AST:
    """The `upgrade()` function alone, so a scan of its calls never also picks
    up `downgrade()`'s calls, which run the same ops in reverse."""
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "upgrade":
            return node
    raise AssertionError("a revision file has no upgrade() to read")


def tables_created_by(directory: Path) -> frozenset[str]:
    """Every table a revision's `upgrade()` creates, tracked through any later
    rename.

    `rename_table` swaps a name out of this set and the new one in, so a table
    created under one name and renamed later is counted under the name the
    chain ends at, which is the name `CE_TABLES` has to match.
    """
    created: set[str] = set()
    for path in sorted(directory.glob("[0-9]*.py")):
        body = upgrade_body(ast.parse(path.read_text()))
        for call in calls_named(body, "create_table"):
            first = call.args[0]
            assert isinstance(first, ast.Constant), f"{path.name} names a table it does not spell out"
            created.add(str(first.value))
        for call in calls_named(body, "rename_table"):
            old, new = call.args[0], call.args[1]
            assert isinstance(old, ast.Constant) and isinstance(new, ast.Constant), (
                f"{path.name} renames a table it does not spell out"
            )
            created.discard(str(old.value))
            created.add(str(new.value))
    return frozenset(created)


def test_the_allowlist_is_every_table_the_community_revisions_still_create() -> None:
    # A hand-maintained allowlist rots, and the failure when it does is that
    # the filter proposes dropping a table this chain created itself.
    #
    # The subtraction is what makes this hold in both eras: the community
    # `versions/` used to create all seven product tables, and now that the
    # enterprise revisions have moved out to the pack the term is empty and the
    # assertion reads as the plain equality it always wanted to be.
    assert tables_created_by(CE_MIGRATIONS / "versions") - EE_TABLES == CE_TABLES


def test_the_two_allowlists_do_not_overlap() -> None:
    # If they ever did, both chains would claim one table and whichever
    # `upgrade head` ran second would fail on a table the first had made.
    #
    # This says nothing about either set being current. Two sets can be
    # perfectly disjoint and both stale; the pack's `test_allowlists_agree.py`
    # is what holds them to the trees that own them.
    assert CE_TABLES & EE_TABLES == frozenset()


def test_both_configure_calls_take_both_filters_and_the_version_table() -> None:
    """The offline call has no behavioural test, and cannot have one.

    `include_name` and `include_object` are read only by autogenerate, and
    offline mode never autogenerates, so `alembic upgrade --sql` emits the same
    script either way (measured, and the brief said otherwise). They belong on
    the offline call anyway: the two calls are read as a pair, and a reader who
    finds one of them unfiltered has to work out for themselves whether that is
    deliberate. `version_table` is the one that really does differ offline.
    """
    calls = calls_named(ast.parse((CE_MIGRATIONS / "env.py").read_text()), "configure")

    assert len(calls) == 2, f"expected an offline and an online configure call, found {len(calls)}"
    for call in calls:
        kwargs = {keyword.arg: keyword.value for keyword in call.keywords if keyword.arg is not None}
        assert "include_name" in kwargs, "a configure call reflects the other chain's tables"
        assert "include_object" in kwargs, "a configure call can still propose creating an enterprise table"
        version_table = kwargs.get("version_table")
        assert isinstance(version_table, ast.Name) and version_table.id == "VERSION_TABLE", (
            "a configure call does not name this chain's own version table"
        )

CE_REVISIONS = ("0018", "0017", "0016", "0015", "0014", "0013", "0012", "0011", "0010", "0009", "0006", "0005")
"""The community chain, newest first. Ids, not positions: these are stamped in
every existing database, so a renumbering orphans the stamp rather than tidying
anything.

Hand maintained on purpose, and deriving it from `versions/` would be the one
change to avoid: `test_the_community_revision_files_are_exactly_the_community
_chain` compares this tuple against those files, so a derived tuple would make
that assertion compare the files to themselves and pass whatever landed."""

CE_HEAD = CE_REVISIONS[0]
"""The newest community revision, named once. It was written out longhand in
three places, so adding a revision meant finding all three and the ones missed
failed as an unrelated-looking assertion about heads."""

CE_PREVIOUS = CE_REVISIONS[1]
"""One revision back from head, for the control in `test_migration_upgrade.py`
that has to seed a database deliberately behind."""

CE_SHIPPED_IDS = frozenset({"0010", "0009", "0006", "0005"})
"""Community ids that have been stamped in a real database, as a literal that is
**appended to, never edited**.

It exists because everything else about the chain is now derived from
`CE_REVISIONS`, including the head. That is convenient and it costs one guard:
a coordinated renumber (the file, its children, and the tuple) would leave every
other assertion green while orphaning the stamp in every database already
carrying the old id. Deriving this set too would reproduce exactly that hole, so
it is written out and `test_migration_chain.py` holds the chain to it.

Add an id here only once a revision has actually shipped. Removing one is the
error this guards."""

EE_REVISIONS = (
    "0026",
    "0025",
    "0024",
    "0023",
    "0022",
    "0021",
    "0020",
    "0019",
    "0018",
    "0017",
    "0016",
    "0015",
    "0014",
    "0013",
    "0012",
    "0011",
    "0010",
    "0009",
    "0008",
    "0007",
    "0004",
    "0003",
    "0002",
    "0001",
)
"""The enterprise chain, newest first."""

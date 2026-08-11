"""The favorites wire shape.

Grouped by kind rather than a flat list of {type, id} pairs: every caller wants
one kind at a time (the KPI list marks KPIs), so the grouping is the lookup the
client would otherwise build on arrival.

A RootModel rather than a class with a field per kind, because which kinds exist
depends on what is installed: the keys come from the object-type registry, and a
build with a pack contributing a fourth kind must not need a schema change here
to report it. With `kpi` and `report` registered the JSON body is exactly what
the two declared fields produced.
"""

from pydantic import RootModel


class FavoritesOut(RootModel[dict[str, list[str]]]):
    """The caller's own starred ids, keyed by object type.

    One key per registered favoritable kind, always, and an empty list where
    there are no stars: a person with no favorites has an empty set, not an
    unknown one, and a client that has to tell those apart will get it wrong.
    """

"""Is this binding capable of producing a feed at all? Runs when a binding is
saved, long before any bytes are produced.

Pure. The caller supplies the query's known column names, because discovering them
costs a whole result body (see `ai_grounding.query_result_columns`).

`REQUIRED_FIELDS` and `SUPPORTED_FIELDS` come from the serializer, the module that
actually writes the fields, so the vocabulary cannot drift between the two.
"""

from dataclasses import dataclass

from veodyn_api.services.gtfs_rt_serializer import REQUIRED_FIELDS, SUPPORTED_FIELDS


@dataclass(frozen=True)
class BindingCheck:
    """`ok` may publish, `invalid` never may, `unvalidated` may not yet.

    Three-way because "could not read the query's columns" and "the query does not
    have those columns" are different facts: conflating them refuses a binding for
    a query that has simply never run.
    """

    state: str
    problems: tuple[str, ...]


def check_column_map(
    entity: str,
    column_map: dict[str, str],
    result_columns: tuple[str, ...],
) -> BindingCheck:
    """Structure first, then the mapping against real columns."""
    required = REQUIRED_FIELDS.get(entity)
    supported = SUPPORTED_FIELDS.get(entity)
    if required is None or supported is None:
        known = ", ".join(sorted(set(REQUIRED_FIELDS) & set(SUPPORTED_FIELDS)))
        return BindingCheck("invalid", (f"entity {entity!r} is not supported (have: {known})",))

    problems: list[str] = []

    missing = sorted(required - set(column_map))
    problems.extend(f"required field {field!r} is not mapped" for field in missing)

    # A key the serializer does not write (`timestamps` for `timestamp`) never
    # reaches the feed. Caught here because the serializer refuses the same map
    # later, when the only reader is a failed attempt row.
    unknown_fields = sorted(set(column_map) - supported)
    problems.extend(f"field {field!r} is not written for entity {entity!r}" for field in unknown_fields)

    # Structural problems need no knowledge of the query, so a hopeless binding is
    # refused now rather than parked as pending forever.
    if problems:
        return BindingCheck("invalid", tuple(problems))

    if not result_columns:
        return BindingCheck("unvalidated", ())

    known_columns = set(result_columns)
    unknown = sorted({column for column in column_map.values() if column not in known_columns})
    problems.extend(f"column {column!r} is not returned by the query" for column in unknown)

    if problems:
        return BindingCheck("invalid", tuple(problems))
    return BindingCheck("ok", ())

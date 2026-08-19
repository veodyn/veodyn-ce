"""Is this binding capable of producing a feed at all? Runs when a binding is
saved, long before any bytes are produced.

Pure. The caller supplies the query's known column names, because discovering them
costs a whole result body (see `ai_grounding.query_result_columns`).

Both vocabularies come from the serializers, the modules that actually write the
fields, so they cannot drift from what is served.
"""

from dataclasses import dataclass

from veodyn_api.services import gbfs_serializer, gtfs_rt_serializer

# Standard to (required fields, supported fields), each keyed by entity.
_VOCABULARIES: dict[str, tuple[dict[str, frozenset[str]], dict[str, frozenset[str]]]] = {
    "gtfs-rt": (gtfs_rt_serializer.REQUIRED_FIELDS, gtfs_rt_serializer.SUPPORTED_FIELDS),
    "gbfs": (gbfs_serializer.REQUIRED_FIELDS, gbfs_serializer.SUPPORTED_FIELDS),
}


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
    standard: str,
    entity: str,
    column_map: dict[str, str],
    result_columns: tuple[str, ...],
) -> BindingCheck:
    """Structure first, then the mapping against real columns.

    `standard` leads because it selects the vocabulary: the same entity name and
    the same map mean different things under each standard.
    """
    required_by_entity, supported_by_entity = _VOCABULARIES.get(standard, ({}, {}))
    required = required_by_entity.get(entity)
    supported = supported_by_entity.get(entity)
    if required is None or supported is None:
        known = ", ".join(sorted(set(required_by_entity) & set(supported_by_entity))) or "(none)"
        return BindingCheck("invalid", (f"entity {entity!r} is not supported for {standard} (have: {known})",))

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

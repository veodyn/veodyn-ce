"""Whether a binding can be trusted to produce a feed, checked when it is saved."""

from veodyn_api.services.feed_binding_checks import check_column_map

COLUMNS = ("bus", "lat", "lon", "trip", "ts")


def test_a_complete_map_over_known_columns_is_ok():
    check = check_column_map(
        "vehicle_positions",
        {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"},
        COLUMNS,
    )

    assert check.state == "ok"
    assert check.problems == ()


def test_a_missing_required_field_is_invalid():
    check = check_column_map("vehicle_positions", {"vehicle_id": "bus"}, COLUMNS)

    assert check.state == "invalid"
    assert any("latitude" in problem for problem in check.problems)
    assert any("longitude" in problem for problem in check.problems)


def test_a_column_the_query_does_not_return_is_invalid():
    check = check_column_map(
        "vehicle_positions",
        {"vehicle_id": "bus", "latitude": "lat", "longitude": "nope"},
        COLUMNS,
    )

    assert check.state == "invalid"
    assert any("nope" in problem for problem in check.problems)


def test_an_unknown_entity_is_invalid():
    check = check_column_map("trip_updates", {"vehicle_id": "bus"}, COLUMNS)

    assert check.state == "invalid"
    assert any("trip_updates" in problem for problem in check.problems)


def test_no_known_columns_means_unvalidated_not_invalid():
    """`query_result_columns` returns () for "could not find out", never for
    "it has none", so a never-run query must not be called broken. It saves
    and cannot publish until a result proves the map."""
    check = check_column_map(
        "vehicle_positions",
        {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon"},
        (),
    )

    assert check.state == "unvalidated"
    assert check.problems == ()


def test_a_structurally_broken_map_is_invalid_even_with_no_columns():
    """Missing a required field needs no result to prove: it is wrong on its
    own terms, and deferring it would let a hopeless binding sit as pending."""
    check = check_column_map("vehicle_positions", {"vehicle_id": "bus"}, ())

    assert check.state == "invalid"


def test_an_optional_field_the_serializer_writes_is_ok():
    """The vocabulary is the serializer's whole supported set, not just the
    required part, or every optional mapping would read as a typo."""
    check = check_column_map(
        "vehicle_positions",
        {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon", "trip_id": "trip", "timestamp": "ts"},
        COLUMNS,
    )

    assert check.state == "ok"
    assert check.problems == ()


def test_a_field_the_serializer_does_not_write_is_invalid():
    """`timestamps` for `timestamp` maps a real column onto nothing.

    The serializer refuses it too, but by then the only reader is a failed
    attempt row. Here the person who typed the key is still looking at it.
    """
    check = check_column_map(
        "vehicle_positions",
        {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon", "timestamps": "ts"},
        COLUMNS,
    )

    assert check.state == "invalid"
    assert any("timestamps" in problem for problem in check.problems)


def test_an_unknown_field_is_invalid_even_with_no_columns():
    """A typo is decidable without knowing anything about the query, so it is
    refused now rather than parked as unvalidated until a result arrives."""
    check = check_column_map(
        "vehicle_positions",
        {"vehicle_id": "bus", "latitude": "lat", "longitude": "lon", "timestamps": "ts"},
        (),
    )

    assert check.state == "invalid"
    assert any("timestamps" in problem for problem in check.problems)


def test_both_structural_problems_are_reported_together():
    """One save should name everything wrong with the map, not the first thing."""
    check = check_column_map("vehicle_positions", {"vehicle_id": "bus", "timestamps": "ts"}, COLUMNS)

    assert check.state == "invalid"
    assert any("latitude" in problem for problem in check.problems)
    assert any("longitude" in problem for problem in check.problems)
    assert any("timestamps" in problem for problem in check.problems)

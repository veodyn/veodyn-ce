"""The option allowlist an anonymous reader's chart is rebuilt from.

`schemas/public_viz_options.py` is the last thing between a stored vizConfig and
a browser nobody signed in from. test_public_report_shape.py already holds the
whole public body to an equality; what it cannot reach is the per-rule refusals,
because a report fixture carries one well-formed option set and every wrong shape
is a different document. These go at the rules directly.

The contract they pin, in one sentence: a declared key whose value is the wrong
shape is dropped rather than coerced, and a container that arrived carrying
entries and kept none goes with them rather than leaving an empty shell behind.
"""

from typing import Any

import pytest

from veodyn_api.schemas.public_viz_options import (
    DROP,
    PUBLIC_VIZ_OPTIONS,
    _sanitize_value,
    sanitize_viz_options,
)


def test_an_undeclared_key_does_not_survive() -> None:
    """The baseline the rest of the file is a refinement of. `sourceQuery` is the
    key test_public_report_shape.py names as having actually travelled."""
    kept = sanitize_viz_options(
        "CHART",
        {"globalSeriesType": "column", "sourceQuery": {"id": 41, "queryText": "SELECT secret FROM internal"}},
    )

    assert kept == {"globalSeriesType": "column"}


def test_a_type_the_allowlist_does_not_declare_gets_nothing() -> None:
    """Not a passthrough and not a raise. A renderer nobody has declared a public
    shape for draws its own unsupported state, which is visible; forwarding the
    stored options because the type is unknown is the silent outcome."""
    assert "IFRAME" not in PUBLIC_VIZ_OPTIONS
    assert sanitize_viz_options("IFRAME", {"src": "https://internal/admin", "columns": ["a"]}) == {}


@pytest.mark.parametrize("options", ["globalSeriesType=column", ["globalSeriesType"], 3, None, True])
def test_options_that_are_not_an_object_are_nothing_rather_than_a_raise(options: Any) -> None:
    """vizConfig.options is JSONB and unmodelled, so a legacy document can hold a
    string here. A raise costs the whole report for every reader."""
    assert sanitize_viz_options("CHART", options) == {}


# ---------------------------------------------------------------------------
# Scalar rules.


@pytest.mark.parametrize("value", [12, 0, -3, 2.5, 1e300])
def test_a_number_option_keeps_an_int_or_a_float(value: float) -> None:
    assert sanitize_viz_options("COUNTER", {"rowNumber": value}) == {"rowNumber": value}


@pytest.mark.parametrize("value", [True, False])
def test_a_boolean_where_a_number_was_declared_is_the_wrong_shape_not_a_zero(value: bool) -> None:
    """bool subclasses int in Python, so the obvious isinstance check keeps True
    and the counter then reads row 1 because somebody stored a checkbox."""
    assert sanitize_viz_options("COUNTER", {"rowNumber": value}) == {}


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_a_non_finite_number_is_refused(value: float) -> None:
    """NaN and the infinities are not JSON, so they only reach here through a
    Python-side write, and every renderer that meets one draws an empty axis."""
    assert sanitize_viz_options("COUNTER", {"rowNumber": value}) == {}


@pytest.mark.parametrize("value", ["3", None, [3], {"n": 3}])
def test_a_number_option_of_any_other_shape_is_dropped(value: Any) -> None:
    assert sanitize_viz_options("COUNTER", {"rowNumber": value}) == {}


@pytest.mark.parametrize("value", [3, None, True, ["column"]])
def test_a_string_option_of_the_wrong_shape_is_dropped(value: Any) -> None:
    assert sanitize_viz_options("CHART", {"globalSeriesType": value}) == {}


@pytest.mark.parametrize("value", ["yes", 1, 0, None])
def test_a_boolean_option_of_the_wrong_shape_is_dropped(value: Any) -> None:
    """1 and 0 in particular: a truthiness check would keep both and the chart
    would render stacked because a legacy document stored an int."""
    assert sanitize_viz_options("CHART", {"showLegend": value}) == {}


def test_a_dropped_key_leaves_the_rest_of_the_options_standing() -> None:
    """One refused value costs the key and nothing else. The chart still draws."""
    kept = sanitize_viz_options("CHART", {"globalSeriesType": "line", "showLegend": "yes", "donut": True})

    assert kept == {"globalSeriesType": "line", "donut": True}


def test_a_rule_name_nobody_defined_refuses_rather_than_passes_through() -> None:
    """Unreachable from `sanitize_viz_options` today: every rule in the table is
    one of the four the branches above handle. It is the guard against a typo in
    the table itself, where the failure mode is a key forwarded unchecked, so it
    is exercised where it lives."""
    assert _sanitize_value("nubmer", 3) is DROP


# ---------------------------------------------------------------------------
# StringMap: the chart column mapping.


def test_a_column_mapping_keeps_only_string_to_string_entries() -> None:
    kept = sanitize_viz_options("CHART", {"columnMapping": {"day": "x", "n": "y", "meta": {"queryId": 41}}})

    assert kept == {"columnMapping": {"day": "x", "n": "y"}}


def test_a_column_mapping_that_kept_nothing_takes_its_key_with_it() -> None:
    """An empty mapping is not the same answer as no mapping: the renderer reads
    it as "no series", and leaving the shell behind hides that every entry the
    author wrote was refused."""
    assert sanitize_viz_options("CHART", {"columnMapping": {"n": {"queryId": 41}}}) == {}


def test_an_author_s_own_empty_mapping_is_kept_as_it_stands() -> None:
    """The other side of the rule above. Nothing was refused here, so nothing is
    being hidden, and the stored value is what the author wrote."""
    assert sanitize_viz_options("CHART", {"columnMapping": {}}) == {"columnMapping": {}}


@pytest.mark.parametrize("value", ["day:x", ["day", "x"], 3, None])
def test_a_column_mapping_that_is_not_an_object_is_dropped(value: Any) -> None:
    assert sanitize_viz_options("CHART", {"columnMapping": value}) == {}


# ---------------------------------------------------------------------------
# Arr: lists of objects, and the one list of bare strings.


def test_a_reference_line_list_is_rebuilt_entry_by_entry() -> None:
    kept = sanitize_viz_options(
        "CHART",
        {
            "referenceLines": [
                {"value": 10.0, "label": "target", "color": "#fff", "axis": "y", "queryId": 41},
                {"value": "high", "label": "ceiling"},
            ]
        },
    )

    assert kept == {
        "referenceLines": [
            {"value": 10.0, "label": "target", "color": "#fff", "axis": "y"},
            # The whole entry survives with its bad key gone rather than the
            # entry going with it: a partial reference line still draws.
            {"label": "ceiling"},
        ]
    }


@pytest.mark.parametrize("value", [{"0": {"type": "linear"}}, "linear", 3, None])
def test_a_list_option_that_is_not_a_list_is_dropped(value: Any) -> None:
    """A dict under yAxis is the interesting one: iterating it yields its keys,
    so a coercing reduction would produce a list of strings."""
    assert sanitize_viz_options("CHART", {"yAxis": value}) == {}


def test_a_list_that_kept_no_entries_takes_its_key_with_it() -> None:
    assert sanitize_viz_options("CHART", {"yAxis": ["linear", 3]}) == {}


def test_an_author_s_own_empty_list_is_kept_as_it_stands() -> None:
    assert sanitize_viz_options("CHART", {"yAxis": []}) == {"yAxis": []}


def test_the_details_columns_are_bare_names_not_descriptors() -> None:
    """DETAILS declares Arr("string") while TABLE declares Arr(Obj(...)) under
    the same key name, so a rule read off the wrong type would drop every name."""
    assert sanitize_viz_options("DETAILS", {"columns": ["day", "n", 3, {"name": "x"}]}) == {"columns": ["day", "n"]}


def test_the_table_columns_are_descriptors_not_bare_names() -> None:
    kept = sanitize_viz_options(
        "TABLE", {"columns": [{"name": "n", "visible": True, "order": 1, "secret": "x"}, "day"]}
    )

    assert kept == {"columns": [{"name": "n", "visible": True, "order": 1}]}


# ---------------------------------------------------------------------------
# ObjMap: seriesOptions, keyed by a series name the allowlist cannot know.


def test_series_options_are_rebuilt_under_keys_the_allowlist_cannot_declare() -> None:
    """The key is the analyst's series name, so it is kept whatever it is; it is
    the value that is held to the declared fields."""
    kept = sanitize_viz_options(
        "CHART",
        {"seriesOptions": {"riders": {"name": "Riders", "color": "#0af", "yAxis": 0, "sourceQuery": {"id": 41}}}},
    )

    assert kept == {"seriesOptions": {"riders": {"name": "Riders", "color": "#0af", "yAxis": 0}}}


def test_a_series_entry_that_is_not_an_object_costs_that_entry_alone() -> None:
    kept = sanitize_viz_options("CHART", {"seriesOptions": {"riders": {"name": "Riders"}, "bikes": "blue"}})

    assert kept == {"seriesOptions": {"riders": {"name": "Riders"}}}


def test_series_options_that_kept_no_entry_take_their_key_with_them() -> None:
    assert sanitize_viz_options("CHART", {"seriesOptions": {"bikes": "blue", "riders": 3}}) == {}


@pytest.mark.parametrize("value", [[{"name": "Riders"}], "riders", 3, None])
def test_series_options_that_are_not_an_object_are_dropped(value: Any) -> None:
    assert sanitize_viz_options("CHART", {"seriesOptions": value}) == {}


def test_an_author_s_own_empty_series_options_are_kept_as_they_stand() -> None:
    assert sanitize_viz_options("CHART", {"seriesOptions": {}}) == {"seriesOptions": {}}


def test_a_series_entry_stripped_to_nothing_survives_as_an_empty_object() -> None:
    """Pinned because it reads as the opposite of every rule above: the entry is
    an object, not a container, so `_survivors` never sees it and the key stays
    with an empty value. Harmless to the renderer, which reads named fields off
    it, but it is a real asymmetry and a future editor should change it on
    purpose rather than by accident."""
    kept = sanitize_viz_options("CHART", {"seriesOptions": {"riders": {"color": 5}}})

    assert kept == {"seriesOptions": {"riders": {}}}


# ---------------------------------------------------------------------------
# Obj: the nested single objects.


@pytest.mark.parametrize("value", ["linear", ["linear"], 3, None, True])
def test_a_nested_object_option_that_is_not_an_object_is_dropped(value: Any) -> None:
    assert sanitize_viz_options("CHART", {"xAxis": value}) == {}


def test_a_nested_object_keeps_its_key_even_when_every_field_was_refused() -> None:
    """`legend` is an object, not a container, so the empty-shell rule does not
    reach it. Recorded rather than argued: the renderer reads `legend.enabled`
    and finds nothing either way."""
    assert sanitize_viz_options("CHART", {"legend": {"enabled": "yes"}}) == {"legend": {}}


def test_the_word_cloud_limits_are_two_independent_bounds() -> None:
    kept = sanitize_viz_options(
        "WORD_CLOUD",
        {"column": "term", "wordLengthLimit": {"min": 3, "max": "none"}, "wordCountLimit": {"min": 1, "max": 50}},
    )

    assert kept == {"column": "term", "wordLengthLimit": {"min": 3}, "wordCountLimit": {"min": 1, "max": 50}}


def test_a_map_tooltip_template_is_a_declared_key_and_travels() -> None:
    """The template is author-written text on a public surface. It is declared,
    so it survives; naming it here means removing it from the allowlist has to be
    a decision rather than a diff nobody read."""
    kept = sanitize_viz_options(
        "MAP",
        {"latColName": "lat", "tooltip": {"enabled": True, "template": "{{name}}", "onClick": "fetch('/admin')"}},
    )

    assert kept == {"latColName": "lat", "tooltip": {"enabled": True, "template": "{{name}}"}}


def test_the_returned_object_is_not_the_stored_one() -> None:
    """A caller mutating what it was handed must not reach the report row that is
    still in the session."""
    stored: dict[str, Any] = {"globalSeriesType": "column"}

    kept = sanitize_viz_options("CHART", stored)
    kept["globalSeriesType"] = "pie"

    assert stored == {"globalSeriesType": "column"}

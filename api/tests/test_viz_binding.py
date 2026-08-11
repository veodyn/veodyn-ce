"""Options that name only columns the statement will actually return."""

from veodyn_api.schemas.public_viz_options import PUBLIC_VIZ_OPTIONS
from veodyn_api.services.result_shape import ResultColumn
from veodyn_api.services.viz_binding import COLUMN_KEYS, MAPPING_TYPES, bind_options

BUCKET = ResultColumn("bucket", "DateTime", "time")
STATION = ResultColumn("station", "String", "text")
BIKES = ResultColumn("bikes", "Float64", "number")
DOCKS = ResultColumn("docks", "Float64", "number")


def test_a_mapping_naming_a_column_that_is_not_there_loses_that_entry():
    bound = bind_options(
        "CHART",
        "chart-line",
        {"columnMapping": {"bucket": "x", "ghost": "y", "bikes": "y"}},
        (BUCKET, BIKES),
    )

    assert bound["columnMapping"] == {"bucket": "x", "bikes": "y"}


def test_an_option_outside_the_allowlist_never_survives():
    bound = bind_options("CHART", "chart-line", {"onClick": "alert(1)", "swappedAxes": True}, (BUCKET, BIKES))

    assert bound == {"swappedAxes": True, "columnMapping": {"bucket": "x", "bikes": "y"}}


def test_a_scalar_column_key_is_checked_too():
    kept = bind_options("COUNTER", "counter", {"counterColName": "bikes"}, (BIKES,))
    dropped = bind_options("COUNTER", "counter", {"counterColName": "ghost"}, (BIKES,))

    assert kept == {"counterColName": "bikes"}
    assert dropped == {}


def test_the_binder_fills_a_missing_mapping_from_the_result_shape():
    bound = bind_options("CHART", "chart-line", {}, (BUCKET, STATION, BIKES))

    # A time column takes x, the one text column splits the measure into a
    # series, and the measure is drawn. Without the series entry this is one
    # jagged line through every station at once, which is the defect this whole
    # task exists for.
    assert bound["columnMapping"] == {"bucket": "x", "station": "series", "bikes": "y"}


def test_two_measures_are_both_drawn_and_nothing_becomes_a_series():
    bound = bind_options("CHART", "chart-line", {}, (BUCKET, BIKES, DOCKS))

    assert bound["columnMapping"] == {"bucket": "x", "bikes": "y", "docks": "y"}


def test_a_label_takes_x_when_the_statement_returns_no_time_column():
    bound = bind_options("CHART", "chart-bar", {}, (STATION, BIKES))

    assert bound["columnMapping"] == {"station": "x", "bikes": "y"}


def test_a_mapping_the_model_gave_is_left_alone():
    # The columns here are the ones inference would turn into a series split, so
    # the assertion fails if the binder completes or overwrites a mapping the
    # model already authored rather than leaving it as it stands.
    bound = bind_options(
        "CHART",
        "chart-bar",
        {"columnMapping": {"bucket": "x", "bikes": "y"}},
        (BUCKET, STATION, BIKES),
    )

    assert bound["columnMapping"] == {"bucket": "x", "bikes": "y"}


def test_no_result_shape_means_no_mapping_rather_than_a_guess():
    # DESCRIBE failed. Inventing a mapping from nothing would name columns that
    # may not exist; leaving it out returns the frontend's own inference, which
    # is what shipped before this feature.
    assert bind_options("CHART", "chart-line", {}, ()) == {}


def test_a_mapping_emptied_by_the_check_is_refilled_for_a_chart():
    bound = bind_options("CHART", "chart-line", {"columnMapping": {"ghost": "x"}}, (BUCKET, BIKES))

    assert bound["columnMapping"] == {"bucket": "x", "bikes": "y"}


def test_a_mapping_emptied_by_the_check_leaves_no_empty_shell_behind():
    # Nothing infers a heatmap mapping, so an all-invented one has to leave the
    # key absent. An empty dict would read to the renderer as an authored
    # mapping and suppress its own fallback.
    bound = bind_options("HEATMAP", "heatmap", {"columnMapping": {"ghost": "x"}, "showValues": "all"}, (BUCKET, BIKES))

    assert bound == {"showValues": "all"}


def test_a_scatter_is_two_measures_and_no_series():
    bound = bind_options("CHART", "chart-scatter", {}, (BIKES, DOCKS))

    assert bound["columnMapping"] == {"bikes": "x", "docks": "y"}


def test_a_details_column_list_keeps_only_the_names_that_exist():
    bound = bind_options("DETAILS", "details", {"columns": ["bikes", "ghost", "bucket"]}, (BUCKET, BIKES))

    assert bound == {"columns": ["bikes", "bucket"]}


def test_a_table_column_descriptor_is_checked_by_its_name():
    bound = bind_options(
        "TABLE",
        "table",
        {"columns": [{"name": "bikes", "visible": True}, {"name": "ghost", "visible": True}]},
        (BIKES,),
    )

    assert bound == {"columns": [{"name": "bikes", "visible": True}]}


def test_the_sunburst_value_column_is_checked():
    # Reachable through the option surface even though no shape id produces this
    # type yet, and it names a column like any other.
    assert bind_options("SUNBURST_SEQUENCE", "sunburst", {"valueColumn": "ghost"}, (BIKES,)) == {}
    assert bind_options("SUNBURST_SEQUENCE", "sunburst", {"valueColumn": "bikes"}, (BIKES,)) == {
        "valueColumn": "bikes"
    }


def test_the_map_classify_column_is_checked():
    # classify is read as row[classify] to group markers, so an invented name
    # groups every marker under the empty string.
    bound = bind_options(
        "MAP",
        "map",
        {"latColName": "lat", "lonColName": "lon", "classify": "ghost"},
        (ResultColumn("lat", "Float64", "number"), ResultColumn("lon", "Float64", "number")),
    )

    assert bound == {"latColName": "lat", "lonColName": "lon"}


def test_a_field_that_is_not_a_column_survives_the_check():
    # targetField names a property of the GeoJSON, not of the result set.
    # Checking it against the result shape would drop it from every choropleth.
    bound = bind_options(
        "CHOROPLETH",
        "choropleth",
        {"keyColumn": "station", "valueColumn": "bikes", "targetField": "iso_a2"},
        (STATION, BIKES),
    )

    assert bound == {"keyColumn": "station", "valueColumn": "bikes", "targetField": "iso_a2"}


def test_every_declared_option_naming_a_column_is_checked():
    """The audit above, kept honest as the allowlist grows.

    A key holding a column name that nobody checks is the exact defect this
    module exists to prevent, so a new one has to land here or in COLUMN_KEYS
    rather than reaching a renderer unexamined.
    """
    # The one column-shaped name that is not a result column. It matches a
    # feature property of the GeoJSON instead.
    not_a_column = {("CHOROPLETH", "targetField")}

    def named_like_a_column(key: str, rule: object) -> bool:
        # A name test, so it catches the next keyColumn but not the next
        # classify. That gap is why the cases above exist one by one.
        return rule == "string" and (key.lower().endswith(("column", "colname", "field")) or key == "column")

    for viz_type, fields in PUBLIC_VIZ_OPTIONS.items():
        for key, rule in fields.items():
            if not named_like_a_column(key, rule) or (viz_type, key) in not_a_column:
                continue
            assert key in COLUMN_KEYS.get(viz_type, ()), f"{viz_type}.{key} names a column and nothing checks it"

    # And every type carrying a columnMapping has its mapping filtered.
    for viz_type, fields in PUBLIC_VIZ_OPTIONS.items():
        if "columnMapping" in fields:
            assert viz_type in MAPPING_TYPES, f"{viz_type} has a columnMapping and nothing filters it"

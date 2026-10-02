"""The per-instance shape catalog.

The bug this exists to stop: a pack visualization could not be asked for. The
API's shape list was hand-copied from the frontend and the API image does not
install a pack, so `RIITS_DESTINATION_BOARD` was unsayable, `viz_choice` clamped
it to "table", and the analyst got a grid of latitudes with a log line for
company. The tests below are mostly about that clamp NOT firing.
"""

import logging

import pytest

from veodyn_api.services.ai_viz_catalog import DEFAULT_CATALOG, MAX_ENTRIES, VizCatalog, VizShape, catalog_from
from veodyn_api.services.ai_viz_choice import CHOICE_IDS, CHOICE_TYPE, VIZ_RULES
from veodyn_api.services.chat.tools import VIZ_CHOICE_FIELD, tool_definitions

BOARD = {
    "id": "destination-board",
    "type": "RIITS_DESTINATION_BOARD",
    "label": "Destination Board",
    "guide": "Vehicle rows with latitude, longitude and a label column.",
}
TABLE = {"id": "table", "type": "TABLE", "label": "Table", "guide": "The last resort."}
BAR = {"id": "chart-bar", "type": "CHART", "label": "Bar", "guide": "One grouping column, one measure."}
LINE = {"id": "chart-line", "type": "CHART", "label": "Line", "guide": "A time column plus measures."}


def test_the_default_catalog_is_exactly_todays_hardcoded_list() -> None:
    """The no-catalog path must not move. Converse and outline have no turn to
    carry one, and an app older than this change sends none."""
    # Set, not sequence: the catalog presents the shapes in the order the guide
    # argues them, where CHOICE_IDS is the frontend's registration order.
    assert set(DEFAULT_CATALOG.ids) == set(CHOICE_IDS)
    assert {shape.id: shape.viz_type for shape in DEFAULT_CATALOG.shapes} == CHOICE_TYPE
    assert DEFAULT_CATALOG.rules == VIZ_RULES


@pytest.mark.parametrize("absent", [None, [], "table", {"id": "table"}, 7])
def test_anything_but_a_non_empty_list_falls_back_to_the_built_in_shapes(absent: object) -> None:
    assert catalog_from(absent).ids == DEFAULT_CATALOG.ids


def test_a_pack_type_the_api_has_never_heard_of_survives_intact() -> None:
    """The whole point. This service cannot know what a destination board is,
    and does not need to in order to let the model name one."""
    catalog = catalog_from([TABLE, BOARD])
    assert catalog.viz_choice("destination-board") == "destination-board"
    assert catalog.type_for("destination-board") == "RIITS_DESTINATION_BOARD"
    assert catalog.choice_id_for("RIITS_DESTINATION_BOARD") == "destination-board"


def test_a_shape_the_instance_does_not_offer_clamps_to_the_table() -> None:
    catalog = catalog_from([TABLE, BOARD])
    assert catalog.viz_choice("heatmap") == "table"
    assert catalog.viz_choice("chart-hologram") == "table"


def test_an_alias_is_only_followed_onto_a_shape_this_instance_has() -> None:
    """ "bar" means chart-bar, but not on an instance where the chart is off:
    resolving to a shape the frontend then refuses draws nothing, where the
    table draws something."""
    assert catalog_from([TABLE, BAR]).viz_choice("bar") == "chart-bar"
    assert catalog_from([TABLE, BOARD]).viz_choice("bar") == "table"


def test_the_label_is_normalized_into_an_id_the_way_a_model_writes_it() -> None:
    assert catalog_from([TABLE, BOARD]).viz_choice("Destination Board") == "destination-board"


def test_the_fallback_is_the_first_shape_when_the_table_itself_is_hidden() -> None:
    """Clamping to an id the catalog does not contain would hand the frontend a
    shape it cannot resolve."""
    catalog = catalog_from([BOARD, BAR])
    assert catalog.fallback_id == "destination-board"
    assert catalog.viz_choice("nonsense") == "destination-board"


def test_one_type_backing_several_shapes_is_told_apart_by_its_options() -> None:
    catalog = catalog_from([TABLE, LINE, BAR])
    assert catalog.choice_id_for("CHART", {"globalSeriesType": "bar"}) == "chart-bar"
    # Redash writes "column" for what this build calls a bar.
    assert catalog.choice_id_for("CHART", {"globalSeriesType": "column"}) == "chart-bar"
    # A chart whose distinguishing option is missing is still a chart, never a
    # table: saying otherwise invites the model to "fix" one that is fine.
    assert catalog.choice_id_for("CHART", {}) == "chart-line"
    assert catalog.choice_id_for("CHART", {"globalSeriesType": "hologram"}) == "chart-line"


def test_the_rules_list_every_shape_and_put_the_table_last() -> None:
    """The tail prose calls the table "the LAST resort, for a result no shape
    above fits", and the frontend's registration order puts it first."""
    rules = catalog_from([TABLE, BAR, BOARD]).rules
    for shape in ("table", "chart-bar", "destination-board"):
        assert f"`{shape}`" in rules
    assert rules.index("`destination-board`") < rules.index("`table`")
    assert "Vehicle rows with latitude, longitude and a label column." in rules


def test_a_shape_with_no_guide_is_listed_under_its_label_rather_than_hidden() -> None:
    """A plugin that declares a choice and forgets the sentence should still be
    offered; the model picks it on the label alone."""
    rules = catalog_from(
        [TABLE, {"id": "transit-lines", "type": "RIITS_TRANSIT_LINES", "label": "Transit Lines"}]
    ).rules
    assert "- `transit-lines`: Transit Lines" in rules


@pytest.mark.parametrize(
    "broken",
    [
        {"id": "", "type": "TABLE", "label": "x"},
        {"id": "x", "type": "", "label": "x"},
        "not an object",
        None,
    ],
)
def test_a_malformed_entry_costs_that_one_shape_and_not_the_turn(broken: object) -> None:
    assert catalog_from([TABLE, broken, BOARD]).ids == ("table", "destination-board")


def test_a_repeated_id_keeps_the_first_and_drops_the_rest() -> None:
    second = {**BOARD, "type": "SOMETHING_ELSE"}
    catalog = catalog_from([BOARD, second])
    assert catalog.ids == ("destination-board",)
    assert catalog.type_for("destination-board") == "RIITS_DESTINATION_BOARD"


def test_a_runaway_catalog_is_capped_rather_than_sent_whole() -> None:
    many = [{"id": f"shape-{index}", "type": "TABLE", "label": "x"} for index in range(MAX_ENTRIES + 20)]
    assert len(catalog_from(many).ids) == MAX_ENTRIES


def test_an_unofferable_shape_is_logged_because_the_silent_version_is_invisible(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A dashboard of tables looks the same whether the model chose them or
    misnamed them."""
    with caplog.at_level(logging.WARNING, logger="veodyn_api.services.ai_viz_catalog"):
        catalog_from([TABLE, BOARD]).viz_choice("heatmap")
    assert "heatmap" in caplog.text


def test_the_tools_offer_the_catalogs_shapes_as_a_closed_enum() -> None:
    """A free string meant an invented shape reached the analyst as a table.
    The enum makes it unsayable."""
    catalog = catalog_from([TABLE, BOARD])
    shaped = [one for one in tool_definitions(catalog) if VIZ_CHOICE_FIELD in one["input_schema"]["properties"]]
    assert {one["name"] for one in shaped} == {"run_query", "propose_query"}
    for definition in shaped:
        field = definition["input_schema"]["properties"][VIZ_CHOICE_FIELD]
        assert field["enum"] == ["table", "destination-board"]
        assert "destination-board" in field["description"]


def test_patching_one_turns_tools_does_not_pin_that_catalog_on_the_next() -> None:
    """The definitions are module-level constants shared by every turn in the
    process, so the patch has to copy rather than edit."""
    tool_definitions(catalog_from([TABLE, BOARD]))
    after = {one["name"]: one for one in tool_definitions()}
    assert after["run_query"]["input_schema"]["properties"][VIZ_CHOICE_FIELD]["enum"] == list(DEFAULT_CATALOG.ids)


def test_a_catalog_with_no_shapes_at_all_still_answers_every_question() -> None:
    """Not reachable through catalog_from, which falls back. Constructed
    directly because every property here is read on a turn that must not raise."""
    empty = VizCatalog(shapes=())
    assert empty.ids == ()
    assert empty.viz_choice("map") == "table"
    assert empty.choice_id_for("MAP") == "table"
    assert empty.rules.startswith("How to show the result")


def test_the_shape_carries_the_label_when_no_guide_was_written() -> None:
    assert VizShape(id="x", viz_type="X", label="Ex").guide == ""

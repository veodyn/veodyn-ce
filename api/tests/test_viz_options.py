"""What the model may say about a chart, derived from what the renderer reads."""

from typing import Any

import pytest

from veodyn_api.schemas.public_viz_options import PUBLIC_VIZ_OPTIONS
from veodyn_api.services.ai_viz_choice import CHOICE_IDS, viz_type_for
from veodyn_api.services.result_shape import ResultColumn
from veodyn_api.services.viz_options import OPTION_NOTES, author_options, option_guide, options_tool_schema


class StubLlm:
    def __init__(self, answer: dict[str, Any] | Exception) -> None:
        self.answer = answer
        self.prompts: list[str] = []
        self.schemas: list[dict[str, Any]] = []

    def structured(self, *, system: str, prompt: str, schema: dict[str, Any], tool_name: str) -> dict[str, Any]:
        self.prompts.append(prompt)
        self.schemas.append(schema)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def test_every_shape_resolves_to_a_type_the_allowlist_knows() -> None:
    for choice in CHOICE_IDS:
        assert viz_type_for(choice) in PUBLIC_VIZ_OPTIONS


def test_the_chart_shapes_collapse_onto_the_one_type_the_renderer_has() -> None:
    """The five chart ids differ by globalSeriesType alone, and that difference
    is the analyst's. Mapping one of them to its own type, or to TABLE, would ask
    the model for the wrong type's options and pass the check above in silence."""
    assert {choice: viz_type_for(choice) for choice in CHOICE_IDS if choice.startswith("chart-")} == {
        "chart-line": "CHART",
        "chart-bar": "CHART",
        "chart-area": "CHART",
        "chart-pie": "CHART",
        "chart-scatter": "CHART",
    }


def test_an_unknown_shape_is_a_table() -> None:
    assert viz_type_for("chart-hologram") == "TABLE"


def test_the_tool_schema_is_derived_from_the_allowlist() -> None:
    schema = options_tool_schema("CHART")

    properties = schema["properties"]
    assert properties["swappedAxes"] == {"type": "boolean"}
    assert properties["columnMapping"] == {"type": "object", "additionalProperties": {"type": "string"}}
    assert properties["yAxis"]["type"] == "array"
    assert properties["yAxis"]["items"]["properties"]["rangeMin"] == {"type": "number"}
    assert properties["seriesOptions"]["additionalProperties"]["properties"]["curve"] == {"type": "string"}
    # Nothing outside the allowlist can be asked for, so nothing outside it can
    # come back and be dropped later with the analyst none the wiser.
    assert set(properties) == set(PUBLIC_VIZ_OPTIONS["CHART"])


@pytest.mark.parametrize("viz_type", sorted(PUBLIC_VIZ_OPTIONS))
def test_every_type_in_the_allowlist_can_be_asked_for(viz_type: str) -> None:
    """A rule form the schema builder does not handle raises rather than
    degrades, and it would raise inside a proposal, so every declared type is
    built here."""
    assert set(options_tool_schema(viz_type)["properties"]) == set(PUBLIC_VIZ_OPTIONS[viz_type])


def test_the_guide_offers_every_key_the_allowlist_declares() -> None:
    """Both halves of the guide: a key with a note is explained, a key without
    one is still listed. A key the guide leaves out is one the model has no
    reason to set, even though the tool schema accepts it."""
    guide = option_guide("CHART")

    assert OPTION_NOTES["CHART"]["columnMapping"] in guide
    assert "stacking" in guide  # carries no note, and is offered anyway
    assert [key for key in PUBLIC_VIZ_OPTIONS["CHART"] if key not in guide] == []


def test_the_model_is_given_the_real_columns_and_its_answer_is_returned() -> None:
    llm = StubLlm({"options": {"columnMapping": {"bucket": "x", "bikes": "y"}}})

    options = author_options(
        llm,  # type: ignore[arg-type]
        viz_type="CHART",
        shape="chart-line",
        intent="bikes per hour",
        columns=(ResultColumn("bucket", "DateTime", "time"), ResultColumn("bikes", "Float64", "number")),
    )

    assert options == {"columnMapping": {"bucket": "x", "bikes": "y"}}
    assert "bucket" in llm.prompts[0]
    assert "chart-line" in llm.prompts[0]


def test_the_shape_is_not_the_models_to_change() -> None:
    llm = StubLlm({"options": {"globalSeriesType": "pie", "swappedAxes": True}})

    options = author_options(
        llm,  # type: ignore[arg-type]
        viz_type="CHART",
        shape="chart-line",
        intent="x",
        columns=(),
    )

    # The analyst was told "a line chart". The card must not draw a pie because
    # the option pass changed its mind.
    assert options == {"swappedAxes": True}


def test_a_provider_failure_is_no_options_rather_than_an_error() -> None:
    llm = StubLlm(RuntimeError("provider is down"))

    options = author_options(
        llm,  # type: ignore[arg-type]
        viz_type="CHART",
        shape="chart-line",
        intent="x",
        columns=(),
    )

    assert options == {}

"""The shape the model asks for, and the guide it is asked from.

The clamp used to answer "table" for everything it did not recognize, which
covered a real invention ("chart-hologram") and a near miss ("bar") with the
same silence. A dashboard of tables looks identical either way, so these tests
pin the difference: an unambiguous synonym resolves, an invention still clamps,
and only the invention is logged.
"""

import logging

import pytest

from veodyn_api.services.ai_converse_prompt import KPI_SOURCE_VIZ, system_prompt
from veodyn_api.services.ai_viz_choice import _ALIASES, CHOICE_IDS, CHOICE_TYPE, VIZ_RULES, viz_choice


@pytest.mark.parametrize(
    ("said", "expected"),
    [
        ("chart-bar", "chart-bar"),
        ("table", "table"),
        ("bar", "chart-bar"),
        ("Bar Chart", "chart-bar"),
        ("chart_bar", "chart-bar"),
        ("  CHART-LINE  ", "chart-line"),
        ("time series", "chart-line"),
        ("big number", "counter"),
        ("heat map", "heatmap"),
        ("matrix", "heatmap"),
        ("scatterplot", "chart-scatter"),
    ],
)
def test_a_shape_the_model_names_in_its_own_words_still_resolves(said: str, expected: str) -> None:
    assert viz_choice(said) == expected


@pytest.mark.parametrize("said", ["chart-hologram", "sunburst", "", "   ", None, 7, {"id": "chart-bar"}])
def test_anything_that_is_not_a_shape_this_build_offers_becomes_the_table(said: object) -> None:
    """Clamped, never invented. A shape is cosmetic; the analyst edits the card."""
    assert viz_choice(said) == "table"


def test_an_unrecognized_shape_is_logged_so_the_clamp_is_visible(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger="veodyn_api.services.ai_viz_choice"):
        viz_choice("chart-hologram")

    assert "chart-hologram" in caplog.text


def test_a_turn_that_named_no_shape_at_all_is_not_logged(caplog: pytest.LogCaptureFixture) -> None:
    """Absence is not a mistake: the field is optional, and warning about every
    turn that leaves it out is how a log stops being read."""
    with caplog.at_level(logging.WARNING, logger="veodyn_api.services.ai_viz_choice"):
        viz_choice(None)

    assert caplog.text == ""


def test_every_alias_lands_on_a_shape_this_build_offers() -> None:
    """An alias pointing at an id viz-choices.ts does not have would resolve
    here and then fall back to the table on the frontend, which is the silence
    this module exists to end."""
    unknown = {target for target in _ALIASES.values() if target not in CHOICE_IDS}

    assert unknown == set()


def test_every_shape_this_build_offers_has_a_redash_type() -> None:
    """A shape added to one list and not the other resolves to TABLE, and a
    counter drawn as a grid of one cell is the same unfalsifiable silence: the
    card renders, so nothing anywhere says the option pass asked for the wrong
    type's options."""
    assert set(CHOICE_TYPE) == set(CHOICE_IDS)


def test_the_guide_covers_every_shape_and_invents_none() -> None:
    """Both directions. A shape missing from the guide is one the model has no
    reason to pick; a shape in the guide that the frontend does not offer is one
    it will pick and not get."""
    documented = {choice for choice in CHOICE_IDS if f"`{choice}`" in VIZ_RULES}

    assert documented == set(CHOICE_IDS)


@pytest.mark.parametrize("kind", ["query", "dashboard", "report"])
def test_the_kinds_that_carry_a_shape_are_sent_the_guide(kind: str) -> None:
    """A report is here because a section it writes a query for becomes a chart
    block, so the shape is a real choice with a wrong answer."""
    assert "vizChoiceId" in system_prompt(kind)  # type: ignore[arg-type]
    assert "`heatmap`" in system_prompt(kind)  # type: ignore[arg-type]


@pytest.mark.parametrize("kind", ["kpi", "snippet"])
def test_a_kind_that_chooses_no_shape_is_not_sent_the_guide(kind: str) -> None:
    """Prompt budget the transcript needs.

    A snippet draws nothing. A KPI now writes its own source query, but the shape
    is fixed by the kind (KPI_SOURCE_VIZ): the sparkline and history read a series,
    so there is one right answer and no question to ask.
    """
    assert "`heatmap`" not in system_prompt(kind)  # type: ignore[arg-type]


def test_a_kpis_written_source_query_is_a_series() -> None:
    """The shape the KPI path passes to the generator instead of asking for one.

    Read from CHOICE_IDS rather than compared to the literal "chart-line", so a
    build that dropped or renamed the line shape fails here instead of silently
    falling back to a table on every KPI the AI writes a query for.
    """
    assert KPI_SOURCE_VIZ in CHOICE_IDS
    assert viz_choice(KPI_SOURCE_VIZ) == KPI_SOURCE_VIZ

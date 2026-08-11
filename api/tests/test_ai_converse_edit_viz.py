"""Changing what a widget is DRAWN as, which an edit could not ask for.

The gap this closes was not a bug in one function. A dashboard edit could name
which queries the dashboard should end up with and nothing about how they are
shown, so "turn these tables into charts" was a request the model answered in
prose while the answer carried nothing but the same query ids. The card diffed
those ids, found them identical, and correctly reported "No change to this
dashboard" under a paragraph promising six changes.

Four things had to be true at once, and there is a test here for each: the model
is TOLD what each widget is drawn as, it can SAY what a widget should become for
a query that already exists, a shape the query already has resolves to that
visualization, and one it does not have comes back for the client to create.
"""

from typing import Any, cast

from tests.converse_stubs import QUERIES, FakeChatLlm, answer, ask, viz
from veodyn_api.schemas.ai_create import ConverseIn, ConverseMessageIn, DashboardProposalOut
from veodyn_api.services.ai_converse_grounding import Grounding
from veodyn_api.services.ai_grounding import DashboardWidget, QueryVisualization

# Query 11 is drawn as a table today, query 12 as a counter.
CURRENT = (
    DashboardWidget(widget_id=501, query_id=11, query_name="Speeds by corridor", viz_id=90, viz_type="TABLE"),
    DashboardWidget(widget_id=502, query_id=12, query_name="Boardings by stop", viz_id=91, viz_type="COUNTER"),
)

# What each query HAS. Query 11 has only its table, so a chart for it has to be
# created; query 12 already has a bar chart nobody put on the dashboard.
HAS: dict[int, tuple[QueryVisualization, ...]] = {
    11: (viz(90, "TABLE"),),
    12: (viz(91, "COUNTER"), viz(92, "CHART", globalSeriesType="bar")),
}


def edit_turn(text: str = "turn the tables into charts") -> ConverseIn:
    return ConverseIn(
        kind="dashboard",
        messages=[ConverseMessageIn(role="user", content=text)],
        target_dashboard_id=7,
    )


def widgets_of(result: Any) -> list[Any]:
    return list(cast(DashboardProposalOut, result.proposal).widgets)


def run(llm: FakeChatLlm) -> Any:
    return ask(
        llm,
        edit_turn(),
        Grounding("dashboard", queries=QUERIES),
        resolve_visualization=lambda query_id: HAS.get(query_id, ()),
        editing=CURRENT,
    )


def test_the_model_is_told_what_each_widget_is_drawn_as() -> None:
    """Without this it asks the analyst which widgets are tables, which is a
    question the dashboard it was handed already answers."""
    llm = FakeChatLlm(answer(ready=False))

    run(llm)

    system = llm.systems[-1]
    assert '"shownAs":"table"' in system.replace(" ", "")
    assert '"shownAs":"counter"' in system.replace(" ", "")


def test_a_chart_is_described_by_its_shape_and_not_just_as_a_chart() -> None:
    """CHART is five shapes told apart by `globalSeriesType`.

    Reporting the type alone describes every existing chart as a line chart, so
    "change the line charts and leave the bars alone" rewrites the bars. TABLE
    and COUNTER cannot catch this: they are one shape each, so a version that
    ignores the options entirely passes a test built only from those.
    """
    charted = (
        DashboardWidget(
            widget_id=505,
            query_id=11,
            query_name="Speeds by corridor",
            viz_id=93,
            viz_type="CHART",
            viz_options={"globalSeriesType": "bar"},
        ),
    )
    llm = FakeChatLlm(answer(ready=False))

    ask(
        llm,
        edit_turn(),
        Grounding("dashboard", queries=QUERIES),
        resolve_visualization=lambda query_id: HAS.get(query_id, ()),
        editing=charted,
    )

    system = llm.systems[-1].replace(" ", "")
    assert '"shownAs":"chart-bar"' in system
    assert '"shownAs":"chart-line"' not in system


def test_the_model_is_told_how_to_ask_for_a_different_shape() -> None:
    llm = FakeChatLlm(answer(ready=False))

    run(llm)

    assert "set `vizChoiceId` to the shape it should become" in llm.systems[-1]


def test_a_shape_the_query_already_has_resolves_to_that_visualization() -> None:
    # Query 12 has a bar chart already, so this changes the dashboard without
    # writing anything at all to the saved query.
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 12, "vizChoiceId": "chart-bar"}]))

    widgets = widgets_of(run(llm))

    assert (widgets[0].visualization_id, widgets[0].viz_choice_id) == (92, "chart-bar")


def test_a_shape_the_query_does_not_have_comes_back_for_the_client_to_create() -> None:
    # Query 11 has only its table. A null id beside a shape is the instruction to
    # create one, and the client forks the query first if the reader is not its
    # owner.
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 11, "vizChoiceId": "chart-line"}]))

    widgets = widgets_of(run(llm))

    assert (widgets[0].visualization_id, widgets[0].viz_choice_id) == (None, "chart-line")


def test_a_widget_nobody_asked_to_change_keeps_the_one_it_is_drawn_with() -> None:
    """Not the query's default. Query 12 has a bar chart the dashboard does not
    use, and re-resolving would silently swap the counter for it: an edit that
    was asked to change nothing would arrive proposing a different picture."""
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 12}]))

    widgets = widgets_of(run(llm))

    assert (widgets[0].visualization_id, widgets[0].viz_choice_id) == (91, "counter")


def test_a_shape_that_is_not_one_this_build_offers_falls_back_rather_than_failing() -> None:
    """viz_choice clamps to the table. The worst case stays a table where a
    chart was wanted, in a card the analyst reads before applying it."""
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 11, "vizChoiceId": "chart-hologram"}]))

    widgets = widgets_of(run(llm))

    assert widgets[0].viz_choice_id == "table"
    assert widgets[0].visualization_id == 90


def test_a_widget_that_cannot_be_resolved_does_not_take_the_others_with_it() -> None:
    """The whole of bug 2 in one assertion. One widget the model named badly used
    to cost the analyst every widget it named well."""
    llm = FakeChatLlm(
        answer(
            name="Transit",
            widgets=[{"queryId": 12, "vizChoiceId": "chart-bar"}, {"queryId": 4242}],
        )
    )

    result = run(llm)

    assert result.ready is True
    assert 12 in [one.query_id for one in widgets_of(result)]
    # Named, not swallowed: a card showing one widget under a sentence promising
    # two reads as the card being wrong.
    assert "4242" in result.reply


def test_a_partial_answer_removes_nothing() -> None:
    """The hazard the partial answer created, and the reason it is bounded.

    The client reads the widget list as the dashboard's END STATE and deletes
    anything missing from it. A model that garbled query 11 into query 4242
    would therefore have the widget for 11 deleted on its behalf, which is the
    opposite of what dropping a row is supposed to cost. So a partial answer
    carries every widget still on the dashboard, drawn as it is drawn now.
    """
    llm = FakeChatLlm(
        answer(
            name="Transit",
            widgets=[{"queryId": 12, "vizChoiceId": "chart-bar"}, {"queryId": 4242}],
        )
    )

    widgets = widgets_of(run(llm))

    # Query 11 is on the dashboard and the model never named it. It is here, as
    # its own table, so the diff reads it as kept rather than as a removal.
    assert sorted(one.query_id for one in widgets) == [11, 12]
    kept = next(one for one in widgets if one.query_id == 11)
    assert (kept.visualization_id, kept.viz_choice_id) == (90, "table")


def test_a_partial_answer_says_it_held_the_removals_back() -> None:
    """The cost of the rule above, stated rather than hidden.

    A reader who asked for a widget to go and had an unrelated row fail gets it
    kept. The model's own reply may well say it is gone, so the turn has to say
    otherwise in the same breath, or the card silently disagrees with the words
    above it.
    """
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 12}, {"queryId": 4242}]))

    reply = run(llm).reply

    assert "4242" in reply
    assert "left every widget already on the dashboard in place" in reply


def test_a_complete_answer_says_nothing_about_holding_removals_back() -> None:
    # The sentence is only true of a partial answer. On a clean one it would
    # describe a restraint that did not happen.
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 12}]))

    assert "left every widget already" not in run(llm).reply


def test_a_complete_answer_still_removes_what_it_leaves_out() -> None:
    """The other half, or the rule above would make removal impossible.

    Nothing was dropped here, so the list IS the whole answer and a widget left
    out of it is the model doing what EDIT_RULES asked of it.
    """
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 12}]))

    widgets = widgets_of(run(llm))

    assert [one.query_id for one in widgets] == [12]

"""The Create-with-AI interview: the model writes words, this code assigns ids.

Every test here is the same assertion from a different angle. Nothing the model
says about WHICH query, table or visualization backs a proposal is trusted, and
a pick that does not survive the lookup costs the analyst a turn rather than
handing them a card that points at nothing.

The pairs matter. "an ungrounded id degrades the turn" is passed by an
implementation that degrades every turn, so each degrade test has a sibling
proving the grounded version really does come back ready.

The route, the caps and the grounding cache are in test_ai_converse_route.py.
The words beside the proposal, and the recovery when a turn comes back without
any, are in test_ai_converse_reply.py; the widgets a dashboard turn asks the
service to write are in test_ai_converse_written.py.
"""

from collections.abc import Iterator
from typing import cast

import pytest

from tests.converse_stubs import QUERIES, SPEEDS, FakeChatLlm, answer, ask, resolves_to, turn, viz
from veodyn_api.schemas.ai_create import DashboardProposalOut, QueryProposalOut
from veodyn_api.services.ai_converse_grounding import Grounding, clear_grounding_cache
from veodyn_api.services.ai_grounding import QueryVisualization


@pytest.fixture(autouse=True)
def _clear_grounding() -> Iterator[None]:
    """conftest resets the digest cache around every test; this is the same job
    for the grounding one, which is likewise process-wide."""
    clear_grounding_cache()
    yield
    clear_grounding_cache()


# --- ids the model named, checked against the grounding ---------------------


def test_an_ungrounded_query_id_is_dropped_rather_than_proposed() -> None:
    """The load-bearing test. A widget id the model was never given must not
    reach the card, because the browser posts it straight to Redash on Create.

    What gets dropped is the WIDGET, not the turn. The grounded widget beside it
    is still offered and the reply names what went missing, which is why `ready`
    reads True here. The assertion that must never weaken is the last one: 4242
    appears nowhere a client would read as an id, and the turn being ready does
    not change that.
    """
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 11}, {"queryId": 4242}]))

    result = ask(
        llm, turn("dashboard"), Grounding("dashboard", queries=QUERIES), resolve_visualization=resolves_to(99)
    )

    assert result.ready is True
    assert [one.query_id for one in cast(DashboardProposalOut, result.proposal).widgets] == [11]
    assert "4242" in result.reply
    assert "4242" not in result.model_dump_json(exclude={"reply"})


def test_a_grounded_dashboard_comes_back_ready_with_a_visualization_per_widget() -> None:
    """The sibling of the test above. Without it, an implementation that
    degrades every single turn would look correct."""
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 11, "title": "Speeds"}]))

    result = ask(
        llm, turn("dashboard"), Grounding("dashboard", queries=QUERIES), resolve_visualization=resolves_to(99)
    )

    assert result.ready is True
    assert result.proposal is not None
    assert result.proposal.model_dump(by_alias=True) == {
        "kind": "dashboard",
        "name": "Transit",
        # newQuery is null on a widget assembled from what exists. The field is
        # always present rather than omitted, so the client reads one shape.
        "widgets": [
            {
                "queryId": 11,
                "visualizationId": 99,
                "vizChoiceId": "counter",
                "title": "Speeds",
                "newQuery": None,
            }
        ],
    }


def test_only_the_picked_queries_are_looked_up() -> None:
    """Sixty HTTP calls per ready turn to resolve the one id that was named is
    the cost this rule exists to avoid."""
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 12, "title": "Boardings"}]))
    looked_up: list[int] = []

    def resolve(query_id: int) -> tuple[QueryVisualization, ...]:
        looked_up.append(query_id)
        return (viz(99),)

    ask(llm, turn("dashboard"), Grounding("dashboard", queries=QUERIES), resolve_visualization=resolve)

    assert looked_up == [12]


def test_a_widget_whose_visualization_will_not_resolve_degrades_the_turn() -> None:
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 11, "title": "Speeds"}]))

    result = ask(llm, turn("dashboard"), Grounding("dashboard", queries=QUERIES), resolve_visualization=lambda _: ())

    assert result.ready is False
    assert "Speeds by corridor" in result.reply


def test_an_ungrounded_kpi_source_degrades_the_turn() -> None:
    llm = FakeChatLlm(answer(name="On time", queryId=4242, valueColumn="pct"))

    result = ask(llm, turn("kpi"), Grounding("kpi", queries=QUERIES))

    assert (result.ready, result.proposal) == (False, None)
    assert "4242" in result.reply


def test_a_grounded_kpi_keeps_the_column_the_model_named() -> None:
    """valueColumn is NOT checkable without running the query, which this
    service will not do, so it passes through as a plain string. The id beside
    it does not get the same treatment."""
    llm = FakeChatLlm(answer(name="On time", queryId=11, valueColumn="pct_on_time", cadence="weekly", target=95))

    result = ask(llm, turn("kpi"), Grounding("kpi", queries=QUERIES))

    assert result.proposal is not None
    fields = result.proposal.model_dump()
    assert (fields["value_column"], fields["source_query_id"], fields["cadence"]) == ("pct_on_time", 11, "weekly")
    assert fields["target"] == 95.0


def test_a_kpi_cadence_outside_the_closed_list_falls_back_to_daily() -> None:
    llm = FakeChatLlm(answer(name="On time", queryId=11, valueColumn="pct", cadence="fortnightly"))

    result = ask(llm, turn("kpi"), Grounding("kpi", queries=QUERIES))

    assert result.proposal is not None
    assert result.proposal.model_dump()["cadence"] == "daily"


def test_a_report_section_may_name_no_query_at_all() -> None:
    """0 is the model saying "nothing in the list fits", which is a valid
    narrative-only section rather than an invented id."""
    outline = {"goal": "How is transit doing?", "sections": [{"title": "Caveats", "intent": "x", "queryId": 0}]}
    llm = FakeChatLlm(answer(outline=outline))

    result = ask(llm, turn("report"), Grounding("report", queries=QUERIES))

    assert result.ready is True
    assert result.proposal is not None
    assert result.proposal.model_dump()["outline"]["sections"][0]["source_query_id"] is None


def test_a_report_section_naming_an_invented_query_degrades_the_turn() -> None:
    outline = {"goal": "g", "sections": [{"title": "Ghost", "intent": "x", "queryId": 4242}]}
    llm = FakeChatLlm(answer(outline=outline))

    result = ask(llm, turn("report"), Grounding("report", queries=QUERIES))

    assert (result.ready, result.proposal) == (False, None)
    assert "4242" in result.reply


# --- the SQL path -----------------------------------------------------------


def query_grounding() -> Grounding:
    return Grounding("query", datasets=(SPEEDS,))


def test_a_ready_query_turn_ships_the_sql_the_validator_passed() -> None:
    llm = FakeChatLlm(
        answer(name="Speeds", datasetTable="regional_speeds", intent="average speed", vizChoiceId="chart-line"),
        {"sql": "SELECT avg(speed_mph) FROM regional_speeds", "rationale": "averages the speed"},
    )

    result = ask(llm, turn("query"), query_grounding())

    assert result.ready is True
    assert isinstance(result.proposal, QueryProposalOut)
    assert result.proposal.sql == "SELECT avg(speed_mph) FROM regional_speeds"
    assert result.proposal.viz_choice_id == "chart-line"
    assert result.proposal.dataset_table == "regional_speeds"


def test_sql_that_fails_the_safety_check_is_refused_after_its_one_retry() -> None:
    """generate_sql retries once with the reason and then gives up. The turn
    degrades rather than shipping a statement the validator rejected, and rather
    than 502-ing a conversation the analyst could still steer."""
    dropped = {"sql": "DROP TABLE regional_speeds", "rationale": "removes it"}
    proposed = answer(name="Speeds", datasetTable="regional_speeds", intent="remove the table")
    llm = FakeChatLlm(proposed, dropped, dropped)

    result = ask(llm, turn("query"), query_grounding())

    assert (result.ready, result.proposal) == (False, None)
    assert "regional_speeds" in result.reply
    # One converse call plus exactly two SQL attempts: the retry happened, and
    # it happened once.
    assert llm.calls == 3


def test_sql_reading_a_table_nobody_asked_about_is_refused() -> None:
    """The refusal that matters most: the SQL is one click from running under
    the analyst's own Redash credential."""
    leak = {"sql": "SELECT * FROM historical.other_table", "rationale": "reads elsewhere"}
    llm = FakeChatLlm(answer(name="Speeds", datasetTable="regional_speeds", intent="average speed"), leak, leak)

    result = ask(llm, turn("query"), query_grounding())

    assert (result.ready, result.proposal) == (False, None)


def test_an_ungrounded_table_never_reaches_the_sql_generator() -> None:
    llm = FakeChatLlm(answer(name="X", datasetTable="not_a_table", intent="anything"))

    result = ask(llm, turn("query"), query_grounding())

    assert (result.ready, result.proposal) == (False, None)
    assert "not_a_table" in result.reply
    assert llm.calls == 1


def test_a_viz_choice_outside_the_closed_list_falls_back_to_the_table() -> None:
    """The closed list is viz-choices.ts. A shape this build does not offer is a
    cosmetic pick to clamp, not an id to invent."""
    llm = FakeChatLlm(
        answer(name="Speeds", datasetTable="regional_speeds", intent="average speed", vizChoiceId="chart-hologram"),
        {"sql": "SELECT avg(speed_mph) FROM regional_speeds", "rationale": "r"},
    )

    result = ask(llm, turn("query"), query_grounding())

    assert isinstance(result.proposal, QueryProposalOut)
    assert result.proposal.viz_choice_id == "table"


def test_a_shape_named_in_the_models_own_words_is_not_clamped_to_the_table() -> None:
    """The other half of the pair above, and the case that was costing real
    dashboards their charts: "bar" is not an id this build offers, and it is also
    not something anybody could mean anything else by. The per-word rules are in
    test_ai_viz_choice.py; this proves the turn carries the resolved shape."""
    llm = FakeChatLlm(
        answer(name="Speeds", datasetTable="regional_speeds", intent="average speed by corridor", vizChoiceId="bar"),
        {"sql": "SELECT corridor, avg(speed_mph) FROM regional_speeds GROUP BY corridor", "rationale": "r"},
    )

    result = ask(llm, turn("query"), query_grounding())

    assert isinstance(result.proposal, QueryProposalOut)
    assert result.proposal.viz_choice_id == "chart-bar"

"""A KPI conversation that writes the query it needs.

The gap these close was reported by a user. Asked to propose bikeshare KPIs, the
model answered "I can still only back this KPI proposal with one of the existing
queries listed (I can't author brand-new SQL myself in this flow)", and repeated
the refusal when told it could create queries. It was describing its own schema
accurately: the KPI proposal had a `queryId` and nothing else.

Sibling of test_ai_converse_written.py, which holds the dashboard's version of
the same capability.
"""

from collections.abc import Iterator
from typing import Any, cast

import pytest
from pydantic import ValidationError

from tests.converse_stubs import QUERIES, SPEEDS, FakeChatLlm, answer, ask, turn
from veodyn_api.schemas.ai import NewQueryProposalOut
from veodyn_api.schemas.ai_create import KpiProposalOut
from veodyn_api.services.ai_converse_grounding import Grounding, clear_grounding_cache
from veodyn_api.services.ai_converse_prompt import KPI_SOURCE_VIZ

GENERATED_SQL = (
    "SELECT toStartOfHour(captured_at) AS hour, avg(speed_mph) AS avg_speed FROM regional_speeds GROUP BY hour"
)
GENERATED = {"sql": GENERATED_SQL, "rationale": "Average speed per hour."}

KPI_GROUNDING = Grounding("kpi", queries=QUERIES, datasets=(SPEEDS,))


@pytest.fixture(autouse=True)
def _clear_grounding() -> Iterator[None]:
    clear_grounding_cache()
    yield
    clear_grounding_cache()


def test_a_kpi_with_no_query_id_is_written_from_the_catalog() -> None:
    """The refusal, gone. A KPI naming a table and an intent instead of an id gets
    its source query written by the same generator the query conversation uses."""
    llm = FakeChatLlm(
        answer(
            name="Average corridor speed",
            datasetTable="regional_speeds",
            intent="average speed per hour",
            valueColumn="avg_speed",
            target=25,
        ),
        GENERATED,
    )

    result = ask(llm, turn("kpi"), KPI_GROUNDING)

    assert result.ready is True
    proposal = cast(KpiProposalOut, result.proposal)
    assert proposal.source_query_id is None
    assert proposal.new_query is not None
    assert proposal.new_query.sql == GENERATED_SQL
    assert proposal.new_query.dataset_table == "regional_speeds"
    assert proposal.value_column == "avg_speed"
    assert proposal.target == 25


def test_a_written_kpi_source_is_drawn_as_a_series() -> None:
    """The KPI kind is not sent the shape guide, so the model never chose a shape.

    Compared against KPI_SOURCE_VIZ rather than the literal, so this test says
    "whatever the KPI path decided" and cannot pass while the path silently falls
    back to a table, which is what an unset vizChoiceId resolves to.
    """
    llm = FakeChatLlm(
        answer(datasetTable="regional_speeds", intent="average speed per hour", valueColumn="avg_speed", target=25),
        GENERATED,
    )

    result = ask(llm, turn("kpi"), KPI_GROUNDING)

    assert cast(KpiProposalOut, result.proposal).new_query.viz_choice_id == KPI_SOURCE_VIZ  # type: ignore[union-attr]


def test_a_shape_the_model_volunteers_for_a_kpi_is_ignored() -> None:
    """It was not asked, so an answer it invents is not a preference to honour.

    Without this the one field the KPI interview deliberately does not explain is
    the one field the model gets to set, and a KPI whose sparkline reads a pie
    chart is the result.
    """
    llm = FakeChatLlm(
        answer(
            datasetTable="regional_speeds",
            intent="average speed per hour",
            valueColumn="avg_speed",
            target=25,
            vizChoiceId="chart-pie",
        ),
        GENERATED,
    )

    result = ask(llm, turn("kpi"), KPI_GROUNDING)

    assert cast(KpiProposalOut, result.proposal).new_query.viz_choice_id == KPI_SOURCE_VIZ  # type: ignore[union-attr]


def test_an_existing_query_is_still_preferred_when_the_model_names_one() -> None:
    """Naming a real id must not start a generation. The written path is the
    fallback for an instance that has nothing that fits, not the new default."""
    llm = FakeChatLlm(answer(name="Speeds", queryId=11, valueColumn="speed_mph", target=25))

    result = ask(llm, turn("kpi"), KPI_GROUNDING)

    proposal = cast(KpiProposalOut, result.proposal)
    assert (proposal.source_query_id, proposal.new_query) == (11, None)
    # One call: the conversation turn. A second would be a generate_sql nobody
    # asked for, and the analyst would wait for SQL that is then thrown away.
    assert llm.calls == 1


def test_a_kpi_naming_a_query_id_it_was_not_given_is_still_refused() -> None:
    """An invented id is an invention, not a request to write something instead.

    Silently writing a query here would take the one case the grounding rule
    exists to catch and turn it into a plausible proposal.
    """
    llm = FakeChatLlm(answer(name="Ghost", queryId=999, valueColumn="speed_mph", target=25))

    result = ask(llm, turn("kpi"), KPI_GROUNDING)

    assert (result.ready, result.proposal) == (False, None)
    assert "999" in result.reply
    assert llm.calls == 1


def test_a_written_kpi_still_has_to_name_a_real_table() -> None:
    """The safety rule is unchanged: a table the instance does not have degrades
    the turn rather than being queried."""
    llm = FakeChatLlm(answer(name="Invented", datasetTable="not_a_table", intent="x", valueColumn="y", target=1))

    result = ask(llm, turn("kpi"), KPI_GROUNDING)

    assert (result.ready, result.proposal) == (False, None)
    assert "not_a_table" in result.reply


def test_a_kpi_naming_neither_a_query_nor_a_table_asks_for_both() -> None:
    """Either half is an answer the analyst can give, so the degraded turn has to
    offer both rather than the one the old code happened to check first."""
    llm = FakeChatLlm(answer(name="Vague", valueColumn="speed_mph", target=25))

    result = ask(llm, turn("kpi"), KPI_GROUNDING)

    assert (result.ready, result.proposal) == (False, None)
    assert "table" in result.reply
    assert "query" in result.reply


def test_a_kpi_carrying_both_sources_is_unrepresentable() -> None:
    """The card would create one query and read the number from another.

    Checked on the model rather than through a conversation, because the builder
    is what stops it happening: this is the guard that catches a future caller
    that gets the branch wrong.
    """
    fields: dict[str, Any] = {
        "name": "Both",
        "description": "",
        "value_column": "v",
        "unit": None,
        "target": 1.0,
        "direction": "higher-is-better",
        "cadence": "daily",
        "at_risk": None,
        "breached": None,
    }
    new_query = NewQueryProposalOut(
        name="n",
        description="",
        sql="SELECT 1",
        dataset_table="regional_speeds",
        viz_choice_id=KPI_SOURCE_VIZ,
        viz_options={},
    )

    with pytest.raises(ValidationError):
        KpiProposalOut(source_query_id=11, new_query=new_query, **fields)
    with pytest.raises(ValidationError):
        KpiProposalOut(source_query_id=None, new_query=None, **fields)


def test_a_named_band_reaches_the_proposal() -> None:
    """The instruction that used to have nowhere to land.

    An analyst who said "at risk below 80" was agreed with in conversation and
    then handed a KPI at risk at 100 and breached at 90, because the bands are
    derived from the target and the schema had no field for the request.
    """
    llm = FakeChatLlm(
        answer(
            name="On-time rate",
            queryId=11,
            valueColumn="speed_mph",
            target=95,
            atRisk=80,
            breached=60,
        )
    )

    proposal = cast(KpiProposalOut, ask(llm, turn("kpi"), KPI_GROUNDING).proposal)

    assert proposal.at_risk == 80
    assert proposal.breached == 60


def test_no_band_named_leaves_the_target_to_derive_them() -> None:
    """The ordinary case, and the one that must not change."""
    llm = FakeChatLlm(answer(name="On-time rate", queryId=11, valueColumn="speed_mph", target=95))

    proposal = cast(KpiProposalOut, ask(llm, turn("kpi"), KPI_GROUNDING).proposal)

    assert proposal.at_risk is None
    assert proposal.breached is None


def test_half_a_band_is_no_band() -> None:
    """One bound alone has no band to be one end of, so both go back to derived."""
    llm = FakeChatLlm(answer(name="On-time rate", queryId=11, valueColumn="speed_mph", target=95, atRisk=80))

    proposal = cast(KpiProposalOut, ask(llm, turn("kpi"), KPI_GROUNDING).proposal)

    assert proposal.at_risk is None
    assert proposal.breached is None


def test_bands_that_would_erase_a_band_are_dropped_rather_than_stored() -> None:
    """Breached above at-risk on a higher-is-better KPI makes at-risk unreachable.

    `statusForValue` reads the two in direction order, so every value under the
    breached bound is already breached and the at-risk band can never be
    reported. Dropped to null rather than raised: the card can still derive, and
    losing the whole proposal over this would cost the analyst the conversation.
    """
    llm = FakeChatLlm(
        answer(
            name="On-time rate",
            queryId=11,
            valueColumn="speed_mph",
            target=95,
            atRisk=60,
            breached=80,
        )
    )

    proposal = cast(KpiProposalOut, ask(llm, turn("kpi"), KPI_GROUNDING).proposal)

    assert proposal.at_risk is None
    assert proposal.breached is None


def test_a_lower_is_better_band_reads_the_other_way_round() -> None:
    """Worse is larger, so the breached bound sits ABOVE the at-risk one."""
    llm = FakeChatLlm(
        answer(
            name="Mean wait",
            queryId=11,
            valueColumn="speed_mph",
            target=4,
            direction="lower-is-better",
            atRisk=6,
            breached=9,
        )
    )

    proposal = cast(KpiProposalOut, ask(llm, turn("kpi"), KPI_GROUNDING).proposal)

    assert proposal.at_risk == 6
    assert proposal.breached == 9


def test_a_band_of_zero_is_a_band() -> None:
    """Zero dropped feeds is a real bound here, and a truthiness check loses it."""
    llm = FakeChatLlm(
        answer(
            name="Dropped feeds",
            queryId=11,
            valueColumn="speed_mph",
            target=0,
            direction="lower-is-better",
            atRisk=0,
            breached=1,
        )
    )

    proposal = cast(KpiProposalOut, ask(llm, turn("kpi"), KPI_GROUNDING).proposal)

    assert proposal.at_risk == 0
    assert proposal.breached == 1

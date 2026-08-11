"""A report conversation that writes the queries its sections need.

The gap these close was documented and not built. `OUTLINE_SYSTEM` told the model
"a section with no query becomes prose", and ai-report.ts described the same field
as "a reused query, or null = the AI will generate one". Nothing generated one, so
a report about something the instance had no query for was a report with no data
in it.

Sibling of test_ai_converse_written.py (dashboards) and
test_ai_converse_written_kpi.py (KPIs).
"""

from collections.abc import Iterator
from typing import Any, cast

import pytest
from pydantic import ValidationError

from tests.converse_stubs import QUERIES, SPEEDS, FakeChatLlm, answer, ask, turn
from veodyn_api.schemas.ai import NewQueryProposalOut, OutlineSectionOut
from veodyn_api.schemas.ai_create import ReportProposalOut
from veodyn_api.services.ai_converse_grounding import Grounding, clear_grounding_cache
from veodyn_api.services.ai_converse_prompt import MAX_NEW_QUERIES_PER_REPORT

GENERATED = {"sql": "SELECT captured_at, speed_mph FROM regional_speeds", "rationale": "Speeds over time."}

REPORT_GROUNDING = Grounding("report", queries=QUERIES, datasets=(SPEEDS,))


@pytest.fixture(autouse=True)
def _clear_grounding() -> Iterator[None]:
    clear_grounding_cache()
    yield
    clear_grounding_cache()


def section(**fields: Any) -> dict[str, Any]:
    return {"title": "A section", "intent": "what it shows", "suggested": False, **fields}


def outline(*sections: dict[str, Any]) -> dict[str, Any]:
    return {"goal": "Weekly review", "sections": list(sections)}


def sections_of(result: Any) -> list[OutlineSectionOut]:
    return cast(ReportProposalOut, result.proposal).outline.sections


def test_a_section_with_no_query_id_is_written_from_the_catalog() -> None:
    """A section that needs a number nothing produces gets the query written for
    it, rather than quietly becoming prose."""
    llm = FakeChatLlm(
        answer(outline=outline(section(title="Speeds", datasetTable="regional_speeds", intent="speed over time"))),
        GENERATED,
    )

    result = ask(llm, turn("report"), REPORT_GROUNDING)

    assert result.ready is True
    written = sections_of(result)[0]
    assert written.source_query_id is None
    assert written.new_query is not None
    assert written.new_query.sql == GENERATED["sql"]


def test_a_report_mixes_an_existing_query_a_written_one_and_prose() -> None:
    """All three at once, which is the shape a real outline has. Prose stays
    valid: a caveats section is not a section anybody wants a chart in."""
    llm = FakeChatLlm(
        answer(
            outline=outline(
                section(title="Headline", queryId=11),
                section(title="New angle", datasetTable="regional_speeds", intent="speed by corridor"),
                section(title="Caveats"),
            )
        ),
        GENERATED,
    )

    result = ask(llm, turn("report"), REPORT_GROUNDING)

    written = sections_of(result)
    assert [one.source_query_id for one in written] == [11, None, None]
    assert [one.new_query is None for one in written] == [True, False, True]
    # Ids stay positional and gapless over the surviving sections, because the
    # frontend matches a drafted narrative back to its section by this id.
    assert [one.id for one in written] == ["section-1", "section-2", "section-3"]


def test_a_section_naming_query_zero_and_a_table_is_written() -> None:
    """Zero is the schema's "nothing in the list fits", which is exactly the
    section that wants a query written. Treating it as a named id would refuse
    the most likely way the model asks for one."""
    llm = FakeChatLlm(
        answer(outline=outline(section(queryId=0, datasetTable="regional_speeds", intent="speed over time"))),
        GENERATED,
    )

    result = ask(llm, turn("report"), REPORT_GROUNDING)

    assert sections_of(result)[0].new_query is not None


def test_a_section_naming_a_query_id_it_was_not_given_is_still_refused() -> None:
    """Unchanged by any of this, and not softened into "write one instead"."""
    llm = FakeChatLlm(answer(outline=outline(section(queryId=999))))

    result = ask(llm, turn("report"), REPORT_GROUNDING)

    assert (result.ready, result.proposal) == (False, None)
    assert "999" in result.reply


def test_a_written_section_still_has_to_name_a_real_table() -> None:
    llm = FakeChatLlm(answer(outline=outline(section(datasetTable="not_a_table", intent="anything"))))

    result = ask(llm, turn("report"), REPORT_GROUNDING)

    assert (result.ready, result.proposal) == (False, None)
    assert "not_a_table" in result.reply


def test_a_report_will_not_write_more_queries_than_the_cap() -> None:
    """Same reason the dashboard is capped: each is a generation plus its safety
    check inside the turn the analyst is waiting on."""
    rows = [
        section(title=f"s{index}", datasetTable="regional_speeds", intent="speed over time")
        for index in range(MAX_NEW_QUERIES_PER_REPORT + 1)
    ]
    llm = FakeChatLlm(answer(outline=outline(*rows)), *([GENERATED] * len(rows)))

    result = ask(llm, turn("report"), REPORT_GROUNDING)

    assert (result.ready, result.proposal) == (False, None)
    assert str(MAX_NEW_QUERIES_PER_REPORT) in result.reply


def test_the_cap_counts_written_sections_and_not_existing_ones() -> None:
    """A report of mostly existing queries must not be refused for being long.

    The counter is incremented where the write happens, so a proposal with more
    than the cap in SECTIONS but at most the cap in written queries is fine.
    """
    rows = [section(title=f"e{index}", queryId=11) for index in range(6)]
    rows.append(section(title="written", datasetTable="regional_speeds", intent="speed over time"))
    llm = FakeChatLlm(answer(outline=outline(*rows)), GENERATED)

    result = ask(llm, turn("report"), REPORT_GROUNDING)

    assert result.ready is True
    assert len(sections_of(result)) == 7


def test_a_suggested_written_section_still_arrives_switched_off() -> None:
    """Writing the query does not promote an offer into part of the proposal.

    The card's Include switch is what turns it on, and a section that arrives
    enabled because it happened to need SQL is one the analyst never chose.
    """
    llm = FakeChatLlm(
        answer(
            outline=outline(
                section(title="Extra", datasetTable="regional_speeds", intent="speed over time", suggested=True)
            )
        ),
        GENERATED,
    )

    result = ask(llm, turn("report"), REPORT_GROUNDING)

    written = sections_of(result)[0]
    assert (written.suggested, written.enabled) == (True, False)
    assert written.new_query is not None


def test_a_section_carrying_both_sources_is_unrepresentable() -> None:
    """The card would create one query and draw a different one beside the words.

    Neither IS valid here, unlike a dashboard widget: a section with no source is
    prose, which is a section an outline is allowed to contain.
    """
    fields: dict[str, Any] = {"id": "section-1", "title": "t", "intent": "i", "suggested": False, "enabled": True}
    new_query = NewQueryProposalOut(
        name="n",
        description="",
        sql="SELECT 1",
        dataset_table="regional_speeds",
        viz_choice_id="chart-line",
        viz_options={},
    )

    OutlineSectionOut(source_query_id=None, new_query=None, **fields)
    with pytest.raises(ValidationError):
        OutlineSectionOut(source_query_id=11, new_query=new_query, **fields)

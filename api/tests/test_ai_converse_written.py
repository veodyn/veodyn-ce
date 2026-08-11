"""A dashboard conversation that writes the queries it needs.

Split out of test_ai_converse.py: those tests check the ids a model NAMED, and
these check the queries it asks the service to WRITE, which run the SQL
generator and its safety check inside the turn. Same grounding rule either way,
which is what the last two tests here hold.
"""

from collections.abc import Iterator
from typing import Any, cast

import pytest

from tests.converse_stubs import QUERIES, SPEEDS, FakeChatLlm, answer, ask, resolves_to, turn
from veodyn_api.services.ai_converse_grounding import Grounding, clear_grounding_cache
from veodyn_api.services.ai_converse_prompt import MAX_NEW_QUERIES_PER_DASHBOARD


@pytest.fixture(autouse=True)
def _clear_grounding() -> Iterator[None]:
    clear_grounding_cache()
    yield
    clear_grounding_cache()


def test_a_widget_with_no_query_id_is_written_from_the_catalog() -> None:
    """The gap this closes. A dashboard used to be assembled from what already
    existed, so the only answer to "build me one for X" when X had no query was
    to send the analyst away to write it. The widget now carries a table and an
    intent, and the SQL comes from the same generator the query conversation
    uses."""
    llm = FakeChatLlm(
        answer(
            name="Speeds",
            widgets=[{"title": "Corridor speeds", "datasetTable": "regional_speeds", "intent": "avg speed by hour"}],
        ),
        # The generate_sql call the widget triggers.
        {"sql": "SELECT captured_at, speed_mph FROM regional_speeds", "rationale": "Speeds over time."},
    )

    result = ask(llm, turn("dashboard"), Grounding("dashboard", queries=QUERIES, datasets=(SPEEDS,)))

    assert result.ready is True
    assert result.proposal is not None
    widget = cast(Any, result.proposal).widgets[0]
    assert widget.query_id is None
    assert widget.new_query is not None
    assert widget.new_query.sql == "SELECT captured_at, speed_mph FROM regional_speeds"
    assert widget.new_query.dataset_table == "regional_speeds"


def test_a_dashboard_mixes_an_existing_query_with_a_written_one() -> None:
    """Both kinds of widget in one proposal, which is the shape a real request
    produces: some of what you want is already there."""
    llm = FakeChatLlm(
        answer(
            name="Situational",
            widgets=[
                {"queryId": 11, "title": "Speeds"},
                {"title": "New angle", "datasetTable": "regional_speeds", "intent": "speed by corridor"},
            ],
        ),
        {"sql": "SELECT speed_mph FROM regional_speeds", "rationale": "Speeds."},
    )

    result = ask(
        llm,
        turn("dashboard"),
        Grounding("dashboard", queries=QUERIES, datasets=(SPEEDS,)),
        resolve_visualization=resolves_to(99),
    )

    widgets = cast(Any, result.proposal).widgets
    assert [w.query_id for w in widgets] == [11, None]
    assert [w.new_query is None for w in widgets] == [True, False]


def test_a_written_widget_still_has_to_name_a_real_table() -> None:
    """The safety rule is unchanged by any of this: a table the instance does
    not have is dropped rather than queried, and the turn degrades."""
    llm = FakeChatLlm(
        answer(name="Invented", widgets=[{"title": "x", "datasetTable": "not_a_table", "intent": "anything"}])
    )

    result = ask(llm, turn("dashboard"), Grounding("dashboard", queries=QUERIES, datasets=(SPEEDS,)))

    assert (result.ready, result.proposal) == (False, None)
    assert "not_a_table" in result.reply


def test_a_dashboard_will_not_write_more_queries_than_the_cap() -> None:
    """Each written query is its own generation plus the safety check, inside
    the turn the analyst is waiting on. Past the cap the extra rows are refused
    and the reply says so, rather than spending a minute of their time in
    silence.

    The rows that fit are still offered. Refusing the whole turn over the one
    row that did not fit threw away four generations already paid for."""
    rows = [
        {"title": f"w{i}", "datasetTable": "regional_speeds", "intent": "avg speed"}
        for i in range(MAX_NEW_QUERIES_PER_DASHBOARD + 1)
    ]
    generated = [{"sql": "SELECT speed_mph FROM regional_speeds", "rationale": "Speeds."}] * len(rows)
    llm = FakeChatLlm(answer(name="Too many", widgets=rows), *generated)

    result = ask(llm, turn("dashboard"), Grounding("dashboard", queries=QUERIES, datasets=(SPEEDS,)))

    assert result.ready is True
    assert result.proposal is not None
    assert len(cast(Any, result.proposal).widgets) == MAX_NEW_QUERIES_PER_DASHBOARD
    assert str(MAX_NEW_QUERIES_PER_DASHBOARD) in result.reply

"""What counts as an id, and what counts as a number.

Split out of test_ai_converse.py, which covers what the model NAMED. These two
cases are about the type of what it named rather than the value: a boolean that
Python treats as an integer, and a zero that a truthiness check treats as
absent. Both got through checks that looked correct.
"""

from typing import Any, cast

import pytest

from tests.converse_stubs import FakeChatLlm, answer, ask, resolves_to, turn
from veodyn_api.schemas.ai_create import CreateKind
from veodyn_api.services.ai_converse_grounding import Grounding
from veodyn_api.services.ai_grounding import GroundedQuery

# Deliberately id 1, which is the id a boolean collides with.
QUERY_ONE = (GroundedQuery(id=1, name="Query one", description="", tags=[], updated_at="2026-07-20"),)


def test_a_kpi_target_of_zero_survives() -> None:
    """Zero is a target somebody asks for here (zero dropped feeds, zero safety
    incidents), so it cannot double as the sentinel for "they gave none". A
    truthiness check answers a lower-is-better goal of nothing with a blank
    field and a Create button that will not press."""
    llm = FakeChatLlm(
        answer(name="Dropped feeds", queryId=1, valueColumn="dropped", target=0, direction="lower-is-better")
    )

    result = ask(llm, turn("kpi"), Grounding("kpi", queries=QUERY_ONE))

    assert result.proposal is not None
    assert result.proposal.model_dump()["target"] == 0.0


def test_a_kpi_target_the_model_left_out_stays_distinguishable_from_zero() -> None:
    """The other half of the pair above. If absent and zero both arrive as the
    same value the card cannot tell "no target" from "a target of nothing"."""
    llm = FakeChatLlm(answer(name="On time", queryId=1, valueColumn="pct"))

    result = ask(llm, turn("kpi"), Grounding("kpi", queries=QUERY_ONE))

    assert result.proposal is not None
    assert result.proposal.model_dump()["target"] is None


@pytest.mark.parametrize("kind", ["dashboard", "kpi", "report"])
def test_a_boolean_where_a_query_id_belongs_never_resolves_to_query_one(kind: str) -> None:
    """isinstance(True, int) is True, and {1: query}.get(True) finds query 1,
    because True hashes and compares equal to 1. So `true` in an id field
    resolved to whichever query happens to be id 1 and shipped as grounded,
    through a check that reads as if it excluded exactly this.

    Every kind that names a query is covered: the guard was missing from all
    three, and fixing one would have left the other two.
    """
    payloads: dict[str, dict[str, Any]] = {
        "dashboard": {"name": "Board", "widgets": [{"queryId": True, "title": "One"}]},
        "kpi": {"name": "On time", "queryId": True, "valueColumn": "pct"},
        "report": {"outline": {"goal": "g", "sections": [{"title": "T", "queryId": True}]}},
    }
    llm = FakeChatLlm(answer(**payloads[kind]))

    result = ask(
        llm,
        turn(cast(CreateKind, kind)),
        Grounding(cast(CreateKind, kind), queries=QUERY_ONE),
        resolve_visualization=resolves_to(7),
    )

    assert result.ready is False
    assert result.proposal is None

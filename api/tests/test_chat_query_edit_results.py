import json
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from tests.chat_stubs import text_turn, tool_turn
from tests.query_edit_stubs import DETAIL, SNAPSHOT, call, edit_result
from tests.test_chat_routes import Harness, harness, headers, model
from tests.test_chat_tools import Drafts, context
from veodyn_api.schemas.ai_chat_results import ChatToolResultIn
from veodyn_api.services.chat.parameter_rules import check_parameters
from veodyn_api.services.chat.tools import Immediate, prepare_call

__all__ = ["harness", "model"]

RESULT = TypeAdapter(ChatToolResultIn)


@pytest.mark.anyio
async def test_propose_query_parameters_checked() -> None:
    base = {
        "name": "Trips",
        "datasetTable": "regional_speeds",
        "sql": "SELECT avg(speed_mph) FROM regional_speeds WHERE d = {{ day }}",
        "vizChoiceId": "table",
    }
    drafts = Drafts()
    good = await prepare_call(
        call("propose_query", **base, parameters=[{"name": "day", "type": "date"}]), context(drafts)
    )
    assert isinstance(good, Immediate) and not good.is_error, good
    assert drafts.saved[0][2]["parameters"] == [{"name": "day", "type": "date"}]

    orphan = await prepare_call(call("propose_query", **base, parameters=[]), context(Drafts()))
    assert isinstance(orphan, Immediate) and orphan.is_error and "day" in orphan.content

    extra = await prepare_call(
        call("propose_query", **base, parameters=[{"name": "day", "type": "date"}, {"name": "z", "type": "text"}]),
        context(Drafts()),
    )
    assert isinstance(extra, Immediate) and extra.is_error and "z" in extra.content


@pytest.mark.anyio
async def test_propose_query_without_parameters_is_unchanged() -> None:
    drafts = Drafts()
    templated = "SELECT avg(speed_mph) FROM regional_speeds WHERE d = {{ day }}"
    outcome = await prepare_call(
        call(
            "propose_query",
            name="Avg",
            datasetTable="regional_speeds",
            sql=templated,
            vizChoiceId="table",
        ),
        context(drafts),
    )
    assert isinstance(outcome, Immediate) and not outcome.is_error
    assert "parameters" not in drafts.saved[0][2]


def test_check_parameters_accepts_matching_definitions() -> None:
    assert (
        check_parameters("select {{ a }}, {{b}}", [{"name": "a", "type": "text"}, {"name": "b", "type": "number"}])
        is None
    )
    assert check_parameters("select 1", []) is None


def test_check_parameters_maps_dotted_references_to_their_definition() -> None:
    sql = "where d >= '{{ window.start }}' and d < '{{ window.end }}'"
    assert check_parameters(sql, [{"name": "window", "type": "date-range"}]) is None


def test_check_parameters_names_the_orphans() -> None:
    assert "x" in (check_parameters("select {{ x }}", []) or "")
    assert "y" in (check_parameters("select 1", [{"name": "y", "type": "text"}]) or "")


@pytest.mark.parametrize(
    "definition",
    [
        {"name": "a", "type": "colour"},
        {"name": "a"},
        {"type": "text"},
        {"name": "a b", "type": "text"},
        {"name": "a", "type": "enum", "quote": "triple"},
        {"name": "a", "type": "text", "unknown": 1},
        "a",
    ],
)
def test_check_parameters_refuses_a_malformed_definition(definition: Any) -> None:
    assert check_parameters("select {{ a }}", [definition]) is not None


def test_check_parameters_refuses_duplicates() -> None:
    reason = check_parameters("select {{ a }}", [{"name": "a", "type": "text"}, {"name": "a", "type": "text"}])
    assert reason is not None and "a" in reason


def test_check_parameters_accepts_every_documented_field() -> None:
    definition = {
        "name": "a",
        "title": "A",
        "type": "enum",
        "value": "x",
        "enumOptions": "x\ny",
        "multi": True,
        "quote": "single",
        "queryId": 3,
    }
    assert check_parameters("select {{ a }}", [definition]) is None


def test_the_two_query_results_are_accepted() -> None:
    assert RESULT.validate_python(DETAIL).kind == "query_detail"
    assert RESULT.validate_python(edit_result({"name": "x"})).kind == "query_edit"
    assert RESULT.validate_python({"ok": False, "kind": "query_detail", "error": "No query 5"}).kind == "query_detail"
    assert RESULT.validate_python({"ok": False, "kind": "query_edit", "error": "You cannot edit this"}).kind == (
        "query_edit"
    )


def test_a_cleared_schedule_survives_validation_and_dump() -> None:
    parsed = RESULT.validate_python(edit_result({"schedule": None}))
    dumped = parsed.model_dump(by_alias=True, exclude_none=True, mode="json")
    assert dumped["changes"] == {"schedule": None}


@pytest.mark.parametrize(
    "mutation",
    [
        {"query": {**DETAIL["query"], "sql": "x" * 50_001}},
        {"query": {**DETAIL["query"], "parameters": [{"name": "p"}] * 21}},
        {"query": {**DETAIL["query"], "visualizations": [{"id": 1, "name": "v", "type": "t"}] * 21}},
        {"query": {**DETAIL["query"], "id": 0}},
    ],
)
def test_a_malformed_query_detail_is_refused(mutation: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        RESULT.validate_python({**DETAIL, **mutation})


def test_can_edit_rides_on_the_single_object_reads() -> None:
    saved = {
        "ok": True,
        "kind": "saved_visualization",
        "query": {"id": 5, "name": "Trips", "canEdit": False},
    }
    dashboard = {"ok": True, "kind": "dashboard", "dashboard": {"id": 4, "name": "Overview", "canEdit": True}}
    assert RESULT.validate_python(saved).model_dump(by_alias=True)["query"]["canEdit"] is False
    assert RESULT.validate_python(dashboard).model_dump(by_alias=True)["dashboard"]["canEdit"] is True


def test_result_kinds_accepted_by_tool_results_route(harness: Harness) -> None:
    harness.model.turns.extend([tool_turn("call-1", "open_query", {"queryId": 5}), text_turn("It selects one.")])
    turn = harness.turn(harness.thread())
    request = harness.wait_for(turn, "tool_request")
    assert request == {"callId": "call-1", "tool": "open_query", "args": {"queryId": 5}, "resultKind": "query_detail"}
    refused = harness.client.post(
        f"/ai/chat/turns/{turn}/tool-results",
        json={"callId": "call-1", "result": edit_result({"name": "x"})},
        headers=headers(),
    )
    assert refused.status_code == 409
    accepted = harness.client.post(
        f"/ai/chat/turns/{turn}/tool-results", json={"callId": "call-1", "result": DETAIL}, headers=headers()
    )
    assert accepted.status_code == 202, accepted.text
    harness.wait_for(turn, "turn_done")
    sent = json.loads(harness.model.calls[1]["messages"][2]["content"][0]["content"])
    assert sent["query"]["sql"] == "select 1"
    assert sent["query"]["canEdit"] is True


def test_update_query_round_trips_through_the_routes_and_stores_a_draft(harness: Harness) -> None:
    changes = {"sql": "select 2", "name": "Two"}
    harness.model.turns.extend(
        [tool_turn("call-1", "update_query", {"queryId": 5, "changes": changes}), text_turn("Proposed.")]
    )
    thread = harness.thread()
    turn = harness.turn(thread)
    request = harness.wait_for(turn, "tool_request")
    assert request["args"] == {"queryId": 5, "changes": changes, "format": False}
    accepted = harness.client.post(
        f"/ai/chat/turns/{turn}/tool-results",
        json={"callId": "call-1", "result": edit_result(changes)},
        headers=headers(),
    )
    assert accepted.status_code == 202, accepted.text
    draft = harness.wait_for(turn, "draft")
    harness.wait_for(turn, "turn_done")
    assert draft["kind"] == "query_edit"
    assert draft["payload"]["changes"] == changes
    detail = harness.client.get(f"/ai/chat/threads/{thread}", headers=headers()).json()
    [entry] = detail["drafts"]
    assert entry["kind"] == "query_edit"
    assert entry["versions"][0]["payload"]["snapshot"]["updatedAt"] == SNAPSHOT["updatedAt"]
    sent = json.loads(harness.model.calls[1]["messages"][2]["content"][0]["content"])
    assert sent == {"draftId": draft["draftId"], "version": 1, "changed": ["sql", "name"]}


@pytest.mark.parametrize(("length", "accepted"), [(4096, True), (4097, False)])
def test_a_description_up_to_nodes_limit_is_accepted(length: int, accepted: bool) -> None:
    text = "x" * length
    detail = {**DETAIL, "query": {**DETAIL["query"], "description": text}}
    edit = edit_result({"description": text}, snapshot={**SNAPSHOT, "description": text})
    if accepted:
        assert RESULT.validate_python(detail).kind == "query_detail"
        assert RESULT.validate_python(edit).kind == "query_edit"
    else:
        with pytest.raises(ValidationError):
            RESULT.validate_python(detail)
        with pytest.raises(ValidationError):
            RESULT.validate_python(edit)

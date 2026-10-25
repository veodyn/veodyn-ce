import json
import uuid
from typing import Any

from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from tests.mcp_stubs import JSON_SOURCE, PROPOSE, RUN, SQL, Mcp, mcp, warehouse_context
from tests.query_edit_stubs import edit_result
from tests.test_chat_routes import harness, headers, model
from veodyn_api.services.chat import store

__all__ = ["harness", "mcp", "model"]

SCHEMA = {
    "ok": True,
    "kind": "data_source_schema",
    "dataSourceId": 3,
    "syntax": "json",
    "resources": [{"name": "routes", "params": ["agency"]}],
}
RESOURCE_RUN = {"dataSourceId": 3, "resourceCall": {"resource": "routes", "params": {"agency": "x"}}}


def test_call_immediate_returns_done(mcp: Mcp) -> None:
    done = mcp.call("run_query", {"datasetTable": "nope", "sql": SQL})
    assert done["kind"] == "done"
    assert done["isError"] is True
    assert "no table called" in done["content"]
    assert done["draft"] is None


def test_call_client_call_stores_pending_for_subject(mcp: Mcp) -> None:
    outcome = mcp.call("run_query", {**RUN, "vizChoiceId": "counter", "purpose": "ignored"})
    assert outcome["kind"] == "client_call"
    assert outcome["tool"] == "run_query"
    assert outcome["args"] == {"dataSourceId": 5, "sql": SQL, "purpose": "run_query", "vizChoiceId": "table"}
    key = f"chat:mcp:{outcome['callId']}"
    stored = json.loads(mcp.harness.redis.get(key))
    assert stored["subject"] == "7"
    assert stored["tool"] == "run_query"
    assert stored["name"] == "run_query"
    assert 0 < mcp.harness.redis.ttl(key) <= 300


def test_result_other_subject_409(mcp: Mcp) -> None:
    outcome = mcp.call("run_query", RUN)
    mcp.result(outcome["callId"], {"ok": True, "kind": "query_result"}, subject="8", expect=409)
    assert mcp.harness.redis.exists(f"chat:mcp:{outcome['callId']}") == 1


def test_result_wrong_kind_409(mcp: Mcp) -> None:
    outcome = mcp.call("run_query", RUN)
    mcp.result(outcome["callId"], {"ok": True, "kind": "data_sources", "sources": []}, expect=409)
    mcp.result(str(uuid.uuid4()), {"ok": True, "kind": "query_result"}, expect=409)


def test_result_for_a_read_returns_the_result_json_and_spends_the_call(mcp: Mcp) -> None:
    outcome = mcp.call("run_query", RUN)
    result = {"ok": True, "kind": "query_result", "rowCount": 1, "sample": [{"avg": 31.5}]}
    done = mcp.result(outcome["callId"], result)
    assert done["kind"] == "done" and done["isError"] is False and done["draft"] is None
    assert json.loads(done["content"])["sample"] == [{"avg": 31.5}]
    mcp.result(outcome["callId"], result, expect=409)


def test_result_that_failed_is_an_error(mcp: Mcp) -> None:
    outcome = mcp.call("run_query", RUN)
    done = mcp.result(outcome["callId"], {"ok": False, "kind": "query_result", "error": "boom"})
    assert done["isError"] is True
    assert json.loads(done["content"])["error"] == "boom"


def test_result_runs_complete_and_returns_draft_link(mcp: Mcp) -> None:
    outcome = mcp.call("update_query", {"queryId": 5, "changes": {"name": "Two"}})
    assert outcome["kind"] == "client_call" and outcome["tool"] == "update_query"
    done = mcp.result(outcome["callId"], edit_result({"name": "Two"}))
    assert done["kind"] == "done" and done["isError"] is False
    draft = done["draft"]
    assert draft["version"] == 1
    assert draft["url"] == f"/chat/{draft['threadId']}"
    assert json.loads(done["content"]) == {"draftId": draft["draftId"], "version": 1, "changed": ["name"]}
    detail = mcp.thread(draft["threadId"])
    assert detail["thread"]["origin"] == "mcp"
    assert [one["kind"] for one in detail["drafts"]] == ["query_edit"]


def test_a_refused_completion_stores_no_draft(mcp: Mcp) -> None:
    outcome = mcp.call("update_query", {"queryId": 5, "changes": {"name": "Two"}})
    done = mcp.result(outcome["callId"], edit_result({}))
    assert done["isError"] is True
    assert done["draft"] is None


def test_proposal_creates_mcp_thread_with_complete_turn(mcp: Mcp, db: Session) -> None:
    done = mcp.call("propose_query", PROPOSE)
    assert done["kind"] == "done" and done["isError"] is False
    draft = done["draft"]
    detail = mcp.thread(draft["threadId"])
    assert detail["thread"]["origin"] == "mcp"
    assert detail["thread"]["title"] == "Average speed"
    [turn] = detail["turns"]
    assert turn["status"] == "done"
    assert turn["userText"] == "via MCP: propose_query"
    first, second, third = turn["blocks"]
    [use] = first["content"]
    assert (first["role"], use["type"], use["name"]) == ("assistant", "tool_use", "propose_query")
    assert use["input"]["name"] == "Average speed"
    [result] = second["content"]
    assert (second["role"], result["type"], result["tool_use_id"]) == ("user", "tool_result", use["id"])
    assert json.loads(result["content"])["draftId"] == draft["draftId"]
    assert third == {
        "role": "assistant",
        "content": [{"type": "text", "text": "Proposed from an MCP client; review it here."}],
    }
    [entry] = detail["drafts"]
    assert entry["id"] == draft["draftId"] and entry["kind"] == "query"
    replayed, omitted = store.replay(db, uuid.UUID(draft["threadId"]), 2, 120_000)
    assert omitted is False
    assert [message["role"] for message in replayed] == ["user", "assistant", "user", "assistant"]


def test_a_dashboard_proposal_is_titled_by_its_name(mcp: Mcp) -> None:
    done = mcp.call(
        "propose_dashboard", {"name": "Board", "items": [{"kind": "existing", "queryId": 3, "visualizationId": 4}]}
    )
    assert mcp.thread(done["draft"]["threadId"])["thread"]["title"] == "Board"


def test_a_read_creates_no_thread(mcp: Mcp) -> None:
    mcp.call("run_query", RUN)
    mcp.call("run_query", {"datasetTable": "nope", "sql": SQL})
    assert mcp.client.get("/ai/chat/threads", headers=headers()).json()["threads"] == []


def test_thread_id_reuse_checks_owner(mcp: Mcp) -> None:
    thread = mcp.harness.thread(subject="7")
    mcp.call("propose_query", {**PROPOSE, "threadId": thread}, subject="8", expect=404)
    first = mcp.call("propose_query", {**PROPOSE, "threadId": thread}, subject="7")
    assert first["draft"]["threadId"] == thread
    again = mcp.call("propose_query", {**PROPOSE, "threadId": thread, "draftId": first["draft"]["draftId"]})
    assert again["draft"]["draftId"] == first["draft"]["draftId"]
    assert again["draft"]["version"] == 2
    detail = mcp.thread(thread)
    assert detail["thread"]["origin"] == "chat"
    assert [turn["status"] for turn in detail["turns"]] == ["done", "done"]


def test_a_thread_id_that_is_not_a_uuid_is_rejected(mcp: Mcp) -> None:
    mcp.call("propose_query", {**PROPOSE, "threadId": "not-a-uuid"}, expect=404)


def test_describe_schema_context_satisfies_resource_call(mcp: Mcp) -> None:
    context = warehouse_context(JSON_SOURCE)
    refused = mcp.call("run_query", RESOURCE_RUN, context=context)
    assert refused["kind"] == "done" and refused["isError"] is True
    assert "describe_data_source" in refused["content"]

    described = mcp.call("describe_data_source", {"dataSourceId": 3}, context=context)
    assert described["kind"] == "client_call"
    mcp.result(described["callId"], SCHEMA)

    allowed = mcp.call("run_query", RESOURCE_RUN, context={**context, "schemas": [SCHEMA]})
    assert allowed["kind"] == "client_call"
    assert allowed["args"]["dataSourceId"] == 3
    assert json.loads(allowed["args"]["sql"]) == {"resource": "routes", "params": {"agency": "x"}}


def test_a_param_the_described_resource_lacks_is_still_refused(mcp: Mcp) -> None:
    context = {**warehouse_context(JSON_SOURCE), "schemas": [SCHEMA]}
    call: dict[str, Any] = {"dataSourceId": 3, "resourceCall": {"resource": "routes", "params": {"nope": 1}}}
    refused = mcp.call("run_query", call, context=context)
    assert refused["isError"] is True and "nope" in refused["content"]


def test_warehouse_gated_on_inventory_for_mcp(mcp: Mcp) -> None:
    other = {"id": 9, "name": "Other", "type": "pg", "syntax": "sql", "viewOnly": False}
    hidden = mcp.call("run_query", RUN, context={"dataSources": [other]})
    assert hidden["kind"] == "done" and hidden["isError"] is True
    assert "no table called" in hidden["content"]
    none_at_all = mcp.call("run_query", RUN, context={})
    assert none_at_all["kind"] == "done" and none_at_all["isError"] is True
    visible = mcp.call("run_query", RUN, context=warehouse_context(other))
    assert visible["kind"] == "client_call"


def test_the_update_query_completion_sees_the_call_context(mcp: Mcp) -> None:
    other = {"id": 9, "name": "Other", "type": "pg", "syntax": "sql", "viewOnly": False}
    changes = {"sql": "select 2", "dataSourceId": 9}
    outcome = mcp.call("update_query", {"queryId": 5, "changes": changes}, context=warehouse_context(other))
    done = mcp.result(outcome["callId"], edit_result(changes))
    assert done["isError"] is False
    assert done["draft"] is not None

    unknown = mcp.call("update_query", {"queryId": 5, "changes": changes}, context=warehouse_context())
    refused = mcp.result(unknown["callId"], edit_result(changes))
    assert refused["isError"] is True and refused["draft"] is None


def test_migration_0020_upgrade_downgrade(alembic_engine_at_0019: Engine) -> None:
    from tests.conftest import upgrade_to

    engine = alembic_engine_at_0019
    thread = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO ai_chat_thread (id, owner_subject) VALUES (:id, '7')"), {"id": thread})
    upgrade_to(engine, "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT origin FROM ai_chat_thread")).scalar_one() == "chat"
        column = conn.execute(
            text(
                "SELECT is_nullable, column_default FROM information_schema.columns "
                "WHERE table_name = 'ai_chat_thread' AND column_name = 'origin'"
            )
        ).one()
        assert column[0] == "NO" and "chat" in column[1]
    from alembic import command

    from tests.migration_chains import ce_config

    command.downgrade(ce_config(), "0019")
    with engine.connect() as conn:
        columns = {
            row[0]
            for row in conn.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_chat_thread'")
            )
        }
    assert "origin" not in columns
    assert "applied_reported_at" in columns

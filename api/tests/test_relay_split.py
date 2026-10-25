import pytest

from tests.mcp_stubs import PROPOSE, Mcp, mcp
from tests.test_chat_routes import harness, headers, model
from veodyn_api.errors import ApiError
from veodyn_api.routers.ai import require_provider, require_relay, require_relay_key
from veodyn_api.settings import Settings, get_settings

__all__ = ["harness", "mcp", "model"]


def without(surface: Mcp, **fields: str) -> None:
    changed = get_settings().model_copy(update=fields)
    surface.app.dependency_overrides[get_settings] = lambda: changed


def test_chat_routes_work_without_provider_key_except_post_turn(mcp: Mcp) -> None:
    without(mcp, ai_api_key="")
    client = mcp.client
    created = client.post("/ai/chat/threads", headers=headers())
    assert created.status_code == 201, created.text
    thread = created.json()["id"]
    assert client.get("/ai/chat/threads", headers=headers()).status_code == 200
    assert client.get(f"/ai/chat/threads/{thread}", headers=headers()).status_code == 200
    assert client.patch(f"/ai/chat/threads/{thread}", json={"pinned": True}, headers=headers()).status_code == 200
    refused = client.post(f"/ai/chat/threads/{thread}/turns", json={"text": "hi"}, headers=headers())
    assert refused.status_code == 503
    assert refused.json()["error"]["id"] == "VEODYN_AI_NOT_CONFIGURED"
    assert client.delete(f"/ai/chat/threads/{thread}", headers=headers()).status_code == 204


def test_mcp_serves_every_read_and_proposal_without_a_provider_key(mcp: Mcp) -> None:
    without(mcp, ai_api_key="")
    assert mcp.tools()
    read = mcp.call("run_query", {"datasetTable": "regional_speeds", "sql": "SELECT 1"})
    assert read["kind"] in ("done", "client_call")
    assert mcp.call("propose_query", PROPOSE)["draft"] is not None


def test_no_relay_key_is_unavailable_and_a_wrong_bearer_is_refused(mcp: Mcp) -> None:
    body = {"chatEnabled": True}
    without(mcp, ai_relay_key="")
    assert mcp.client.post("/ai/chat/mcp/tools", json=body, headers=headers()).status_code == 503
    assert mcp.client.get("/ai/chat/threads", headers=headers()).status_code == 503
    mcp.app.dependency_overrides.pop(get_settings)
    wrong = {**headers(), "authorization": "Bearer nope"}
    assert mcp.client.post("/ai/chat/mcp/tools", json=body, headers=wrong).status_code == 401
    assert mcp.client.get("/ai/chat/threads", headers=wrong).status_code == 401


def test_the_other_ai_routers_still_need_both_keys() -> None:
    settings = Settings(ai_relay_key="k", ai_api_key="")
    with pytest.raises(ApiError) as unavailable:
        require_relay(settings, "Bearer k")
    assert unavailable.value.status_code == 503
    require_relay_key(settings, "Bearer k")
    with pytest.raises(ApiError) as provider:
        require_provider(settings)
    assert provider.value.status_code == 503
    with pytest.raises(ApiError) as wrong:
        require_relay(Settings(ai_relay_key="k", ai_api_key="m"), "Bearer z")
    assert wrong.value.status_code == 401

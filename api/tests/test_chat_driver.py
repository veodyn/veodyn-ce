from collections.abc import AsyncIterator
from typing import Any

import anthropic
import httpx2
import pytest
from anthropic.lib.streaming._types import TextEvent
from anthropic.types import Message, TextBlock, ToolUseBlock, Usage

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.chat import driver
from veodyn_api.services.chat.driver import AnthropicChatModel, build_chat_client
from veodyn_api.settings import Settings

pytestmark = pytest.mark.anyio

SYSTEM = [{"type": "text", "text": "rules"}, {"type": "text", "text": "catalog"}]
TOOLS = [{"name": "a", "input_schema": {"type": "object"}}, {"name": "b", "input_schema": {"type": "object"}}]
MESSAGES = [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]


def final(stop_reason: str = "end_turn") -> Message:
    return Message(
        id="msg_1",
        type="message",
        role="assistant",
        model="m",
        content=[
            TextBlock(type="text", text="Hello there"),
            ToolUseBlock(type="tool_use", id="t1", name="a", input={"x": 1}),
        ],
        stop_reason=stop_reason,
        stop_sequence=None,
        usage=Usage(input_tokens=11, output_tokens=7),
    )


class FakeStream:
    def __init__(self, events: list[Any], message: Message) -> None:
        self.events = events
        self.message = message

    async def __aenter__(self) -> "FakeStream":
        return self

    async def __aexit__(self, *_: Any) -> None:
        return None

    async def __aiter__(self) -> AsyncIterator[Any]:
        for event in self.events:
            yield event

    async def get_final_message(self) -> Message:
        return self.message


class FakeMessages:
    def __init__(self, outcome: FakeStream | Exception) -> None:
        self.outcome = outcome
        self.requests: list[dict[str, Any]] = []

    def stream(self, **request: Any) -> FakeStream:
        self.requests.append(request)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class FakeClient:
    def __init__(self, outcome: FakeStream | Exception) -> None:
        self.messages = FakeMessages(outcome)


def text_event(text: str) -> TextEvent:
    return TextEvent(type="text", text=text, snapshot=text)


async def run(client: FakeClient, sink: list[str], tools: list[dict[str, Any]] = TOOLS) -> driver.ModelTurn:
    async def on_text(text: str) -> None:
        sink.append(text)

    model = AnthropicChatModel(client, "claude-test", 1234)
    return await model.run(system=SYSTEM, messages=MESSAGES, tools=tools, on_text=on_text)


async def test_the_request_lets_the_model_choose_and_caches_the_prefix() -> None:
    client = FakeClient(FakeStream([], final()))
    await run(client, [])
    [request] = client.messages.requests
    assert request["model"] == "claude-test"
    assert request["max_tokens"] == 1234
    assert request["tool_choice"] == {"type": "auto"}
    assert "temperature" not in request
    assert "thinking" not in request
    assert request["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in request["system"][0]
    assert request["tools"][-1]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in SYSTEM[-1]
    assert request["messages"] is MESSAGES


async def test_a_request_without_tools_sends_no_tool_fields() -> None:
    client = FakeClient(FakeStream([], final()))
    await run(client, [], tools=[])
    assert "tools" not in client.messages.requests[0]
    assert "tool_choice" not in client.messages.requests[0]


async def test_text_is_forwarded_as_it_arrives_and_the_content_is_dumped() -> None:
    client = FakeClient(FakeStream([text_event("Hel"), object(), text_event("lo")], final("tool_use")))
    sink: list[str] = []
    turn = await run(client, sink)
    assert sink == ["Hel", "lo"]
    assert turn.stop_reason == "tool_use"
    assert turn.content == [
        {"type": "text", "text": "Hello there"},
        {"type": "tool_use", "id": "t1", "name": "a", "input": {"x": 1}},
    ]
    assert turn.usage["input_tokens"] == 11
    assert turn.usage["model"] == "claude-test"


async def test_a_truncated_answer_is_a_failure() -> None:
    with pytest.raises(ApiError) as refused:
        await run(FakeClient(FakeStream([], final("max_tokens"))), [])
    assert refused.value.error_id is ErrorId.AI_PROVIDER_FAILED


@pytest.mark.parametrize(
    "error",
    [
        anthropic.APIConnectionError(request=httpx2.Request("POST", "https://provider.test")),
        anthropic.InternalServerError(
            "boom",
            response=httpx2.Response(500, request=httpx2.Request("POST", "https://provider.test")),
            body=None,
        ),
    ],
)
async def test_a_provider_error_becomes_a_provider_failure(error: Exception) -> None:
    with pytest.raises(ApiError) as refused:
        await run(FakeClient(error), [])
    assert refused.value.error_id is ErrorId.AI_PROVIDER_FAILED
    assert refused.value.status_code == 502


def test_the_foundry_provider_builds_the_foundry_client() -> None:
    client = build_chat_client(Settings(ai_api_key="k", ai_provider="foundry", ai_foundry_resource="my-resource"))
    assert isinstance(client, anthropic.AsyncAnthropicFoundry)


def test_the_default_provider_builds_the_first_party_client() -> None:
    client = build_chat_client(Settings(ai_api_key="k"))
    assert isinstance(client, anthropic.AsyncAnthropic)
    assert not isinstance(client, anthropic.AsyncAnthropicFoundry)


@pytest.mark.parametrize(
    "settings",
    [
        Settings(ai_api_key=""),
        Settings(ai_api_key="k", ai_provider="foundry", ai_foundry_resource=""),
    ],
)
def test_an_unconfigured_provider_is_unavailable(settings: Settings) -> None:
    with pytest.raises(ApiError) as refused:
        build_chat_client(settings)
    assert refused.value.error_id is ErrorId.AI_NOT_CONFIGURED
    assert refused.value.status_code == 503


def test_the_chat_model_falls_back_to_the_ai_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VEODYN_AI_API_KEY", "k")
    monkeypatch.setenv("VEODYN_AI_MODEL", "base-model")
    driver.get_chat_model.cache_clear()
    try:
        assert driver.get_chat_model().model_id == "base-model"
        monkeypatch.setenv("VEODYN_AI_CHAT_MODEL", "chat-model")
        from veodyn_api.settings import get_settings

        get_settings.cache_clear()
        driver.get_chat_model.cache_clear()
        assert driver.get_chat_model().model_id == "chat-model"
    finally:
        driver.get_chat_model.cache_clear()

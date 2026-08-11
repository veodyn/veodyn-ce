"""The model client: what it retries, what it logs, and what it refuses.

The logging is security-relevant, not cosmetic. Pod logs are read by more people
and shipped to more places than the pod environment is, so the one thing that
must never reach them is the key.
"""

import json
import logging

import httpx
import pytest
import respx

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.llm import LlmClient, _redacted, as_objects
from veodyn_api.settings import Settings

PROVIDER = "https://api.anthropic.test"
SCHEMA = {"type": "object", "properties": {"sql": {"type": "string"}}, "required": ["sql"]}


def client(**overrides: object) -> LlmClient:
    values: dict[str, object] = {"ai_api_key": "model-key", "ai_base_url": PROVIDER, "ai_model": "test-model"}
    return LlmClient(Settings(**{**values, **overrides}))  # type: ignore[arg-type]


def ask(subject: LlmClient) -> dict[str, object]:
    return subject.structured(system="s", prompt="p", schema=SCHEMA, tool_name="write_sql")


def test_the_key_is_scrubbed_from_a_logged_error_body() -> None:
    body = '{"error":{"message":"invalid x-api-key: sk-ant-secret"}}'

    assert "sk-ant-secret" not in _redacted(body, "sk-ant-secret")
    assert "<redacted>" in _redacted(body, "sk-ant-secret")


def test_a_logged_body_is_truncated() -> None:
    assert len(_redacted("x" * 5_000, "")) < 5_000


@respx.mock
def test_the_answer_is_the_forced_tool_input() -> None:
    respx.post(f"{PROVIDER}/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "stop_reason": "tool_use",
                "content": [
                    {"type": "text", "text": "Here you go:"},
                    {"type": "tool_use", "name": "write_sql", "input": {"sql": "SELECT 1"}},
                ],
            },
        )
    )

    assert ask(client()) == {"sql": "SELECT 1"}


@respx.mock
def test_temperature_is_not_sent_unless_an_operator_asks_for_it() -> None:
    """Current Claude models answer 400 to a request carrying `temperature`, so
    a default sent "just in case" failed every single call."""
    route = respx.post(f"{PROVIDER}/v1/messages").mock(
        return_value=httpx.Response(200, json={"content": [{"type": "tool_use", "input": {"sql": "SELECT 1"}}]})
    )

    ask(client())

    assert "temperature" not in json.loads(route.calls[0].request.content)


@respx.mock
def test_a_configured_temperature_is_sent() -> None:
    route = respx.post(f"{PROVIDER}/v1/messages").mock(
        return_value=httpx.Response(200, json={"content": [{"type": "tool_use", "input": {"sql": "SELECT 1"}}]})
    )

    ask(client(ai_temperature=0.4))

    assert json.loads(route.calls[0].request.content)["temperature"] == 0.4


@respx.mock
def test_a_truncated_answer_is_a_failure_not_a_partial_result() -> None:
    """The tool input of a max_tokens stop is cut mid-object. A half-written
    report section would otherwise be validated and shipped as a draft."""
    respx.post(f"{PROVIDER}/v1/messages").mock(
        return_value=httpx.Response(
            200, json={"stop_reason": "max_tokens", "content": [{"type": "tool_use", "input": {"sql": "SELE"}}]}
        )
    )

    with pytest.raises(ApiError) as failed:
        ask(client())

    assert failed.value.error_id == ErrorId.AI_PROVIDER_FAILED


@respx.mock
def test_a_prose_only_answer_is_refused() -> None:
    respx.post(f"{PROVIDER}/v1/messages").mock(
        return_value=httpx.Response(200, json={"content": [{"type": "text", "text": "I would rather not."}]})
    )

    with pytest.raises(ApiError):
        ask(client())


@respx.mock
def test_an_overloaded_provider_is_retried() -> None:
    route = respx.post(f"{PROVIDER}/v1/messages").mock(
        side_effect=[
            httpx.Response(529, json={"error": "overloaded"}),
            httpx.Response(200, json={"content": [{"type": "tool_use", "input": {"sql": "SELECT 1"}}]}),
        ]
    )

    assert ask(client()) == {"sql": "SELECT 1"}
    assert route.call_count == 2


@respx.mock
def test_a_rejected_request_is_not_retried() -> None:
    """A 400 is our own malformed request and a 401 is a bad key. Repeating
    either spends the caller's wait on the same answer."""
    route = respx.post(f"{PROVIDER}/v1/messages").mock(return_value=httpx.Response(400, json={"error": "bad model"}))

    with pytest.raises(ApiError):
        ask(client())

    assert route.call_count == 1


def test_an_unconfigured_client_refuses_before_making_a_request() -> None:
    with pytest.raises(ApiError) as failed:
        ask(client(ai_api_key=""))

    assert failed.value.error_id == ErrorId.AI_NOT_CONFIGURED


# --- as_objects -------------------------------------------------------------
#
# A forced tool call buys a shape, not a guarantee. Every case below was
# observed or is one step from what was: the model answered an array field with
# a JSON string, and every consumer silently produced nothing.


def test_a_list_field_that_arrived_as_a_json_string_is_read() -> None:
    """The real failure. Iterating the string yielded characters, each one
    failed the isinstance check, and an outline came back with no sections."""
    answer = '[{"title":"Overall Feed Health"},{"title":"Breakdown"}]'

    assert [row["title"] for row in as_objects(answer)] == ["Overall Feed Health", "Breakdown"]


def test_a_single_object_where_a_list_was_asked_for_is_read_as_one() -> None:
    assert as_objects({"title": "Only one"}) == [{"title": "Only one"}]


def test_a_list_of_json_strings_is_read() -> None:
    assert as_objects(['{"title":"A"}', '{"title":"B"}']) == [{"title": "A"}, {"title": "B"}]


def test_a_proper_list_is_passed_through() -> None:
    assert as_objects([{"title": "A"}]) == [{"title": "A"}]


def test_unparseable_text_yields_nothing_rather_than_raising() -> None:
    assert as_objects("not json at all") == []


def test_a_missing_field_yields_nothing() -> None:
    assert as_objects(None) == []


def test_entries_that_are_not_objects_are_dropped_and_the_rest_survive() -> None:
    assert as_objects([{"title": "A"}, 7, None, "nope"]) == [{"title": "A"}]


def test_a_python_repr_string_is_read_too() -> None:
    """Single quotes are not JSON. Both encodings have turned up in answers."""
    assert as_objects("[{'title': 'A'}]") == [{"title": "A"}]


@respx.mock
def test_an_empty_forced_tool_input_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    """`{}` is a dict, so it passes every check here and reaches the caller as
    "the model said nothing". Each caller then papers over it with a fallback
    sentence, and the reader sees a bland answer with nothing in the pod log to
    explain it. The empty answer still comes back: this is a diagnosis, not a
    new failure mode."""
    respx.post(f"{PROVIDER}/v1/messages").mock(
        return_value=httpx.Response(
            200, json={"stop_reason": "tool_use", "content": [{"type": "tool_use", "name": "write_sql", "input": {}}]}
        )
    )

    with caplog.at_level(logging.WARNING, logger="veodyn_api.services.llm"):
        assert ask(client()) == {}

    assert "empty input" in caplog.text
    assert "write_sql" in caplog.text


@respx.mock
def test_a_filled_tool_input_is_not_logged(caplog: pytest.LogCaptureFixture) -> None:
    respx.post(f"{PROVIDER}/v1/messages").mock(
        return_value=httpx.Response(200, json={"content": [{"type": "tool_use", "input": {"sql": "SELECT 1"}}]})
    )

    with caplog.at_level(logging.WARNING, logger="veodyn_api.services.llm"):
        ask(client())

    assert caplog.records == []

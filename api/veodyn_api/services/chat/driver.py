import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol

import anthropic

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.settings import Settings, get_settings

logger = logging.getLogger(__name__)

TextSink = Callable[[str], Awaitable[None]]


@dataclass(frozen=True)
class ModelTurn:
    content: list[dict[str, Any]]
    stop_reason: str
    usage: dict[str, Any]


class ChatModel(Protocol):
    model_id: str

    async def run(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text: TextSink,
    ) -> ModelTurn: ...


def _unavailable(detail: str) -> ApiError:
    return ApiError(ErrorId.AI_PROVIDER_FAILED, detail, status_code=502)


def _not_configured(detail: str) -> ApiError:
    return ApiError(ErrorId.AI_NOT_CONFIGURED, detail, status_code=503)


def _cache_last(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not items:
        return []
    copied = [dict(item) for item in items]
    copied[-1]["cache_control"] = {"type": "ephemeral"}
    return copied


class AnthropicChatModel:
    def __init__(self, client: Any, model: str, max_tokens: int) -> None:
        self._client = client
        self.model_id = model
        self._max_tokens = max_tokens

    async def run(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text: TextSink,
    ) -> ModelTurn:
        request: dict[str, Any] = {
            "model": self.model_id,
            "max_tokens": self._max_tokens,
            "system": _cache_last(system),
            "messages": messages,
        }
        if tools:
            request["tools"] = _cache_last(tools)
            request["tool_choice"] = {"type": "auto"}
        try:
            async with self._client.messages.stream(**request) as stream:
                async for event in stream:
                    if getattr(event, "type", None) == "text":
                        await on_text(event.text)
                final = await stream.get_final_message()
        except anthropic.APIStatusError as exc:
            logger.warning("the chat model provider returned %s", exc.status_code)
            raise _unavailable(f"the model provider returned {exc.status_code}") from exc
        except anthropic.APIError as exc:
            logger.warning("the chat model provider failed: %s", type(exc).__name__)
            raise _unavailable("the model provider did not answer") from exc
        stop_reason = final.stop_reason or "end_turn"
        if stop_reason == "max_tokens":
            raise _unavailable("the model's answer was truncated")
        usage = final.usage.model_dump(exclude_none=True, mode="json")
        usage["model"] = self.model_id
        return ModelTurn(
            content=[block.model_dump(exclude_none=True, mode="json") for block in final.content],
            stop_reason=stop_reason,
            usage=usage,
        )


def build_chat_client(settings: Settings) -> anthropic.AsyncAnthropic | anthropic.AsyncAnthropicFoundry:
    if not settings.ai_api_key:
        raise _not_configured("no model credential is configured")
    if settings.ai_provider == "foundry":
        if not settings.ai_foundry_resource:
            raise _not_configured("the foundry provider needs a resource name")
        return anthropic.AsyncAnthropicFoundry(
            resource=settings.ai_foundry_resource,
            api_key=settings.ai_api_key,
            timeout=settings.ai_timeout_seconds,
        )
    return anthropic.AsyncAnthropic(
        api_key=settings.ai_api_key,
        base_url=settings.ai_base_url,
        timeout=settings.ai_timeout_seconds,
    )


@lru_cache
def get_chat_model() -> ChatModel:
    settings = get_settings()
    return AnthropicChatModel(
        build_chat_client(settings),
        settings.ai_chat_model or settings.ai_model,
        settings.ai_chat_max_output_tokens,
    )

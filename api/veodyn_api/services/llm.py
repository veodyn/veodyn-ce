"""The one place this service talks to a model.

Structured output is a FORCED TOOL CALL, not a "reply with JSON" instruction. It
buys a shape, not a guarantee: an array field answered with a JSON *string*
holding the array has been observed passing through the tool schema untouched, so
callers read tool fields through `as_objects()` rather than the declared type.

Nothing here decides what is true. Every caller in services/ai_*.py validates the
model's output against real Redash ids before it goes anywhere.
"""

import ast
import json
import logging
import time
from functools import lru_cache
from typing import Any

import httpx

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.settings import Settings, get_settings

logger = logging.getLogger(__name__)

ANTHROPIC_VERSION = "2023-06-01"
# Enough of an error body to name the cause, not enough to be a transcript.
MAX_LOGGED_BODY = 600

# Retried: the provider is overloaded or the hop failed. A 400 is our own
# malformed request and a 401 a bad key, so neither is worth repeating. 529 is
# Anthropic's own "overloaded" and is the transient failure seen most often here.
RETRY_STATUS = frozenset({408, 409, 429, 500, 502, 503, 504, 529})
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 1.5


def _unavailable(detail: str) -> ApiError:
    return ApiError(ErrorId.AI_PROVIDER_FAILED, detail, status_code=502)


def _redacted(body: str, api_key: str) -> str:
    """An error body safe to write to a log.

    Providers echo request material back on some error paths, so the key is
    removed rather than trusted not to be there.
    """
    safe = body.replace(api_key, "<redacted>") if api_key else body
    return safe[:MAX_LOGGED_BODY]


class LlmClient:
    """A thin Anthropic Messages client, scoped to structured output."""

    def __init__(self, settings: Settings) -> None:
        self._api_key = settings.ai_api_key
        self._model = settings.ai_model
        self._max_tokens = settings.ai_max_output_tokens
        self._temperature = settings.ai_temperature
        self._url = f"{settings.ai_base_url.rstrip('/')}/v1/messages"
        self._client = httpx.Client(timeout=settings.ai_timeout_seconds)

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        last: str = "the model provider did not answer"
        for attempt in range(MAX_ATTEMPTS):
            try:
                response = self._client.post(self._url, headers=headers, json=payload)
            except httpx.HTTPError as exc:
                last = f"the model provider is unreachable: {exc}"
            else:
                if response.status_code < 400:
                    body = response.json()
                    return body if isinstance(body, dict) else {}
                # Only the status leaves this function, because the caller is a
                # relay that forwards what it gets toward a browser and the
                # provider's body can echo the request back. It goes to the LOG,
                # where the difference between a wrong model id, an unsupported
                # parameter and a malformed tool schema is readable.
                last = f"the model provider returned {response.status_code}"
                logger.warning("%s: %s", last, _redacted(response.text, self._api_key))
                if response.status_code not in RETRY_STATUS:
                    break
            if attempt < MAX_ATTEMPTS - 1:
                time.sleep(BACKOFF_SECONDS * (attempt + 1))
        raise _unavailable(last)

    def _tool_call(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, Any],
        tool_name: str,
    ) -> dict[str, Any]:
        """The one place a forced tool call is built and its answer is read.

        Both public entry points land here, so the truncation refusal and the
        tool-block extraction exist exactly once.
        """
        if not self.configured:
            raise ApiError(ErrorId.AI_NOT_CONFIGURED, "no model credential is configured", status_code=503)

        # `temperature` is sent only when an operator asks for it: current Claude
        # models answer HTTP 400 ("`temperature` is deprecated for this model").
        request: dict[str, Any] = {
            "model": self._model,
            "max_tokens": self._max_tokens,
            "system": system,
            "messages": messages,
            "tools": [{"name": tool_name, "description": "Return the result.", "input_schema": schema}],
            # Forced: without this the model may answer in prose and skip the
            # tool entirely, which reads here as "no result".
            "tool_choice": {"type": "tool", "name": tool_name},
        }
        if self._temperature is not None:
            request["temperature"] = self._temperature

        body = self._post(request)

        # A truncated answer is a failure, not a partial result: the tool input of
        # a max_tokens stop is cut mid-object and still validates.
        if body.get("stop_reason") == "max_tokens":
            raise _unavailable("the model's answer was truncated")

        for block in body.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                result = block.get("input")
                if isinstance(result, dict):
                    if not result:
                        # A forced tool call answered with `{}` passes every check
                        # here and reaches the caller as "the model said nothing",
                        # which each papers over with a fallback sentence. Only
                        # the shape of the answer is logged, no transcript.
                        logger.warning(
                            "the model answered the forced %s call with an empty input (stop_reason=%s)",
                            tool_name,
                            body.get("stop_reason"),
                        )
                    return result
        raise _unavailable("the model returned no structured result")

    def structured(
        self,
        *,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        tool_name: str,
    ) -> dict[str, Any]:
        """One user turn whose answer is the tool input, as a dict.

        `schema` is a JSON Schema object. It is the model's contract, not ours:
        the caller still checks that every id in the result is real.
        """
        return self._tool_call(
            system=system,
            messages=[{"role": "user", "content": prompt}],
            schema=schema,
            tool_name=tool_name,
        )

    def conversation(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, Any],
        tool_name: str,
    ) -> dict[str, Any]:
        """A whole transcript whose answer is the tool input, as a dict.

        Stateless: the caller posts every turn each time and nothing is kept here.
        Each message is copied down to `role` and `content`, so a caller cannot
        smuggle another Messages API field in on a transcript entry.
        """
        return self._tool_call(
            system=system,
            messages=[{"role": message["role"], "content": message["content"]} for message in messages],
            schema=schema,
            tool_name=tool_name,
        )

    def close(self) -> None:
        self._client.close()


@lru_cache
def get_llm_client() -> LlmClient:
    """One client, so the connection pool is shared across requests."""
    return LlmClient(get_settings())


def _parse_embedded(text: str) -> Any | None:
    """A list or object encoded inside a string, or None if it is neither.

    Two encodings, because both have turned up: JSON, and a Python repr with
    single quotes. literal_eval evaluates literals only, never a call.
    """
    for decode in (json.loads, ast.literal_eval):
        try:
            return decode(text)
        except (ValueError, SyntaxError, MemoryError, RecursionError):
            continue  # silent-ok: the caller logs the text once both decoders fail
    return None


def as_objects(value: Any) -> list[dict[str, Any]]:
    """A tool field that should be a list of objects, however it arrived.

    A forced tool call does not reliably deliver the declared type: an array field
    can arrive as a JSON string holding the array, or as a bare object where a
    list of one was meant. Untranslated, that reaches every caller's
    `isinstance(dict)` check as an empty list, which downstream is
    indistinguishable from "the model proposed nothing".
    """
    if isinstance(value, str):
        parsed = _parse_embedded(value)
        if parsed is None:
            # The text itself, so the next investigation does not need the pod.
            logger.warning("a tool field that should hold objects was unparseable: %s", value[:200])
            return []
        value = parsed
    if isinstance(value, dict):
        value = [value]
    if not isinstance(value, list):
        logger.warning("a tool field that should hold objects arrived as %s", type(value).__name__)
        return []

    objects: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, str):
            try:
                item = json.loads(item)
            except ValueError:
                logger.warning("dropped a tool list entry that was neither an object nor JSON text")
                continue
        if isinstance(item, dict):
            objects.append(item)
        else:
            logger.warning("dropped a tool list entry of type %s", type(item).__name__)
    return objects


def compact_json(value: Any) -> str:
    """Grounding lists go into the prompt as compact JSON.

    Pretty-printing a list of sixty queries spends a real fraction of the prompt
    budget on indentation.
    """
    return json.dumps(value, separators=(",", ":"), default=str)

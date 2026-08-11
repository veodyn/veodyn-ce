"""The one place this service talks to a model.

Structured output is a FORCED TOOL CALL, not a "reply with JSON" instruction.
Asking for prose-shaped JSON and parsing it is the alternative, and it breaks
the first time the model opens with "Here's the query you asked for:".

It buys a shape, not a guarantee. Observed in this deployment: an array field
answered with a JSON *string* holding the array, passed through the tool schema
untouched. So callers read tool fields through `as_objects()` rather than
trusting the declared type, and validate the contents themselves regardless.

Nothing here decides what is true. Every caller in services/ai_*.py validates
the model's output against real Redash ids before it goes anywhere, because a
schema guarantees shape and says nothing about grounding.
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

# Retried: the model provider is overloaded or the hop failed. A 400 is our own
# malformed request and a 401 is a bad key, and repeating either just spends the
# caller's wait on the same answer.
# 529 is Anthropic's own "overloaded", and it is the transient failure this
# client will see most often. Leaving it out made the most retryable status of
# all the one status that failed the request outright.
RETRY_STATUS = frozenset({408, 409, 429, 500, 502, 503, 504, 529})
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 1.5


def _unavailable(detail: str) -> ApiError:
    return ApiError(ErrorId.AI_PROVIDER_FAILED, detail, status_code=502)


def _redacted(body: str, api_key: str) -> str:
    """An error body safe to write to a log.

    Providers echo request material back on some error paths, and pod logs are
    read by more people and shipped to more places than the pod environment is.
    The key is removed rather than trusted not to be there.
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
                # Only the status ever leaves this function: the provider's own
                # body can echo the request back, and the caller of this service
                # is a relay that forwards what it gets toward a browser.
                #
                # But it goes to the LOG, because without it a 400 is
                # undiagnosable from outside the pod: "the model provider
                # returned 400" is true and useless, and the difference between
                # a wrong model id, an unsupported parameter and a malformed
                # tool schema is entirely in this body.
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
        tool-block extraction exist exactly once. A second copy of either is not
        a style problem: it is how a caller ends up shipping the tool input of a
        max_tokens stop, which is a half-written object that validates.
        """
        if not self.configured:
            raise ApiError(ErrorId.AI_NOT_CONFIGURED, "no model credential is configured", status_code=503)

        # `temperature` is sent only when an operator asks for it. Current
        # Claude models REJECT it outright ("`temperature` is deprecated for
        # this model", HTTP 400), so sending a default made every request fail
        # against the model this service is configured for. It stays available
        # because an instance pointed at an older model may still want it.
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

        # A truncated answer is a failure, not a partial result. The tool input
        # of a max_tokens stop is cut mid-object, and a half-written report
        # section would otherwise be validated and shipped as a draft.
        if body.get("stop_reason") == "max_tokens":
            raise _unavailable("the model's answer was truncated")

        for block in body.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                result = block.get("input")
                if isinstance(result, dict):
                    if not result:
                        # A forced tool call answered with `{}`. It is a dict, so
                        # it passes every check here and reaches the caller as
                        # "the model said nothing", which each caller then papers
                        # over with its own fallback sentence. Whatever the cause
                        # (a refusal, a schema the model would not fill in), it
                        # left no trace at all before this line: the reader sees
                        # a bland reply and the pod log is empty. No transcript
                        # material is logged, only the shape of the answer.
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

        The conversation is stateless on both sides: the caller posts every turn
        it has each time, and nothing is kept here between calls. Each message is
        copied down to `role` and `content` so a caller cannot smuggle another
        Messages API field (a tool_result block, a cache breakpoint) into the
        request by putting it on a transcript entry.
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
    single quotes. literal_eval is safe on arbitrary text (it evaluates
    literals only, never a call), so trying it costs nothing a caller can be
    hurt by.
    """
    for decode in (json.loads, ast.literal_eval):
        try:
            return decode(text)
        except (ValueError, SyntaxError, MemoryError, RecursionError):
            continue  # silent-ok: the caller logs the text once both decoders fail
    return None


def as_objects(value: Any) -> list[dict[str, Any]]:
    """A tool field that should be a list of objects, however it arrived.

    A forced tool call does not reliably deliver the declared type. A model can
    answer an array field with a JSON string holding the array, or with a bare
    object where a list of one was meant, and it arrives here as exactly that.

    The failure it caused was silent, which is why this exists: iterating the
    string yielded characters, every character failed the `isinstance(dict)`
    check each caller makes, and the result was an empty list. Downstream that
    is indistinguishable from "the model proposed nothing", so a report outline
    came back with a goal and no sections and looked like a modelling problem
    rather than a parsing one.
    """
    if isinstance(value, str):
        parsed = _parse_embedded(value)
        if parsed is None:
            # The text itself, not just the fact of it. "unparseable text" sent
            # the last round of this investigation back to the cluster to find
            # out what the model had actually said.
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

    Compact on purpose: pretty-printing a list of sixty queries spends a real
    fraction of the prompt on indentation.
    """
    return json.dumps(value, separators=(",", ":"), default=str)

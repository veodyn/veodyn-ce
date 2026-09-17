import base64
import copy
import hashlib
import hmac
import json
import time
from typing import Any

TOKEN_SECRET = "chat-token-secret"


def _part(value: dict[str, Any]) -> str:
    raw = json.dumps(value, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def sign(
    sub: str = "7",
    secret: str = TOKEN_SECRET,
    *,
    iat: float | None = None,
    exp: float | None = None,
    iss: str = "veodyn-app",
    aud: str = "veodyn-api",
    alg: str = "HS256",
) -> str:
    now = time.time() if iat is None else iat
    header = _part({"alg": alg, "typ": "JWT"})
    claims = _part(
        {"sub": sub, "iss": iss, "aud": aud, "iat": int(now), "exp": int(exp if exp is not None else now + 900)}
    )
    signing_input = f"{header}.{claims}".encode()
    signature = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{header}.{claims}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


class ScriptedChatModel:
    model_id = "scripted-model"

    def __init__(self, *turns: Any) -> None:
        self.turns = list(turns)
        self.calls: list[dict[str, Any]] = []

    async def run(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text: Any,
    ) -> Any:
        self.calls.append({"system": system, "messages": copy.deepcopy(messages), "tools": tools})
        if not self.turns:
            raise AssertionError("the model was called more times than the test scripted")
        turn = self.turns.pop(0)
        if isinstance(turn, BaseException):
            raise turn
        if callable(turn):
            turn = await turn()
        for block in turn.content:
            if block.get("type") == "text":
                await on_text(block["text"])
        return turn


def text_turn(text: str, stop_reason: str = "end_turn") -> Any:
    from veodyn_api.services.chat.driver import ModelTurn

    return ModelTurn(
        content=[{"type": "text", "text": text}],
        stop_reason=stop_reason,
        usage={"input_tokens": 3, "output_tokens": 5, "model": "scripted-model"},
    )


def tool_turn(call_id: str, name: str, arguments: dict[str, Any], text: str = "") -> Any:
    from veodyn_api.services.chat.driver import ModelTurn

    content: list[dict[str, Any]] = [{"type": "thinking", "thinking": "", "signature": f"sig-{call_id}"}]
    if text:
        content.append({"type": "text", "text": text})
    content.append({"type": "tool_use", "id": call_id, "name": name, "input": arguments})
    return ModelTurn(
        content=content,
        stop_reason="tool_use",
        usage={"input_tokens": 3, "output_tokens": 5, "model": "scripted-model"},
    )

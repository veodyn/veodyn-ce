import base64
import binascii
import hashlib
import hmac
import json
import time
from collections.abc import Sequence
from typing import Annotated, Any

from fastapi import Depends, Header

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.settings import Settings, get_settings

TOKEN_ISSUER = "veodyn-app"
TOKEN_AUDIENCE = "veodyn-api"
LEEWAY_SECONDS = 30


def _refused(reason: str) -> ApiError:
    return ApiError(ErrorId.UNAUTHENTICATED, f"the user token was not accepted: {reason}", status_code=401)


def _decode(part: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
    except (binascii.Error, ValueError) as exc:
        raise _refused("malformed") from exc


def _object(part: str) -> dict[str, Any]:
    try:
        value = json.loads(_decode(part))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise _refused("malformed") from exc
    if not isinstance(value, dict):
        raise _refused("malformed")
    return value


def _signature_matches(signing_input: bytes, signature: bytes, secrets: Sequence[str]) -> bool:
    matched = False
    for secret in secrets:
        if not secret:
            continue
        expected = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
        matched = hmac.compare_digest(expected, signature) or matched
    return matched


def verify_user_token(token: str, secrets: Sequence[str], now: float | None = None) -> str:
    parts = token.split(".")
    if len(parts) != 3:
        raise _refused("malformed")
    header, claims = _object(parts[0]), _object(parts[1])
    if header.get("alg") != "HS256":
        raise _refused("unsupported algorithm")
    if not _signature_matches(f"{parts[0]}.{parts[1]}".encode(), _decode(parts[2]), secrets):
        raise _refused("bad signature")
    if claims.get("iss") != TOKEN_ISSUER or claims.get("aud") != TOKEN_AUDIENCE:
        raise _refused("wrong issuer or audience")
    expires = claims.get("exp")
    current = time.time() if now is None else now
    if not isinstance(expires, int | float) or current > expires + LEEWAY_SECONDS:
        raise _refused("expired")
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise _refused("no subject")
    return subject


def require_subject(
    settings: Annotated[Settings, Depends(get_settings)],
    x_veodyn_user_token: Annotated[str | None, Header()] = None,
) -> str:
    if not settings.ai_token_secret:
        raise ApiError(ErrorId.AI_NOT_CONFIGURED, "chat is not configured on this instance", status_code=503)
    if not x_veodyn_user_token:
        raise _refused("missing")
    return verify_user_token(x_veodyn_user_token, [settings.ai_token_secret, settings.ai_token_secret_previous])


SubjectDep = Annotated[str, Depends(require_subject)]

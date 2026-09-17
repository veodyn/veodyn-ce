import base64
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

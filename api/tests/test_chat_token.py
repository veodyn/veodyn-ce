import time

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from tests.chat_stubs import TOKEN_SECRET, sign
from veodyn_api.auth_ai import require_subject, verify_user_token
from veodyn_api.errors import ApiError, ErrorId, register_error_handlers

NOW = 1_800_000_000.0


def test_a_valid_token_names_its_subject() -> None:
    assert verify_user_token(sign("42", iat=NOW), [TOKEN_SECRET], now=NOW) == "42"


def test_an_expired_token_is_refused() -> None:
    token = sign(iat=NOW - 2000, exp=NOW - 31)
    with pytest.raises(ApiError) as refused:
        verify_user_token(token, [TOKEN_SECRET], now=NOW)
    assert refused.value.error_id is ErrorId.UNAUTHENTICATED
    assert refused.value.status_code == 401


def test_expiry_within_the_leeway_is_accepted() -> None:
    assert verify_user_token(sign(iat=NOW - 900, exp=NOW - 29), [TOKEN_SECRET], now=NOW) == "7"


@pytest.mark.parametrize(
    "token",
    [
        sign(iat=NOW, aud="someone-else"),
        sign(iat=NOW, iss="someone-else"),
        sign(iat=NOW, secret="another-secret"),
        sign(iat=NOW, alg="none"),
        sign(iat=NOW, alg="HS512"),
        "not-a-token",
        "a.b.c",
        "",
    ],
)
def test_a_token_that_does_not_verify_is_refused(token: str) -> None:
    with pytest.raises(ApiError) as refused:
        verify_user_token(token, [TOKEN_SECRET], now=NOW)
    assert refused.value.status_code == 401


def test_the_previous_secret_still_verifies() -> None:
    assert verify_user_token(sign(secret="old", iat=NOW), [TOKEN_SECRET, "old"], now=NOW) == "7"


def test_a_token_without_a_subject_is_refused() -> None:
    token = sign("", iat=NOW)
    with pytest.raises(ApiError):
        verify_user_token(token, [TOKEN_SECRET], now=NOW)


def app_with_dependency() -> TestClient:
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/who")
    def who(subject: str = Depends(require_subject)) -> dict[str, str]:
        return {"subject": subject}

    return TestClient(app, raise_server_exceptions=False)


def test_the_dependency_reads_the_header(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VEODYN_AI_TOKEN_SECRET", TOKEN_SECRET)
    response = app_with_dependency().get("/who", headers={"x-veodyn-user-token": sign("9", iat=time.time())})
    assert response.status_code == 200
    assert response.json() == {"subject": "9"}


def test_the_dependency_refuses_a_missing_header(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VEODYN_AI_TOKEN_SECRET", TOKEN_SECRET)
    response = app_with_dependency().get("/who")
    assert response.status_code == 401
    assert response.json()["error"]["id"] == ErrorId.UNAUTHENTICATED.value


def test_the_dependency_is_unavailable_without_a_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VEODYN_AI_TOKEN_SECRET", raising=False)
    response = app_with_dependency().get("/who", headers={"x-veodyn-user-token": sign(iat=time.time())})
    assert response.status_code == 503
    assert response.json()["error"]["id"] == ErrorId.AI_NOT_CONFIGURED.value

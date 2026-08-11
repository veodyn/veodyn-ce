"""The community AI routes as the veodyn-de relay sees them.

The gate is unlike every other router here: there is no Redash session to
resolve, only a shared bearer, because the relay strips the browser cookie
before calling out. That makes the bearer the entire authorization story, so
most of these tests are about it.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.ai_stubs import FakeLlm
from tests.conftest import REDASH_TEST_URL
from veodyn_api.main import create_app
from veodyn_api.services.llm import get_llm_client

RELAY_KEY = "relay-secret"
AUTH = {"authorization": f"Bearer {RELAY_KEY}"}

DATASET = {
    "table": "historical.regional_speeds",
    "columns": [{"name": "captured_at", "type": "datetime"}, {"name": "speed_mph", "type": "float"}],
}
GENERATED = {"sql": "SELECT avg(speed_mph) FROM regional_speeds", "rationale": "averages the speed"}


@pytest.fixture
def llm() -> FakeLlm:
    return FakeLlm()


def build(db: Session, llm: FakeLlm, monkeypatch: pytest.MonkeyPatch, **env: str) -> TestClient:
    """The app with AI configured, Redash interceptable, and a stand-in model."""
    monkeypatch.setenv("VEODYN_REDASH_URL", REDASH_TEST_URL)
    monkeypatch.setenv("VEODYN_REDASH_SERVICE_API_KEY", "service-key")
    monkeypatch.setenv("VEODYN_AI_RELAY_KEY", RELAY_KEY)
    monkeypatch.setenv("VEODYN_AI_API_KEY", "model-key")
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    from veodyn_api.db import get_db
    from veodyn_api.settings import get_settings

    get_settings.cache_clear()
    app = create_app()

    def _override_db() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_llm_client] = lambda: llm
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def ai_api(db: Session, llm: FakeLlm, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    return build(db, llm, monkeypatch)


def test_a_request_with_no_credential_is_refused(ai_api: TestClient, llm: FakeLlm) -> None:
    response = ai_api.post("/ai/generate-sql", json={"prompt": "x", "dataset": DATASET})

    assert response.status_code == 401
    assert llm.calls == 0


def test_a_request_with_the_wrong_bearer_is_refused(ai_api: TestClient, llm: FakeLlm) -> None:
    headers = {"authorization": "Bearer not-the-key"}

    response = ai_api.post("/ai/generate-sql", json={"prompt": "x", "dataset": DATASET}, headers=headers)

    assert response.status_code == 401
    assert llm.calls == 0


def test_an_instance_with_no_relay_key_answers_unavailable_rather_than_open(
    db: Session, llm: FakeLlm, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A deployment that forgot the key must not become one with an open
    generation endpoint that anyone on the network can spend the model quota on."""
    api = build(db, llm, monkeypatch, VEODYN_AI_RELAY_KEY="")

    response = api.post("/ai/generate-sql", json={"prompt": "x", "dataset": DATASET}, headers=AUTH)

    assert response.status_code == 503
    assert response.json()["error"]["id"] == "VEODYN_AI_NOT_CONFIGURED"
    assert llm.calls == 0


def test_an_instance_with_no_model_key_answers_unavailable(
    db: Session, llm: FakeLlm, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = build(db, llm, monkeypatch, VEODYN_AI_API_KEY="")

    response = api.post("/ai/generate-sql", json={"prompt": "x", "dataset": DATASET}, headers=AUTH)

    assert response.status_code == 503


def test_generate_sql_answers_the_two_fields_the_relay_accepts(ai_api: TestClient, llm: FakeLlm) -> None:
    """The relay's schema is exact: `sql` and `rationale`, nothing else. An extra
    field is refused rather than stripped, so the response is a 502 to the user."""
    llm.answers.append(GENERATED)

    response = ai_api.post("/ai/generate-sql", json={"prompt": "average speed", "dataset": DATASET}, headers=AUTH)

    assert response.status_code == 200
    assert response.json() == GENERATED

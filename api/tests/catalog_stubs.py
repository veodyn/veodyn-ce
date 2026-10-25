"""Shared material for the AI grounding and chat test modules.

A helper module rather than a conftest addition, the same way ai_stubs.py and
kpi_stubs.py are: conftest.py is the controller's, and a fixture only two
modules use does not belong to every test run.
"""

from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tests.ai_stubs import FakeLlm
from tests.conftest import REDASH_TEST_URL
from veodyn_api.main import create_app
from veodyn_api.schemas.catalog import DatasetColumnOut, DatasetCoverageOut, DatasetFreshnessOut, DatasetOut
from veodyn_api.services.ai_grounding import GroundedQuery
from veodyn_api.services.llm import compact_json, get_llm_client
from veodyn_api.settings import Settings

RELAY_KEY = "relay-secret"
AUTH = {"authorization": f"Bearer {RELAY_KEY}"}


def mock_data_sources(*named: tuple[int, str]) -> None:
    """The lookup that labels each grounded query with the source it reads.

    Every test that lets the route or build_grounding assemble a real query list
    needs this now, because a strict respx mock refuses the call rather than
    letting it fail the way a real outage would.
    """
    respx.get(f"{REDASH_TEST_URL}/api/data_sources").mock(
        return_value=httpx.Response(200, json=[{"id": one, "name": name, "type": "clickhouse"} for one, name in named])
    )


QUERIES = (
    GroundedQuery(id=11, name="Speeds by corridor", description="", tags=[], updated_at="2026-07-20"),
    GroundedQuery(id=12, name="Boardings by stop", description="", tags=[], updated_at="2026-07-19"),
)

SPEEDS = DatasetOut(
    id="regional_speeds",
    name="Regional speeds",
    description="Captured from Redash query 11.",
    domain=None,
    schema=[
        DatasetColumnOut(name="captured_at", type="DateTime"),
        DatasetColumnOut(name="speed_mph", type="Float64"),
    ],
    freshness=DatasetFreshnessOut(last_updated_at="2026-07-27T00:00:00Z", status="fresh"),
    coverage=DatasetCoverageOut(start="", end=""),
    row_count=10,
    sources=[],
    tags=[],
    sample_query_id=11,
)


class FakeChatLlm(FakeLlm):
    """FakeLlm plus the multi-message entry point.

    tests/ai_stubs.py is shared by every AI test module and is not this task's
    to change, so conversation() lives here. It draws from the same answer queue
    as structured(), which is what lets one test queue the converse answer and
    then the generate_sql answers the query path goes on to ask for.
    """

    def __init__(self, *answers: dict[str, Any]) -> None:
        super().__init__(*answers)
        self.transcripts: list[list[dict[str, str]]] = []
        # Recorded here rather than in FakeLlm for the same reason conversation()
        # is. What the model was ASKED for is the whole point of the no-reply
        # follow-up, which asks again with a narrower shape than the first call.
        self.schemas: list[dict[str, Any]] = []

    def conversation(
        self, *, system: str, messages: list[dict[str, str]], schema: dict[str, Any], tool_name: str
    ) -> dict[str, Any]:
        self.transcripts.append(messages)
        self.schemas.append(schema)
        return self.structured(system=system, prompt=compact_json(messages), schema=schema, tool_name=tool_name)


def grounding_settings() -> Settings:
    return Settings(redash_url=REDASH_TEST_URL, ai_max_grounded_queries=60)


def build(llm: FakeChatLlm, monkeypatch: pytest.MonkeyPatch, **env: str) -> TestClient:
    """The app with AI configured and a stand-in model.

    No database override: the AI routes here have no DbDep, so a test of it does not
    need Postgres to be up.
    """
    monkeypatch.setenv("VEODYN_REDASH_URL", REDASH_TEST_URL)
    monkeypatch.setenv("VEODYN_REDASH_SERVICE_API_KEY", "service-key")
    monkeypatch.setenv("VEODYN_AI_RELAY_KEY", RELAY_KEY)
    monkeypatch.setenv("VEODYN_AI_API_KEY", "model-key")
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    from veodyn_api.settings import get_settings

    get_settings.cache_clear()
    app = create_app()
    app.dependency_overrides[get_llm_client] = lambda: llm
    return TestClient(app, raise_server_exceptions=False)

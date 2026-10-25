from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.catalog_stubs import SPEEDS
from tests.test_chat_routes import Harness, headers
from veodyn_api.routers import ai_chat
from veodyn_api.schemas.catalog import DatasetOut

WAREHOUSE = 5
SQL = "SELECT avg(speed_mph) FROM regional_speeds"
WAREHOUSE_SOURCE = {"id": WAREHOUSE, "name": "Warehouse", "type": "clickhouse", "syntax": "sql", "viewOnly": False}
JSON_SOURCE = {"id": 3, "name": "Feed", "type": "json", "syntax": "json", "viewOnly": False}
RUN = {"datasetTable": "regional_speeds", "sql": SQL}
PROPOSE = {"name": "Average speed", "datasetTable": "regional_speeds", "sql": SQL, "vizChoiceId": "table"}


def warehouse_context(*extra: dict[str, Any]) -> dict[str, Any]:
    return {"dataSources": [WAREHOUSE_SOURCE, *extra]}


class Mcp:
    def __init__(self, harness: Harness) -> None:
        self.harness = harness
        self.client: TestClient = harness.client

    @property
    def app(self) -> FastAPI:
        return self.client.app  # type: ignore[return-value]

    def tools(
        self, chat_enabled: bool = True, subject: str = "7", instance: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        body: dict[str, Any] = {"chatEnabled": chat_enabled}
        if instance is not None:
            body["instance"] = instance
        response = self.client.post("/ai/chat/mcp/tools", json=body, headers=headers(subject))
        assert response.status_code == 200, response.text
        return list(response.json()["tools"])

    def call(
        self,
        name: str,
        arguments: dict[str, Any],
        context: dict[str, Any] | None = None,
        subject: str = "7",
        expect: int = 200,
    ) -> dict[str, Any]:
        response = self.client.post(
            "/ai/chat/mcp/calls",
            json={
                "name": name,
                "arguments": arguments,
                "context": warehouse_context() if context is None else context,
            },
            headers=headers(subject),
        )
        assert response.status_code == expect, response.text
        return dict(response.json())

    def result(self, call_id: str, result: dict[str, Any], subject: str = "7", expect: int = 200) -> dict[str, Any]:
        response = self.client.post(
            f"/ai/chat/mcp/calls/{call_id}/result", json={"result": result}, headers=headers(subject)
        )
        assert response.status_code == expect, response.text
        return dict(response.json())

    def thread(self, thread_id: str, subject: str = "7") -> dict[str, Any]:
        response = self.client.get(f"/ai/chat/threads/{thread_id}", headers=headers(subject))
        assert response.status_code == 200, response.text
        return dict(response.json())


@pytest.fixture
def mcp(harness: Harness) -> Iterator[Mcp]:
    async def datasets() -> tuple[DatasetOut, ...]:
        return (SPEEDS,)

    async def data_source_id() -> int:
        return WAREHOUSE

    surface = Mcp(harness)
    surface.app.dependency_overrides[ai_chat.get_warehouse_loaders] = lambda: (datasets, data_source_id)
    yield surface

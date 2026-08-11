from fastapi import APIRouter
from fastapi.testclient import TestClient

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.main import create_app


def test_api_error_renders_the_envelope() -> None:
    router = APIRouter()

    @router.get("/boom")
    def boom() -> None:
        raise ApiError(ErrorId.KPI_NOT_FOUND, "no such kpi", status_code=404)

    app = create_app()
    app.include_router(router)
    response = TestClient(app, raise_server_exceptions=False).get("/boom")

    assert response.status_code == 404
    assert response.json() == {"error": {"id": "VEODYN_KPI_NOT_FOUND", "message": "no such kpi"}}


def test_request_validation_uses_the_same_envelope() -> None:
    router = APIRouter()

    @router.get("/needs-int")
    def needs_int(value: int) -> None:
        return None

    app = create_app()
    app.include_router(router)
    response = TestClient(app, raise_server_exceptions=False).get("/needs-int?value=abc")

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_INVALID_REQUEST"
    assert "value" in response.json()["error"]["message"]

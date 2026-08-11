from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from veodyn_api.errors import ApiError, ErrorId, register_error_handlers
from veodyn_api.settings import Settings
from veodyn_api.telemetry import capture_api_error, reset_client, telemetry_enabled


@pytest.fixture(autouse=True)
def _reset() -> None:
    reset_client()


class Recording:
    """Stands in for the PostHog client, which this service should never need
    running to be testable."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def capture_exception(self, exception: BaseException, **kwargs: Any) -> None:
        self.calls.append({"exception": exception, **kwargs})


class Exploding:
    def capture_exception(self, exception: BaseException, **kwargs: Any) -> None:
        raise RuntimeError("posthog exploded")


def test_disabled_without_a_key() -> None:
    assert telemetry_enabled(Settings(posthog_host="https://ph.example")) is False


def test_disabled_without_a_host() -> None:
    assert telemetry_enabled(Settings(posthog_key="phc_x")) is False


def test_disabled_by_the_kill_switch() -> None:
    settings = Settings(posthog_key="phc_x", posthog_host="https://ph.example", disable_telemetry=True)
    assert telemetry_enabled(settings) is False


def test_enabled_with_both() -> None:
    assert telemetry_enabled(Settings(posthog_key="phc_x", posthog_host="https://ph.example")) is True


def test_capture_is_a_noop_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    # No key configured, so _client() returns None and nothing is sent. This is
    # the prod posture: the same image, dark.
    monkeypatch.setattr("veodyn_api.telemetry.get_settings", lambda: Settings())
    capture_api_error(7, RuntimeError("boom"), {"route": "/kpis"})


def test_capture_swallows_a_posthog_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("veodyn_api.telemetry._client", lambda: Exploding())
    # Fail-open: a telemetry failure must never become the caller's problem.
    capture_api_error(7, RuntimeError("boom"), {"route": "/kpis"})


def test_capture_sends_the_actor_and_error_id(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = Recording()
    monkeypatch.setattr("veodyn_api.telemetry._client", lambda: recorder)
    error = ApiError(ErrorId.REDASH_UNREACHABLE, "down", status_code=502)
    capture_api_error(7, error, {"route": "/kpis"})
    assert recorder.calls[0]["distinct_id"] == "7"
    assert recorder.calls[0]["properties"] == {
        "route": "/kpis",
        "errorId": "VEODYN_REDASH_UNREACHABLE",
    }


def test_capture_falls_back_to_anonymous(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder = Recording()
    monkeypatch.setattr("veodyn_api.telemetry._client", lambda: recorder)
    capture_api_error(None, RuntimeError("boom"), {})
    assert recorder.calls[0]["distinct_id"] == "anonymous"
    assert recorder.calls[0]["properties"] == {"errorId": ""}


def _app_with(monkeypatch: pytest.MonkeyPatch, captured: list[BaseException]) -> FastAPI:
    monkeypatch.setattr(
        "veodyn_api.telemetry.capture_api_error",
        lambda actor, err, props: captured.append(err),
    )
    app = FastAPI()
    register_error_handlers(app)
    return app


def test_unhandled_exception_answers_an_envelope_and_captures(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[BaseException] = []
    app = _app_with(monkeypatch, captured)

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("unexpected")

    response = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert response.status_code == 500
    # One envelope shape for every failure the caller sees, 500 included.
    assert response.json()["error"]["id"] == "VEODYN_INTERNAL_ERROR"
    assert len(captured) == 1


def test_a_4xx_refusal_is_not_captured(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[BaseException] = []
    app = _app_with(monkeypatch, captured)

    @app.get("/refused")
    def refused() -> None:
        raise ApiError(ErrorId.KPI_NOT_FOUND, "no such kpi", status_code=404)

    assert TestClient(app, raise_server_exceptions=False).get("/refused").status_code == 404
    # A deliberate refusal is not an incident.
    assert captured == []


def test_a_5xx_api_error_is_captured(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[BaseException] = []
    app = _app_with(monkeypatch, captured)

    @app.get("/upstream")
    def upstream() -> None:
        raise ApiError(ErrorId.REDASH_UNREACHABLE, "down", status_code=502)

    assert TestClient(app, raise_server_exceptions=False).get("/upstream").status_code == 502
    assert len(captured) == 1

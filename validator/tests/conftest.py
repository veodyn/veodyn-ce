from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest

from validator_service import fetch

PUBLIC_ADDRESS = "93.184.216.34"


class _RestoreHostTransport(httpx.BaseTransport):
    def __init__(self) -> None:
        self._inner = httpx.HTTPTransport()

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        host = request.headers.get("host", "").rsplit(":", 1)[0]
        if request.url.host == PUBLIC_ADDRESS and host:
            request.url = request.url.copy_with(host=host)
        return self._inner.handle_request(request)

    def close(self) -> None:
        self._inner.close()


@pytest.fixture(autouse=True)
def public_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    def resolve(host: str, port: int) -> list[str]:
        return [PUBLIC_ADDRESS]

    factory: Callable[[], httpx.BaseTransport] = _RestoreHostTransport
    monkeypatch.setattr(fetch, "system_resolver", resolve)
    monkeypatch.setattr(fetch, "default_transport_factory", factory)

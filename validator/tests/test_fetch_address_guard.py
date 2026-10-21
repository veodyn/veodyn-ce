from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from validator_service.fetch import StaticFetchError, download

MAX_BYTES = 10_000_000


def resolver_for(mapping: dict[str, list[str]]):
    def resolve(host: str, port: int) -> list[str]:
        return mapping[host]

    return resolve


def run(
    tmp_path: Path,
    url: str,
    mapping: dict[str, list[str]],
    handler,
) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    download(
        url,
        tmp_path / "out.zip",
        timeout=5.0,
        max_bytes=MAX_BYTES,
        resolver=resolver_for(mapping),
        transport_factory=lambda: httpx.MockTransport(recording),
    )
    return seen


def ok(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, content=b"zip")


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "172.16.3.4",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "224.0.0.1",
        "0.0.0.0",
        "240.0.0.1",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
    ],
)
def test_non_global_address_is_refused_without_a_request(tmp_path: Path, address: str) -> None:
    with pytest.raises(StaticFetchError, match="non-public address"):
        seen = run(tmp_path, "https://agency.example/gtfs.zip", {"agency.example": [address]}, ok)
        assert seen == []


def test_any_non_global_address_among_several_refuses(tmp_path: Path) -> None:
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return ok(request)

    with pytest.raises(StaticFetchError, match="non-public address"):
        run(tmp_path, "https://agency.example/gtfs.zip", {"agency.example": ["93.184.216.34", "10.0.0.1"]}, handler)
    assert sent == []


@pytest.mark.parametrize(
    "url", ["ftp://agency.example/gtfs.zip", "file:///etc/passwd", "https:///gtfs.zip", "gtfs.zip"]
)
def test_bad_scheme_or_missing_host_is_refused(tmp_path: Path, url: str) -> None:
    with pytest.raises(StaticFetchError):
        run(tmp_path, url, {}, ok)


@pytest.mark.parametrize(
    "url", ["http://127.0.0.1/gtfs.zip", "http://[::1]/gtfs.zip", "http://169.254.169.254/latest"]
)
def test_literal_internal_address_is_refused(tmp_path: Path, url: str) -> None:
    with pytest.raises(StaticFetchError, match="non-public address"):
        run(tmp_path, url, {}, ok)


def test_redirect_to_private_host_is_refused_after_one_request(tmp_path: Path) -> None:
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(302, headers={"location": "http://internal.example/secret"})

    mapping = {"agency.example": ["93.184.216.34"], "internal.example": ["10.1.2.3"]}
    with pytest.raises(StaticFetchError, match="non-public address"):
        run(tmp_path, "https://agency.example/gtfs.zip", mapping, handler)
    assert len(sent) == 1


def test_redirect_to_metadata_literal_is_refused(tmp_path: Path) -> None:
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(301, headers={"location": "http://169.254.169.254/latest/meta-data"})

    with pytest.raises(StaticFetchError, match="non-public address"):
        run(tmp_path, "https://agency.example/gtfs.zip", {"agency.example": ["93.184.216.34"]}, handler)
    assert len(sent) == 1


def test_redirect_to_public_host_is_followed(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "agency.example":
            return httpx.Response(302, headers={"location": "https://cdn.example/real.zip"})
        return httpx.Response(200, content=b"zip")

    mapping = {"agency.example": ["93.184.216.34"], "cdn.example": ["93.184.216.35"]}
    seen = run(tmp_path, "https://agency.example/gtfs.zip", mapping, handler)
    assert [r.url.host for r in seen] == ["93.184.216.34", "93.184.216.35"]
    assert [r.headers["host"] for r in seen] == ["agency.example", "cdn.example"]
    assert (tmp_path / "out.zip").read_bytes() == b"zip"


def test_redirect_loop_is_capped_at_five_hops(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://agency.example/again"})

    sent: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return handler(request)

    with pytest.raises(StaticFetchError, match="redirect"):
        download(
            "https://agency.example/gtfs.zip",
            tmp_path / "out.zip",
            timeout=5.0,
            max_bytes=MAX_BYTES,
            resolver=resolver_for({"agency.example": ["93.184.216.34"]}),
            transport_factory=lambda: httpx.MockTransport(recording),
        )
    assert len(sent) == 6


def test_connection_target_is_the_validated_ip_with_host_and_sni(tmp_path: Path) -> None:
    seen = run(tmp_path, "https://agency.example:8443/gtfs.zip?x=1", {"agency.example": ["93.184.216.34"]}, ok)
    (request,) = seen
    assert request.url.host == "93.184.216.34"
    assert request.url.port == 8443
    assert request.url.scheme == "https"
    assert request.url.path == "/gtfs.zip"
    assert request.url.query == b"x=1"
    assert request.headers["host"] == "agency.example:8443"
    assert request.headers["connection"] == "close"
    assert request.extensions["sni_hostname"] == "agency.example"
    assert "cookie" not in request.headers


def test_default_port_is_left_out_of_the_host_header(tmp_path: Path) -> None:
    (request,) = run(tmp_path, "https://agency.example/gtfs.zip", {"agency.example": ["93.184.216.34"]}, ok)
    assert request.headers["host"] == "agency.example"


def test_ipv6_target_is_bracketed(tmp_path: Path) -> None:
    (request,) = run(tmp_path, "https://agency.example/gtfs.zip", {"agency.example": ["2606:2800:220:1::1"]}, ok)
    assert request.url.host == "2606:2800:220:1::1"
    assert str(request.url).startswith("https://[2606:2800:220:1::1]/")


def test_connect_failure_falls_back_to_the_next_address(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "93.184.216.34":
            raise httpx.ConnectError("refused")
        return httpx.Response(200, content=b"zip")

    mapping = {"agency.example": ["93.184.216.34", "93.184.216.35"]}
    seen = run(tmp_path, "https://agency.example/gtfs.zip", mapping, handler)
    assert [r.url.host for r in seen] == ["93.184.216.34", "93.184.216.35"]


def test_all_addresses_failing_raises_static_fetch_error(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow")

    mapping = {"agency.example": ["93.184.216.34", "93.184.216.35"]}
    with pytest.raises(StaticFetchError):
        run(tmp_path, "https://agency.example/gtfs.zip", mapping, handler)


def test_oversized_body_still_refused(tmp_path: Path) -> None:
    with pytest.raises(StaticFetchError, match="size limit"):
        download(
            "https://agency.example/gtfs.zip",
            tmp_path / "out.zip",
            timeout=5.0,
            max_bytes=2,
            resolver=resolver_for({"agency.example": ["93.184.216.34"]}),
            transport_factory=lambda: httpx.MockTransport(ok),
        )


def test_unresolvable_host_raises_static_fetch_error(tmp_path: Path) -> None:
    def resolve(host: str, port: int) -> list[str]:
        raise OSError("no such host")

    with pytest.raises(StaticFetchError):
        download(
            "https://agency.example/gtfs.zip",
            tmp_path / "out.zip",
            timeout=5.0,
            max_bytes=MAX_BYTES,
            resolver=resolve,
            transport_factory=lambda: httpx.MockTransport(ok),
        )

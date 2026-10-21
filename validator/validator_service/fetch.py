"""Fetching a static GTFS archive over HTTP and handing it to the validator.

`gtfs_rt_validator.api.prepare_feed` only reads a `pathlib.Path`, so the
`gtfs` URL a `/validate` request names is downloaded to a temporary file
first. The `PreparedFeed` it returns has already copied every row it needs out
of the archive (see `PreparedFeed`'s own docstring in the package: "a context
outlives the archive"), so the temporary file is removed before this function
returns rather than kept alive alongside the feed it built.
"""

from __future__ import annotations

import ipaddress
import socket
import tempfile
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urljoin

import httpx
from gtfs_rt_validator.api import Mode, PreparedFeed, StaticLoadError, prepare_feed


class StaticFetchError(Exception):
    """The static archive could not be fetched, or fetched but not loaded.

    Both are the agency's static reference being unusable rather than
    anything wrong with the `/validate` request itself, so the router answers
    502 for either: this project's problem is reaching the archive, not the
    caller's request shape.
    """


def fetch_and_prepare(url: str, *, timeout: float, max_bytes: int) -> PreparedFeed:
    """Download `url` and prepare it for repeated validation, in modern mode.

    Raises `StaticFetchError` for a transport failure, an oversized response,
    or an archive that will not load; nothing else escapes this function.
    """
    with tempfile.TemporaryDirectory(prefix="validator-static-") as tmp_dir:
        archive_path = Path(tmp_dir) / "gtfs.zip"
        download(url, archive_path, timeout=timeout, max_bytes=max_bytes)
        try:
            return prepare_feed(archive_path, mode=Mode.MODERN)
        except StaticLoadError as exc:
            raise StaticFetchError(f"{url} downloaded but could not be loaded as GTFS: {exc}") from exc


Resolver = Callable[[str, int], list[str]]
TransportFactory = Callable[[], httpx.BaseTransport]

MAX_REDIRECTS = 5
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
DEFAULT_PORTS = {"http": 80, "https": 443}


def system_resolver(host: str, port: int) -> list[str]:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


def default_transport_factory() -> httpx.BaseTransport:
    return httpx.HTTPTransport()


def is_public(address: str) -> bool:
    parsed = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped is not None:
        parsed = parsed.ipv4_mapped
    return parsed.is_global and not parsed.is_multicast


def ascii_host(url: httpx.URL) -> str:
    return url.raw_host.decode("ascii")


def validated_addresses(url: httpx.URL, resolver: Resolver) -> list[str]:
    if url.scheme not in DEFAULT_PORTS or not url.host:
        raise StaticFetchError(f"refusing {url}: only http and https URLs with a host are fetched")
    port = url.port or DEFAULT_PORTS[url.scheme]
    try:
        ipaddress.ip_address(ascii_host(url))
        addresses = [ascii_host(url)]
    except ValueError:
        try:
            addresses = resolver(ascii_host(url), port)
        except OSError as exc:
            raise StaticFetchError(f"could not resolve {url.host}: {exc}") from exc
    if not addresses:
        raise StaticFetchError(f"{url.host} did not resolve to any address")
    for address in addresses:
        if not is_public(address):
            raise StaticFetchError(f"refusing {url.host}: it resolves to the non-public address {address}")
    return addresses


def host_header(url: httpx.URL) -> str:
    name = ascii_host(url)
    host = f"[{name}]" if ":" in name else name
    return f"{host}:{url.port}" if url.port is not None else host


def pinned_request_url(url: httpx.URL, address: str) -> httpx.URL:
    return url.copy_with(host=address)


def download(
    url: str,
    destination: Path,
    *,
    timeout: float,
    max_bytes: int,
    resolver: Resolver | None = None,
    transport_factory: TransportFactory | None = None,
) -> None:
    resolve = resolver or system_resolver
    make_transport = transport_factory or default_transport_factory
    cookies = httpx.Cookies()
    try:
        current = httpx.URL(url)
        for _ in range(MAX_REDIRECTS + 1):
            addresses = validated_addresses(current, resolve)
            redirect = fetch_hop(current, addresses, destination, timeout, max_bytes, make_transport, cookies)
            if redirect is None:
                return
            try:
                current = httpx.URL(urljoin(str(current), redirect))
            except ValueError as exc:
                raise StaticFetchError(f"{url} redirected to a malformed location: {redirect!r}") from exc
        raise StaticFetchError(f"{url} redirected more than {MAX_REDIRECTS} times")
    except (httpx.HTTPError, httpx.InvalidURL) as exc:
        raise StaticFetchError(f"could not fetch {url}: {exc}") from exc


def fetch_hop(
    url: httpx.URL,
    addresses: list[str],
    destination: Path,
    timeout: float,
    max_bytes: int,
    make_transport: TransportFactory,
    cookies: httpx.Cookies,
) -> str | None:
    last_error: httpx.TransportError | None = None
    for address in addresses:
        try:
            return fetch_from_address(url, address, destination, timeout, max_bytes, make_transport, cookies)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            last_error = exc
    assert last_error is not None
    raise last_error


def fetch_from_address(
    url: httpx.URL,
    address: str,
    destination: Path,
    timeout: float,
    max_bytes: int,
    make_transport: TransportFactory,
    cookies: httpx.Cookies,
) -> str | None:
    named_request = httpx.Request("GET", url)
    cookies.set_cookie_header(named_request)
    headers = {"Host": host_header(url), "Connection": "close"}
    if "cookie" in named_request.headers:
        headers["Cookie"] = named_request.headers["cookie"]
    extensions = {"sni_hostname": ascii_host(url)}
    with httpx.Client(transport=make_transport(), timeout=timeout, follow_redirects=False, trust_env=False) as client:
        with client.stream(
            "GET", pinned_request_url(url, address), headers=headers, extensions=extensions
        ) as response:
            cookies.extract_cookies(
                httpx.Response(response.status_code, headers=response.headers, request=named_request)
            )
            location: str | None = response.headers.get("location")
            if response.status_code in REDIRECT_STATUSES and location:
                return location
            response.raise_for_status()
            total = 0
            with destination.open("wb") as out:
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise StaticFetchError(f"{url} exceeded the {max_bytes} byte archive size limit")
                    out.write(chunk)
            return None

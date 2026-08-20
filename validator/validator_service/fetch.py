"""Fetching a static GTFS archive over HTTP and handing it to the validator.

`gtfs_rt_validator.api.prepare_feed` only reads a `pathlib.Path`, so the
`gtfs` URL a `/validate` request names is downloaded to a temporary file
first. The `PreparedFeed` it returns has already copied every row it needs out
of the archive (see `PreparedFeed`'s own docstring in the package: "a context
outlives the archive"), so the temporary file is removed before this function
returns rather than kept alive alongside the feed it built.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

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


def download(url: str, destination: Path, *, timeout: float, max_bytes: int) -> None:
    """Download `url` to `destination`. Raises `StaticFetchError` on any
    transport failure, a malformed URL, a non-2xx response, or a response
    exceeding `max_bytes` (checked with a running counter as bytes arrive, not
    from a possibly-absent or lying Content-Length header). Shared by
    `fetch_and_prepare` above and by the `/validate-static` route, which needs
    the raw archive rather than a `PreparedFeed`.

    `httpx.InvalidURL` is caught alongside `httpx.HTTPError`: it is raised
    while parsing a malformed URL like `http://[::1` and is not part of the
    `HTTPError` hierarchy, so it would otherwise escape as an unhandled 500.
    """
    try:
        with httpx.stream("GET", url, timeout=timeout, follow_redirects=True) as response:
            response.raise_for_status()
            total = 0
            with destination.open("wb") as out:
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise StaticFetchError(f"{url} exceeded the {max_bytes} byte archive size limit")
                    out.write(chunk)
    except (httpx.HTTPError, httpx.InvalidURL) as exc:
        raise StaticFetchError(f"could not fetch {url}: {exc}") from exc

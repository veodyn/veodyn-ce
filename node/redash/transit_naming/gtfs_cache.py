import fcntl
import hashlib
import io
import os
import time
import zipfile
from dataclasses import dataclass

import requests

from redash.query_runner.connector_base import REQUEST_HEADERS
from redash.query_runner.gtfs_realtime_transport import sanitize_feed_url
from redash.query_runner.gtfs_static_tables import check_archive_bounds

RETRY_AFTER_SECONDS = 600


@dataclass(frozen=True)
class CachedArchive:
    content: bytes
    digest: str
    stale: bool
    refresh_error: str


def http_fetch(url, max_bytes, timeout=60):
    safe_url = sanitize_feed_url(url)
    response = requests.get(url, timeout=timeout, stream=True, headers=REQUEST_HEADERS)
    response.raise_for_status()
    chunks = []
    total = 0
    for chunk in response.iter_content(chunk_size=65536):
        total += len(chunk)
        if total > max_bytes:
            raise ValueError(f"GTFS archive from {safe_url} exceeds the {max_bytes} byte limit")
        chunks.append(chunk)
    return b"".join(chunks)


def _paths(url, cache_dir):
    stem = os.path.join(cache_dir, hashlib.sha256(url.encode("utf-8")).hexdigest()[:16])
    return stem + ".zip", stem + ".sha256", stem + ".lock", stem + ".failed"


def _read_valid(zip_path, digest_path):
    if not os.path.exists(zip_path) or not os.path.exists(digest_path):
        return None, ""
    with open(zip_path, "rb") as handle:
        content = handle.read()
    with open(digest_path, "r", encoding="utf-8") as handle:
        recorded = handle.read().strip()
    if hashlib.sha256(content).hexdigest() != recorded or not zipfile.is_zipfile(zip_path):
        os.remove(zip_path)
        os.remove(digest_path)
        return None, ""
    return content, recorded


def _write(zip_path, digest_path, content, digest):
    for path, data in ((zip_path, content), (digest_path, digest.encode("utf-8"))):
        temp = path + ".tmp"
        with open(temp, "wb") as handle:
            handle.write(data)
        os.replace(temp, path)


def _last_failure(failed_path):
    if not os.path.exists(failed_path):
        return None
    with open(failed_path, "r", encoding="utf-8") as handle:
        text = handle.read().strip()
    return float(text) if text else None


def _describe(error, url, safe_url):
    return f"{type(error).__name__}: {str(error).replace(url, safe_url)}"


def _download(url, safe_url, max_bytes, fetch, validate):
    downloaded = fetch(url, max_bytes)
    if len(downloaded) > max_bytes:
        raise ValueError(f"GTFS archive from {safe_url} exceeds the {max_bytes} byte limit")
    if not zipfile.is_zipfile(io.BytesIO(downloaded)):
        raise ValueError(f"GTFS archive from {safe_url} is not a readable zip")
    check_archive_bounds(zipfile.ZipFile(io.BytesIO(downloaded)), safe_url)
    if validate is not None:
        validate(downloaded)
    return downloaded


def cached_archive(url, cache_dir, max_age_hours, max_bytes, fetch, now=None, validate=None):
    clock = now or time.time
    safe_url = sanitize_feed_url(url)
    os.makedirs(cache_dir, exist_ok=True)
    zip_path, digest_path, lock_path, failed_path = _paths(url, cache_dir)
    with open(lock_path, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            content, digest = _read_valid(zip_path, digest_path)
            if content is not None and clock() - os.path.getmtime(zip_path) < max_age_hours * 3600:
                return CachedArchive(content, digest, False, "")
            failed_at = _last_failure(failed_path)
            if content is not None and failed_at is not None and clock() - failed_at < RETRY_AFTER_SECONDS:
                return CachedArchive(content, digest, True, f"gtfs_refresh_failed {safe_url}: retry deferred")
            try:
                downloaded = _download(url, safe_url, max_bytes, fetch, validate)
            except Exception as error:
                with open(failed_path, "w", encoding="utf-8") as handle:
                    handle.write(str(clock()))
                detail = _describe(error, url, safe_url)
                if content is not None:
                    return CachedArchive(content, digest, True, f"gtfs_refresh_failed {safe_url}: {detail}")
                raise ValueError(
                    f"GTFS download from {safe_url} failed and no cached copy exists: {detail}"
                ) from error
            new_digest = hashlib.sha256(downloaded).hexdigest()
            _write(zip_path, digest_path, downloaded, new_digest)
            os.utime(zip_path, (clock(), clock()))
            if os.path.exists(failed_path):
                os.remove(failed_path)
            return CachedArchive(downloaded, new_digest, False, "")
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)

import fcntl
import hashlib
import os
import time
import zipfile
from dataclasses import dataclass

import requests

from redash.query_runner.connector_base import REQUEST_HEADERS


@dataclass(frozen=True)
class CachedArchive:
    content: bytes
    digest: str
    stale: bool
    refresh_error: str


def http_fetch(url, max_bytes, timeout=60):
    response = requests.get(url, timeout=timeout, stream=True, headers=REQUEST_HEADERS)
    response.raise_for_status()
    chunks = []
    total = 0
    for chunk in response.iter_content(chunk_size=65536):
        total += len(chunk)
        if total > max_bytes:
            raise ValueError(f"GTFS archive from {url} exceeds the {max_bytes} byte limit")
        chunks.append(chunk)
    return b"".join(chunks)


def _paths(url, cache_dir):
    stem = os.path.join(cache_dir, hashlib.sha256(url.encode("utf-8")).hexdigest()[:16])
    return stem + ".zip", stem + ".sha256", stem + ".lock"


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


def cached_archive(url, cache_dir, max_age_hours, max_bytes, fetch, now=None):
    clock = now or time.time
    os.makedirs(cache_dir, exist_ok=True)
    zip_path, digest_path, lock_path = _paths(url, cache_dir)
    with open(lock_path, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            content, digest = _read_valid(zip_path, digest_path)
            fresh = content is not None and clock() - os.path.getmtime(zip_path) < max_age_hours * 3600
            if fresh:
                return CachedArchive(content, digest, False, "")
            try:
                downloaded = fetch(url, max_bytes)
                if len(downloaded) > max_bytes:
                    raise ValueError(f"GTFS archive from {url} exceeds the {max_bytes} byte limit")
                new_digest = hashlib.sha256(downloaded).hexdigest()
                _write(zip_path, digest_path, downloaded, new_digest)
                os.utime(zip_path, (clock(), clock()))
                return CachedArchive(downloaded, new_digest, False, "")
            except Exception as error:
                if content is not None:
                    return CachedArchive(content, digest, True, f"gtfs_refresh_failed {url}: {error}")
                raise ValueError(f"GTFS download from {url} failed and no cached copy exists: {error}") from error
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)

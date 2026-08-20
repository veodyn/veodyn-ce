"""HTTP transport helpers for the GTFS-Realtime protobuf feed path."""

from urllib.parse import urlsplit, urlunsplit

HTTP_TIMEOUT_SECONDS = 10
HTTP_CHUNK_SIZE = 65536
MAX_FEED_BYTES = 50 * 1024 * 1024


def sanitize_feed_url(url):
    """Drop query and fragment so error messages can't leak feed URL credentials."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def read_bounded(response, safe_url):
    """Stream the response body, capped at MAX_FEED_BYTES to bound memory use."""
    chunks = []
    total = 0
    for chunk in response.iter_content(chunk_size=HTTP_CHUNK_SIZE):
        total += len(chunk)
        if total > MAX_FEED_BYTES:
            raise ValueError(f"GTFS-Realtime feed from {safe_url} exceeds the {MAX_FEED_BYTES} byte limit")
        chunks.append(chunk)
    return b"".join(chunks)

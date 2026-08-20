"""Resource bounds for a static GTFS archive, enforced before validation runs.

Two different problems need two different checks. `write_capped` bounds the
bytes read from an upload as they arrive, off the event loop, without ever
buffering the whole file in memory first. `check_uncompressed_size` bounds
what the zip's own central directory claims to expand to: the zip-bomb case,
which a compressed-byte counter cannot catch since a bomb's compressed size is
small by construction.
"""

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import BinaryIO


class ArchiveTooLarge(Exception):
    """The archive exceeds a configured resource bound."""


def write_capped(source: BinaryIO, destination: Path, *, max_bytes: int, chunk_size: int = 1 << 20) -> int:
    """Copy `source` to `destination` in chunks. Returns the total bytes
    written. Raises `ArchiveTooLarge` the moment the running total exceeds
    `max_bytes`, so an oversized source is never fully buffered or written.
    """
    total = 0
    with destination.open("wb") as out:
        while True:
            chunk = source.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise ArchiveTooLarge(f"archive exceeded the {max_bytes} byte size limit")
            out.write(chunk)
    return total


def check_uncompressed_size(archive_path: Path, *, max_uncompressed_bytes: int) -> None:
    """Reject a zip bomb: a central directory declaring more uncompressed data
    than `max_uncompressed_bytes`. A file that is not a valid zip at all, or
    one whose central directory `zipfile` cannot parse (a filename that is not
    valid UTF-8 under the archive's own UTF-8 flag raises `UnicodeDecodeError`
    here, not `BadZipFile`), is left alone: this precheck must never produce a
    failure mode `run_validation` would not, and it already reports an
    archive it cannot open as a system error rather than a 400.
    """
    try:
        with zipfile.ZipFile(archive_path) as archive:
            total = sum(info.file_size for info in archive.infolist())
    except Exception:  # noqa: BLE001 - deliberately broad, see the docstring
        return
    if total > max_uncompressed_bytes:
        raise ArchiveTooLarge(f"archive declares {total} uncompressed bytes, over the {max_uncompressed_bytes} limit")

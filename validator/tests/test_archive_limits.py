"""Unit tests for `validator_service.archive_limits`."""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.fixtures import minimal_static_archive_bytes, zip_with_invalid_utf8_filename_bytes
from validator_service.archive_limits import ArchiveTooLarge, check_uncompressed_size, write_capped


class _BytesSource:
    """A sync, `.read(size)`-shaped stand-in for `UploadFile.file`."""

    def __init__(self, data: bytes) -> None:
        self._buffer = data

    def read(self, size: int) -> bytes:
        chunk, self._buffer = self._buffer[:size], self._buffer[size:]
        return chunk


def test_write_capped_copies_bytes_within_the_limit(tmp_path: Path) -> None:
    destination = tmp_path / "gtfs.zip"

    written = write_capped(_BytesSource(b"hello"), destination, max_bytes=100)

    assert written == 5
    assert destination.read_bytes() == b"hello"


def test_write_capped_raises_once_the_limit_is_exceeded(tmp_path: Path) -> None:
    destination = tmp_path / "gtfs.zip"

    with pytest.raises(ArchiveTooLarge):
        write_capped(_BytesSource(b"x" * 100), destination, max_bytes=10, chunk_size=10)


def test_check_uncompressed_size_passes_a_real_archive_within_the_limit(tmp_path: Path) -> None:
    archive_path = tmp_path / "gtfs.zip"
    archive_path.write_bytes(minimal_static_archive_bytes())

    check_uncompressed_size(archive_path, max_uncompressed_bytes=1_000_000)  # must not raise


def test_check_uncompressed_size_rejects_a_declared_expansion_over_the_limit(tmp_path: Path) -> None:
    archive_path = tmp_path / "gtfs.zip"
    archive_path.write_bytes(minimal_static_archive_bytes())

    with pytest.raises(ArchiveTooLarge):
        check_uncompressed_size(archive_path, max_uncompressed_bytes=1)


def test_check_uncompressed_size_ignores_a_corrupt_archive(tmp_path: Path) -> None:
    """A file that is not a valid zip at all must not raise here: `run_validation`
    reports it the normal way, as a system error, not this precheck."""
    archive_path = tmp_path / "gtfs.zip"
    archive_path.write_bytes(b"not a zip file at all")

    check_uncompressed_size(archive_path, max_uncompressed_bytes=1_000_000)  # must not raise


def test_check_uncompressed_size_ignores_an_invalid_utf8_filename(tmp_path: Path) -> None:
    """A zip that opens structurally but whose central directory `zipfile`
    itself cannot decode (`UnicodeDecodeError`, not `BadZipFile`) must be left
    to `run_validation`'s own handling too, not turned into an unhandled 500
    by this precheck."""
    archive_path = tmp_path / "gtfs.zip"
    archive_path.write_bytes(zip_with_invalid_utf8_filename_bytes())

    check_uncompressed_size(archive_path, max_uncompressed_bytes=1_000_000)  # must not raise

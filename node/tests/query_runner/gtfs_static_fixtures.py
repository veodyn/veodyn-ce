"""Builders for the static GTFS runner tests.

Fixture archives are built in memory rather than checked in, so what each test
feeds the runner is readable beside the assertion.
"""

import binascii
import codecs
import io
import struct
import zipfile
from unittest.mock import patch

from redash.query_runner.gtfs_static import GtfsStatic
from tests.query_runner.gtfs_realtime_fixtures import fake_response

FEED_URL = "https://transit.example.org/gtfs/feed.zip"
ZIP_STORED = zipfile.ZIP_STORED

STOPS = "stop_id,stop_name,stop_lat,stop_lon\nS1,Central Station,45.1234,-93.4567\nS2,7th St,45.2345,-93.5678\n"
ROUTES = "route_id,route_short_name,route_type\n12,Twelve,3\n14,Fourteen,3\n"
TRIPS = "route_id,service_id,trip_id\n12,WD,t1\n14,WD,t2\n12,SU,t3\n14,SU,t4\n"

DEFAULT_MEMBERS = {"stops.txt": STOPS, "routes.txt": ROUTES, "trips.txt": TRIPS}


def build_archive(members=None, bom=False, compression=zipfile.ZIP_DEFLATED):
    """A GTFS zip as bytes. bom=True prefixes every member with a UTF-8 BOM.

    compression=ZIP_STORED keeps the declared ratio at 1:1, for fixtures that
    are large or repetitive but are not meant to trip the zip-bomb guard.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression) as archive:
        for name, text in (DEFAULT_MEMBERS if members is None else members).items():
            body = text.encode("utf-8")
            archive.writestr(name, codecs.BOM_UTF8 + body if bom else body)
    return buffer.getvalue()


def forge_declared_size(body, size, payload):
    """Rewrite a single-member archive's central directory to under-declare its size.

    The CRC is rewritten to match the truncated prefix, so the forgery is the
    strongest form: nothing downstream can spot it by checksum.
    """
    raw = bytearray(body)
    start = raw.rindex(b"PK\x01\x02")
    raw[start + 16 : start + 20] = struct.pack("<I", binascii.crc32(payload[:size]) & 0xFFFFFFFF)
    raw[start + 24 : start + 28] = struct.pack("<I", size)
    return bytes(raw)


class BoundedLines:
    """A line source that fails the test if it is advanced past `limit` lines.

    Stands in for the archive member stream so a test can prove the row cap
    short-circuits the read rather than materializing the table and slicing it.
    """

    def __init__(self, lines, limit):
        self.lines = iter(lines)
        self.limit = limit
        self.read = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def __iter__(self):
        return self

    def __next__(self):
        line = next(self.lines)
        self.read += 1
        if self.read > self.limit:
            raise AssertionError(f"the row source was advanced to line {self.read}, past the {self.limit} needed")
        return line


def run_query(query, body=None, config=None, raise_error=None):
    """Run one query against a mocked archive fetch, returning (data, error, get_mock)."""
    runner = GtfsStatic({"gtfs_url": FEED_URL, **(config or {})})
    with patch("redash.query_runner.gtfs_static.requests.get") as get:
        get.return_value = fake_response(build_archive() if body is None else body, raise_error=raise_error)
        data, error = runner.run_query(query, None)
    return data, error, get


def column_types(data):
    return {column["name"]: column["type"] for column in data["columns"]}

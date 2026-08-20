"""Fixture helpers that build a real `PreparedFeed` and real GTFS-RT bytes
without downloading anything or paying for a real archive's ~48 second load.

`StaticContext.build` is a pure function over already-parsed rows (see the
package's `static/context.py`), so an empty `RawTables` gives a real, if
featureless, static context in microseconds. `proto.encode.encode` is the
package's own fixture-building helper (its module docstring says exactly
that: "Not a general encoder and not on the validation path... for building
fixtures"), so this uses the one the package ships rather than adding a
protobuf-generation dependency of this project's own.

`minimal_static_archive_bytes` below builds a small real GTFS zip for the
static-validation tests: real enough for `gtfs_validator.pipeline.run_validation`
to open and walk, matching `scripts/build-fixture-archive.py`'s fixture but
built in memory instead of on disk.
"""

from __future__ import annotations

import io
import struct
import zipfile

from gtfs_rt_validator.api import Mode, PreparedFeed
from gtfs_rt_validator.proto.encode import encode
from gtfs_rt_validator.proto.schema_current import SCHEMA
from gtfs_rt_validator.report.occurrence import NoticeContainer
from gtfs_rt_validator.static.adapter import RawTables, StopTimeTable
from gtfs_rt_validator.static.context import StaticContext

# `stop_times` is a `StopTimeTable`, not a list: 0.3.0 compacted the stop_times
# representation so a prepared feed peaks at ~584 MB instead of ~3.5 GB, and
# `StaticContext.build` reads `.by_trip` off it. An empty table is still the
# featureless static feed these fixtures want; only its container changed.
EMPTY_RAW_TABLES = RawTables(
    agency=[],
    stops=[],
    routes=[],
    trips=[],
    stop_times=StopTimeTable(by_trip={}, first_unknown_trip_id=None, first_unknown_stop_id=None),
    shapes=[],
    frequencies=[],
)

# One agency, stop, route and trip: matches scripts/build-fixture-archive.py.
MINIMAL_STATIC_FILES = {
    "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\na1,Test,https://example.org,UTC\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\ns1,Stop One,0.0,0.0\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type\nr1,a1,1,One,3\n",
    "trips.txt": "route_id,service_id,trip_id\nr1,sv1,t1\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,00:00:00,00:00:00,s1,1\n",
    "calendar.txt": (
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
        "sv1,1,1,1,1,1,1,1,20200101,20301231\n"
    ),
}


def empty_prepared_feed() -> PreparedFeed:
    """A real `PreparedFeed` over a static feed that declares nothing.

    Nothing in it ever resolves a trip, stop or route id, which is exactly
    what makes E003 ("trip_id does not exist") fire deterministically for any
    non-empty `trip_id` a test's realtime message names.
    """
    static = StaticContext.build(EMPTY_RAW_TABLES, ignore_shapes=False)
    return PreparedFeed(
        gtfs_input="test-fixture://empty",
        mode=Mode.MODERN,
        ignore_shapes=False,
        static=static,
        timezone="UTC",
        system_errors=NoticeContainer(),
    )


def vehicle_position_bytes(*, entity_id: str, trip_id: str, timestamp: int = 1_700_000_000) -> bytes:
    """A minimal, decodable `FeedMessage` with one `VehiclePosition` entity.

    Against `empty_prepared_feed()`, `trip_id` never resolves, so E003 fires
    exactly once per call with a prefix naming `trip_id`, which is what makes
    this a reliable way to tell two messages' findings apart in a report.
    """
    message = {
        "header": {"gtfs_realtime_version": "2.0", "timestamp": timestamp},
        "entity": [
            {
                "id": entity_id,
                "vehicle": {
                    "trip": {"trip_id": trip_id},
                    "position": {"latitude": 0.0, "longitude": 0.0},
                },
            }
        ],
    }
    result: bytes = encode(message, SCHEMA)
    return result


def minimal_static_archive_bytes() -> bytes:
    """A tiny, real GTFS zip, in memory: agency/stops/routes/trips/stop_times/calendar.

    It is fine for this to produce notices; static-validation tests assert on
    structure (keys, notice codes present or absent), not a byte-exact report.
    """
    return _zip_bytes(MINIMAL_STATIC_FILES)


def archive_with_decimal_price_bytes() -> bytes:
    """The minimal archive plus a `fare_attributes.txt` carrying a negative
    price. `price` is `DECIMAL`/`NON_NEGATIVE` in the package's own schema, so
    this reliably produces a `number_out_of_range` notice whose context holds
    a raw `Decimal` (see the reference package's `typing_checks.check_number`:
    a DECIMAL field's notice reports the BigDecimal itself, not a float). That
    Decimal is what `static_validation.py`'s JSON serialization has to survive.
    """
    files = dict(MINIMAL_STATIC_FILES)
    files["fare_attributes.txt"] = "fare_id,price,currency_type,payment_method\nf1,-1.20,USD,0\n"
    return _zip_bytes(files)


def zip_with_invalid_utf8_filename_bytes() -> bytes:
    """A structurally valid zip, hand-built, whose one central-directory entry
    sets the UTF-8 filename flag (bit 0x0800) but carries filename bytes that
    are not valid UTF-8. `zipfile` cannot build this through its normal write
    path: a `str` filename is always valid Unicode, so bad bytes have to be
    written directly into the local and central directory headers.

    Reproduces `UnicodeDecodeError` from `zipfile.ZipFile()`'s own filename
    decoding in `_RealGetContents`, distinct from `BadZipFile` (a structurally
    broken archive) and from a decodable-but-absurd one (the zip-bomb case).
    """
    filename = b"\xff\xfe-bad.txt"
    local_header = (
        struct.pack("<4sHHHHHIIIHH", b"PK\x03\x04", 20, 0x0800, 0, 0, 0, 0, 0, 0, len(filename), 0) + filename
    )
    central_dir = (
        struct.pack(
            "<4sHHHHHHIIIHHHHHII",
            b"PK\x01\x02",
            20,
            20,
            0x0800,
            0,
            0,
            0,
            0,
            0,
            0,
            len(filename),
            0,
            0,
            0,
            0,
            0,
            0,
        )
        + filename
    )
    cd_start = len(local_header)
    eocd = struct.pack("<4sHHHHIIH", b"PK\x05\x06", 0, 0, 1, 1, len(central_dir), cd_start, 0)
    return local_header + central_dir + eocd


def _zip_bytes(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, body in files.items():
            archive.writestr(name, body)
    return buffer.getvalue()

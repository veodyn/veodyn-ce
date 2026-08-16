"""Fixture helpers that build a real `PreparedFeed` and real GTFS-RT bytes
without downloading anything or paying for a real archive's ~48 second load.

`StaticContext.build` is a pure function over already-parsed rows (see the
package's `static/context.py`), so an empty `RawTables` gives a real, if
featureless, static context in microseconds. `proto.encode.encode` is the
package's own fixture-building helper (its module docstring says exactly
that: "Not a general encoder and not on the validation path... for building
fixtures"), so this uses the one the package ships rather than adding a
protobuf-generation dependency of this project's own.
"""

from __future__ import annotations

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

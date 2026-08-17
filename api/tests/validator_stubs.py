"""The validator's report shape, shared by the two modules that read it.

`test_feed_validator.py` drives `normalize_report` directly and
`test_feed_validator_transport.py` drives the whole HTTP call. Both need the
same report, and two copies of it would be two things that can drift into
testing two different validators.

The shape was verified on 2026-08-17 by reading `report/modern.py` in the
installed `gtfs-rt-validator` 0.3.0: one entry per rule, carrying the TRUE
count and a sample of occurrences locatable only by a free-text prefix. The
sample is capped at `MAX_EXPORTS_PER_RULE`, 1000, so the two agree below that
and diverge above it.

`title` is NOT native. The validator service adds it from the rule manifest,
because the native report carries only a code and `title` is the only
human-readable text an operator ever sees for a finding.
"""

from typing import Any

NOTICES: list[Any] = [
    {
        "code": "E003",
        "severity": "ERROR",
        "title": "GTFS-rt trip_id does not exist in GTFS data",
        "totalNotices": 1,
        "sampleNotices": [{"prefix": "vehicle_id bus-2 trip_id GHOST"}],
    },
    {
        "code": "W009",
        "severity": "WARNING",
        "title": "schedule_relationship not populated",
        "totalNotices": 2,
        "sampleNotices": [{"prefix": "trip_id t1"}, {"prefix": "trip_id t2"}],
    },
]

RULES_RUN = ["E003", "W009"]


def notice(
    severity: str,
    *,
    code: str = "E003",
    samples: tuple[dict[str, Any], ...] | None = ({"prefix": "trip_id t1"},),
    total: int | None = None,
) -> dict[str, Any]:
    """One report entry.

    `total` defaults to the number of samples only because most cases do not
    care; every test about the count passes it explicitly, since the whole
    point of the field is that it is NOT the sample count.
    """
    entry: dict[str, Any] = {"code": code, "severity": severity, "title": "t"}
    entry["totalNotices"] = total if total is not None else len(samples or ())
    if samples is not None:
        entry["sampleNotices"] = list(samples)
    return entry

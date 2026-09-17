from __future__ import annotations

import json
from typing import Any

from gtfs_rt_validator.api import Inputs, Mode, PreparedFeed, Request, validate
from gtfs_rt_validator.report.manifest import rule as manifest_rule
from gtfs_rt_validator.report.modern import build_report
from gtfs_rt_validator.report.occurrence import NoticeContainer
from gtfs_rt_validator.runner import MessageResult, url_cycle
from gtfs_rt_validator.static.adapter import RawTables, StopTimeTable
from gtfs_rt_validator.static.context import StaticContext

PINNED_VALIDATOR = "gtfs-rt-validator==0.3.0"

ALERT_RULE_CODES = frozenset({"E011", "E032", "E033", "E034", "S025", "S029", "S031"})

_CURRENT = "current"

_A_SCHEDULE_THAT_DECLARES_NOTHING = RawTables(
    agency=[],
    stops=[],
    routes=[],
    trips=[],
    stop_times=StopTimeTable(by_trip={}, first_unknown_trip_id=None, first_unknown_stop_id=None),
    shapes=[],
    frequencies=[],
)


def _prepared_feed() -> PreparedFeed:
    return PreparedFeed(
        gtfs_input="test-fixture://empty",
        mode=Mode.MODERN,
        ignore_shapes=False,
        static=StaticContext.build(_A_SCHEDULE_THAT_DECLARES_NOTHING, ignore_shapes=False),
        timezone="UTC",
        system_errors=NoticeContainer(),
    )


def _titled(report: dict[str, Any]) -> dict[str, Any]:
    for notice in report["notices"]:
        try:
            notice["title"] = manifest_rule(notice["code"]).title
        except KeyError:
            notice["title"] = ""
    return report


def report_of(feed_bytes: bytes) -> dict[str, Any]:
    results: list[MessageResult] = []
    outcome = validate(
        Request(
            mode=Mode.MODERN,
            gtfs=_prepared_feed(),
            inputs=Inputs(cycles=(url_cycle(_CURRENT, lambda: feed_bytes),), directory_replay=False),
        ),
        sink=results.append,
    )
    notices = next(result.notices for result in results if result.source.name == _CURRENT)
    report = _titled(build_report(notices, outcome.summary()))
    wire: dict[str, Any] = json.loads(json.dumps(report))
    return wire

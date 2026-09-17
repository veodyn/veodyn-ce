from __future__ import annotations

import time
from typing import Any, cast

from gtfs_rt_validator.proto.encode import encode
from gtfs_rt_validator.proto.schema_current import SCHEMA

from tests.fixtures import empty_prepared_feed
from validator_service.validation import run_validation

ALERT_RULE_CODES = frozenset({"E011", "E032", "E033", "E034", "S025", "S029", "S031"})


def _enum(name: str, member: str) -> int:
    value: int = SCHEMA.enums[name][member]
    return value


def alert_bytes(*, informed_entity: dict[str, Any], description: str = "Buses run via Oak Street.") -> bytes:
    message = {
        "header": {"gtfs_realtime_version": "2.0", "incrementality": 0, "timestamp": int(time.time())},
        "entity": [
            {
                "id": "detour-42",
                "alert": {
                    "informed_entity": [informed_entity],
                    "cause": _enum("Alert.Cause", "CONSTRUCTION"),
                    "effect": _enum("Alert.Effect", "DETOUR"),
                    "severity_level": _enum("Alert.SeverityLevel", "WARNING"),
                    "header_text": {"translation": [{"text": "Route 1 is on detour", "language": "en"}]},
                    "description_text": {"translation": [{"text": description, "language": "en"}]},
                },
            }
        ],
    }
    result: bytes = encode(message, SCHEMA)
    return result


def _report(feed_bytes: bytes) -> dict[str, Any]:
    return run_validation(empty_prepared_feed(), feed_bytes, None)


def _errors(report: dict[str, Any]) -> list[dict[str, Any]]:
    notices = cast(list[dict[str, Any]], report["notices"])
    return [notice for notice in notices if notice["severity"] == "ERROR"]


def test_the_registry_this_pin_builds_holds_alert_rules() -> None:
    report = _report(alert_bytes(informed_entity={"route_id": "r1"}))

    assert ALERT_RULE_CODES <= set(report["summary"]["rulesRun"])


def test_a_conforming_alert_feed_raises_no_error() -> None:
    report = _report(alert_bytes(informed_entity={"route_id": "r1"}))

    assert _errors(report) == []


def test_an_agency_the_schedule_does_not_have_is_refused_by_E034() -> None:
    report = _report(alert_bytes(informed_entity={"agency_id": "NOT-AN-AGENCY"}))

    errors = _errors(report)
    assert [notice["code"] for notice in errors] == ["E034"]
    assert errors[0]["title"] == "GTFS-rt agency_id does not exist in GTFS data"
    assert errors[0]["sampleNotices"][0]["prefix"] == "alert ID detour-42 agency_id NOT-AN-AGENCY"


def test_a_stop_the_schedule_does_not_have_is_refused_by_E011() -> None:
    report = _report(alert_bytes(informed_entity={"stop_id": "NOT-A-STOP"}))

    errors = _errors(report)
    assert [notice["code"] for notice in errors] == ["E011"]
    assert errors[0]["sampleNotices"][0]["prefix"] == "alert entity ID detour-42 stop_id NOT-A-STOP"


def test_an_informed_entity_that_selects_nothing_is_refused_by_E033() -> None:
    report = _report(alert_bytes(informed_entity={}))

    assert [notice["code"] for notice in _errors(report)] == ["E033"]


def test_a_description_that_only_repeats_the_header_is_a_warning_not_an_error() -> None:
    report = _report(alert_bytes(informed_entity={"route_id": "r1"}, description="Route 1 is on detour"))

    notices = cast(list[dict[str, Any]], report["notices"])
    assert [notice["code"] for notice in notices] == ["S029"]
    assert _errors(report) == []

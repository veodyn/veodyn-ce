import time
import tomllib
from pathlib import Path
from typing import Any

import httpx
import pytest
from google.transit import gtfs_realtime_pb2

from tests.alert_validation import ALERT_RULE_CODES, PINNED_VALIDATOR, report_of
from tests.test_gtfs_rt_service_alerts import an_alert
from veodyn_api.services.gtfs_rt_serializer import serialize_service_alerts
from veodyn_api.services.published_feed_validator import ValidationOutcome, validate_feed

GTFS = "https://example.org/gtfs.zip"

CONFORMING = [an_alert()]
UNKNOWN_AGENCY = [an_alert(informed_entities=[{"kind": "agency", "id": "NOT-AN-AGENCY"}])]
DESCRIPTION_ECHOES_THE_HEADER = [an_alert(description=[{"language": "en", "text": "Route 1 is on detour"}])]

REPO = Path(__file__).resolve().parents[2]


def _judged(rows: list[dict[str, Any]], report: dict[str, Any] | None = None) -> tuple[ValidationOutcome, bytes]:
    sent: dict[str, bytes] = {}
    feed_bytes = serialize_service_alerts(rows, feed_timestamp=int(time.time()))
    verdict = report_of(feed_bytes) if report is None else report

    def handler(request: httpx.Request) -> httpx.Response:
        sent["feed"] = request.content
        return httpx.Response(200, json=verdict)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        outcome = validate_feed(client, "http://validator:8080", feed_bytes, GTFS, None)
    assert feed_bytes in sent["feed"], "the validator was judging some other bytes"
    return outcome, feed_bytes


def _pinned_in(pyproject: Path, group: str) -> list[str]:
    body = tomllib.loads(pyproject.read_text())
    if group == "dependencies":
        requirements: list[str] = body["project"]["dependencies"]
        return requirements
    dev: list[str] = body["dependency-groups"]["dev"]
    return dev


def test_this_suite_judges_against_the_same_validator_the_service_runs() -> None:
    assert PINNED_VALIDATOR in _pinned_in(REPO / "api" / "pyproject.toml", "dev")
    assert PINNED_VALIDATOR in _pinned_in(REPO / "validator" / "pyproject.toml", "dependencies")


def test_a_conforming_alert_feed_passes_the_rule_set_the_validator_actually_registers() -> None:
    outcome, feed_bytes = _judged(CONFORMING)

    assert outcome.has_error is False
    assert outcome.findings == ()
    assert ALERT_RULE_CODES <= set(outcome.enabled_rules)
    assert len(outcome.enabled_rules) > 100
    parsed = gtfs_realtime_pb2.FeedMessage()
    parsed.ParseFromString(feed_bytes)
    assert parsed.entity[0].alert.severity_level == gtfs_realtime_pb2.Alert.WARNING


def test_an_agency_the_schedule_does_not_have_is_refused_by_E034() -> None:
    outcome, _ = _judged(UNKNOWN_AGENCY)

    assert outcome.has_error is True
    assert [finding.rule_id for finding in outcome.errors] == ["E034"]
    error = outcome.errors[0]
    assert error.title == "GTFS-rt agency_id does not exist in GTFS data"
    assert error.locator == "alert ID detour-42 agency_id NOT-AN-AGENCY"


def test_an_alert_only_warning_does_not_block_the_feed() -> None:
    outcome, _ = _judged(DESCRIPTION_ECHOES_THE_HEADER)

    assert outcome.has_error is False
    assert [finding.rule_id for finding in outcome.findings] == ["S029"]


def test_a_report_that_ran_no_rules_is_not_a_pass() -> None:
    with pytest.raises(Exception, match="covers nothing"):
        _judged(CONFORMING, {"summary": {"rulesRun": []}, "notices": []})

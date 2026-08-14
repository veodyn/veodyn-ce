"""The validator boundary: its report shape in, one result schema out."""

import httpx
import pytest

from veodyn_api.services.feed_validator import (
    ValidatorUnavailable,
    normalize_report,
    normalize_severity,
    validate_feed,
)

# The shape the MobilityData batch validator actually emits, measured 2026-08-13
# against constructed fixtures: a rule plus occurrences locatable only by prefix.
REPORT = [
    {
        "errorMessage": {
            "validationRule": {
                "errorId": "E003",
                "severity": "ERROR",
                "title": "GTFS-rt trip_id does not exist in GTFS data",
                "errorDescription": "All trip_ids must exist in the GTFS data",
                "occurrenceSuffix": "does not exist in the GTFS data",
            }
        },
        "occurrenceList": [{"prefix": "vehicle_id bus-2 trip_id GHOST"}],
    },
    {
        "errorMessage": {
            "validationRule": {
                "errorId": "W009",
                "severity": "WARNING",
                "title": "schedule_relationship not populated",
                "errorDescription": "should be populated",
                "occurrenceSuffix": "does not have a schedule_relationship",
            }
        },
        "occurrenceList": [{"prefix": "trip_id t1"}, {"prefix": "trip_id t2"}],
    },
]

ENABLED_RULES = ["E003", "W009"]


def _entry(severity, *, error_id="E003", occurrences=({"prefix": "trip_id t1"},)):
    entry = {"errorMessage": {"validationRule": {"errorId": error_id, "severity": severity, "title": "t"}}}
    if occurrences is not None:
        entry["occurrenceList"] = list(occurrences)
    return entry


def test_each_occurrence_becomes_its_own_finding():
    findings = normalize_report(REPORT)

    assert len(findings) == 3
    assert findings[0].rule_id == "E003"
    assert findings[0].severity == "ERROR"
    assert findings[0].locator == "vehicle_id bus-2 trip_id GHOST"
    assert [f.rule_id for f in findings[1:]] == ["W009", "W009"]


def test_an_empty_report_is_no_findings():
    assert normalize_report([]) == ()


def test_a_rule_with_no_occurrences_is_still_reported():
    """A rule in the report fired. Dropping it turns a defect into silence."""
    findings = normalize_report(
        [{"errorMessage": {"validationRule": {"errorId": "E1", "severity": "ERROR"}}, "occurrenceList": []}]
    )

    assert len(findings) == 1
    assert findings[0].rule_id == "E1"
    assert findings[0].severity == "ERROR"
    assert findings[0].locator == ""


def test_a_rule_with_no_occurrence_list_at_all_is_still_reported():
    """The missing-key spelling of the case above, which is the same defect."""
    findings = normalize_report([_entry("ERROR", error_id="E1", occurrences=None)])

    assert [(f.rule_id, f.locator) for f in findings] == [("E1", "")]


def test_a_rule_with_no_occurrences_still_blocks():
    """The point of keeping it: it has to reach `has_error`, not just exist."""
    outcome = _outcome_for([_entry("ERROR", occurrences=[])])

    assert outcome.has_error is True
    assert [f.rule_id for f in outcome.errors] == ["E003"]


@pytest.mark.parametrize(
    "entry",
    [
        pytest.param({"errorMessage": {"validationRule": {"severity": "ERROR"}}}, id="no-error-id"),
        pytest.param({"errorMessage": {"validationRule": {"errorId": ""}}}, id="empty-error-id"),
        pytest.param({"errorMessage": {"validationRule": {"errorId": None}}}, id="null-error-id"),
        pytest.param({"errorMessage": {}}, id="no-validation-rule"),
        pytest.param({}, id="no-error-message"),
        pytest.param("E003", id="entry-is-a-string"),
        pytest.param(None, id="entry-is-null"),
    ],
)
def test_an_unreadable_report_entry_fails_closed(entry):
    """An unreadable entry is an unintelligible verdict, not an absent finding."""
    with pytest.raises(ValidatorUnavailable):
        normalize_report([entry])


def test_an_unreadable_entry_fails_the_whole_report():
    """It cannot be swallowed just because the other entries parsed."""
    with pytest.raises(ValidatorUnavailable):
        normalize_report([*REPORT, {"errorMessage": {"validationRule": {"severity": "ERROR"}}}])


@pytest.mark.parametrize("occurrences", [{"prefix": "x"}, "trip_id t1", ["trip_id t1"]])
def test_an_unreadable_occurrence_fails_closed(occurrences):
    with pytest.raises(ValidatorUnavailable):
        normalize_report([_entry("ERROR", occurrences=occurrences)])


@pytest.mark.parametrize("severity", ["ERROR", "error", "eRRoR", "FATAL", "critical", "", "   ", None, 3, True])
def test_any_unrecognized_severity_is_blocking(severity):
    """`has_error` is an equality test, so a label left verbatim fails open."""
    findings = normalize_report([_entry(severity)])

    assert findings[0].severity == "ERROR"


@pytest.mark.parametrize(
    "severity,expected",
    [("WARNING", "WARNING"), ("warning", "WARNING"), ("INFO", "INFO"), ("  info  ", "INFO")],
)
def test_only_warning_and_info_are_non_blocking(severity, expected):
    assert normalize_severity(severity) == expected
    assert normalize_report([_entry(severity)])[0].severity == expected


def test_a_lowercase_error_severity_still_blocks():
    """The end-to-end half of the severity rule: it has to reach the outcome."""
    outcome = _outcome_for([_entry("error")])

    assert outcome.has_error is True
    assert [f.rule_id for f in outcome.errors] == ["E003"]


def test_outcome_separates_errors_from_warnings():
    outcome = _outcome_for(REPORT)

    assert outcome.has_error is True
    assert [f.rule_id for f in outcome.errors] == ["E003"]


def test_a_warning_only_report_does_not_block():
    outcome = _outcome_for([REPORT[1]])

    assert outcome.has_error is False


def _outcome_for(report, enabled_rules=ENABLED_RULES):
    return _outcome_for_payload({"report": report, "enabledRules": enabled_rules})


def _outcome_for_payload(payload):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        return validate_feed(
            client,
            "http://validator:8080",
            feed_bytes=b"\x00",
            static_gtfs_ref="https://example.org/gtfs.zip",
            previous_feed=None,
        )


def test_an_empty_report_from_a_real_rule_set_is_a_clean_pass():
    """The one legitimate clean verdict, and it must keep working."""
    outcome = _outcome_for([], enabled_rules=["E003", "W009"])

    assert outcome.findings == ()
    assert outcome.has_error is False
    assert outcome.enabled_rules == ("E003", "W009")


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({}, id="empty-object"),
        pytest.param({"error": "validator crashed"}, id="crash-body"),
        pytest.param({"report": None, "enabledRules": ENABLED_RULES}, id="null-report"),
        pytest.param({"report": False, "enabledRules": ENABLED_RULES}, id="false-report"),
        pytest.param({"report": {}, "enabledRules": ENABLED_RULES}, id="report-is-an-object"),
        pytest.param({"report": "none", "enabledRules": ENABLED_RULES}, id="report-is-a-string"),
        pytest.param({"enabledRules": ENABLED_RULES}, id="no-report-key"),
    ],
)
def test_a_payload_without_a_report_fails_closed(payload):
    """An absent report is not a report of nothing."""
    with pytest.raises(ValidatorUnavailable):
        _outcome_for_payload(payload)


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"report": []}, id="no-enabled-rules-key"),
        pytest.param({"report": [], "enabledRules": []}, id="zero-enabled-rules"),
        pytest.param({"report": [], "enabledRules": None}, id="null-enabled-rules"),
        pytest.param({"report": [], "enabledRules": "E003"}, id="enabled-rules-is-a-string"),
    ],
)
def test_a_verdict_from_no_rules_fails_closed(payload):
    """Zero rules validated nothing, so a clean report from them means nothing."""
    with pytest.raises(ValidatorUnavailable):
        _outcome_for_payload(payload)


def test_a_validator_error_status_fails_closed():
    """An absent verdict must never read as a pass."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValidatorUnavailable):
            validate_feed(client, "http://validator:8080", b"\x00", "https://example.org/gtfs.zip", None)


def test_a_transport_failure_fails_closed():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValidatorUnavailable):
            validate_feed(client, "http://validator:8080", b"\x00", "https://example.org/gtfs.zip", None)


def test_a_timeout_fails_closed():
    """The slow half is the schedule load, so this is the likeliest outage."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("too slow")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValidatorUnavailable):
            validate_feed(client, "http://validator:8080", b"\x00", "https://example.org/gtfs.zip", None)


def test_malformed_json_fails_closed():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not json")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValidatorUnavailable):
            validate_feed(client, "http://validator:8080", b"\x00", "https://example.org/gtfs.zip", None)


def test_a_json_body_that_is_not_a_report_fails_closed():
    """Valid JSON is not a verdict. A bare list would read as no findings."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValidatorUnavailable):
            validate_feed(client, "http://validator:8080", b"\x00", "https://example.org/gtfs.zip", None)


def test_the_previous_feed_is_sent_when_there_is_one():
    """Iteration rules (E017/E018) need the previous artifact, and batch mode
    would otherwise compare against whatever file sorted before it."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content
        return httpx.Response(200, json={"report": [], "enabledRules": ENABLED_RULES})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        validate_feed(client, "http://validator:8080", b"\x01", "https://example.org/gtfs.zip", b"\x02")

    assert b"previous" in seen["body"]


def test_the_previous_feed_is_absent_when_there_is_none():
    """Without it, a client that always attached a previous part would pass."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content
        return httpx.Response(200, json={"report": [], "enabledRules": ENABLED_RULES})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        validate_feed(client, "http://validator:8080", b"\x01", "https://example.org/gtfs.zip", None)

    assert b"previous" not in seen["body"]

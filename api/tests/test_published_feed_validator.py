"""The validator's report shape in, findings out. No transport here.

`test_published_feed_validator_transport.py` is the other half: the same
report arriving over HTTP, and every way the call itself can fail to produce a
verdict.
"""

import pytest

from tests.validator_stubs import NOTICES, RULES_RUN, notice
from veodyn_api.services.published_feed_validator import (
    ValidationOutcome,
    ValidatorUnavailable,
    normalize_report,
    normalize_severity,
)


def test_each_sample_becomes_its_own_finding():
    findings = normalize_report(NOTICES)

    assert [f.rule_id for f in findings] == ["E003", "W009", "W009"]
    assert [f.locator for f in findings] == [
        "vehicle_id bus-2 trip_id GHOST",
        "trip_id t1",
        "trip_id t2",
    ]


def test_a_finding_carries_the_true_count_not_the_sample_count():
    """THE reason occurrence_count exists.

    `sampleNotices` is capped (1000 per rule in 0.3.0) while `totalNotices` is
    the true number, so above that ceiling the rows are a sample. Reporting the
    sample size as the truth is a silent under-report, and it is precise enough
    to be believed.
    """
    findings = normalize_report([notice("ERROR", samples=({"prefix": "bus-1"},), total=40)])

    assert len(findings) == 1
    assert findings[0].occurrence_count == 40


def test_every_finding_split_from_one_notice_repeats_that_notice_count():
    findings = normalize_report([notice("ERROR", samples=({"prefix": "a"}, {"prefix": "b"}), total=17)])

    assert [f.occurrence_count for f in findings] == [17, 17]


def test_an_empty_notice_list_is_no_findings():
    assert normalize_report([]) == ()


def test_a_notice_with_no_samples_is_still_reported():
    """The rule is in the report, so it fired; it just did not say where."""
    findings = normalize_report([notice("ERROR", samples=(), total=3)])

    assert len(findings) == 1
    assert findings[0].locator == ""
    assert findings[0].occurrence_count == 3


def test_a_notice_with_no_sample_key_at_all_is_still_reported():
    findings = normalize_report([notice("ERROR", samples=None, total=3)])

    assert len(findings) == 1
    assert findings[0].locator == ""


def test_a_notice_with_no_samples_still_blocks():
    findings = normalize_report([notice("ERROR", samples=(), total=1)])
    outcome = ValidationOutcome(findings=findings, enabled_rules=("E003",))

    assert outcome.has_error is True


def test_a_sample_with_no_prefix_becomes_an_empty_locator():
    """The validator omits `prefix` rather than sending it empty, and the other
    keys in a sample are rule-specific context this model does not carry."""
    findings = normalize_report([notice("ERROR", samples=({"entityPath": "entity[0].trip"},), total=1)])

    assert findings[0].locator == ""


# --- unreadable reports fail closed -----------------------------------------


@pytest.mark.parametrize(
    "entry",
    [
        pytest.param({"severity": "ERROR", "totalNotices": 1}, id="no-code"),
        pytest.param({"code": "", "severity": "ERROR", "totalNotices": 1}, id="empty-code"),
        pytest.param({"code": "   ", "severity": "ERROR", "totalNotices": 1}, id="blank-code"),
        pytest.param("E003", id="string-not-object"),
        pytest.param(["E003"], id="list-not-object"),
        pytest.param(None, id="null-entry"),
    ],
)
def test_an_unreadable_notice_fails_closed(entry):
    with pytest.raises(ValidatorUnavailable):
        normalize_report([entry])


def test_an_unreadable_notice_fails_the_whole_report():
    """Not skipped. A report half of which could not be read is not a report of
    the half that could."""
    with pytest.raises(ValidatorUnavailable):
        normalize_report([NOTICES[0], {"severity": "ERROR"}])


@pytest.mark.parametrize(
    "total",
    [
        pytest.param(None, id="missing"),
        pytest.param("40", id="string"),
        pytest.param(-1, id="negative"),
        pytest.param(True, id="bool-is-not-a-count"),
        pytest.param(1.5, id="float"),
    ],
)
def test_an_unusable_total_fails_closed(total):
    """Defaulting a missing count to the number of samples would restate the
    sample size as the truth, which is the one thing this field exists to stop."""
    entry = {"code": "E003", "severity": "ERROR", "sampleNotices": [{"prefix": "x"}]}
    if total is not None:
        entry["totalNotices"] = total

    with pytest.raises(ValidatorUnavailable):
        normalize_report([entry])


@pytest.mark.parametrize("samples", [{"prefix": "x"}, "trip_id t1", 3])
def test_an_unreadable_sample_container_fails_closed(samples):
    with pytest.raises(ValidatorUnavailable):
        normalize_report([{"code": "E003", "severity": "ERROR", "totalNotices": 1, "sampleNotices": samples}])


def test_a_sample_that_is_not_an_object_fails_closed():
    entry = {"code": "E003", "severity": "ERROR", "totalNotices": 1, "sampleNotices": ["trip_id t1"]}

    with pytest.raises(ValidatorUnavailable):
        normalize_report([entry])


# --- severity ----------------------------------------------------------------


@pytest.mark.parametrize("severity", ["ERROR", "error", "eRRoR", "FATAL", "critical", "", "   ", None, 3, True])
def test_any_unrecognized_severity_is_blocking(severity):
    assert normalize_severity(severity) == "ERROR"


@pytest.mark.parametrize(
    "severity,expected",
    [("WARNING", "WARNING"), ("warning", "WARNING"), ("INFO", "INFO"), ("  info  ", "INFO")],
)
def test_only_warning_and_info_are_non_blocking(severity, expected):
    assert normalize_severity(severity) == expected


def test_outcome_separates_errors_from_warnings():
    outcome = ValidationOutcome(findings=normalize_report(NOTICES), enabled_rules=tuple(RULES_RUN))

    assert [f.rule_id for f in outcome.errors] == ["E003"]
    assert outcome.has_error is True


def test_a_warning_only_report_does_not_block():
    outcome = ValidationOutcome(findings=normalize_report([NOTICES[1]]), enabled_rules=tuple(RULES_RUN))

    assert outcome.has_error is False

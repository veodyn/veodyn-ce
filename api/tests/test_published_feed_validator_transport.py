"""The whole validator call, and every way it can fail to produce a verdict.

`test_published_feed_validator.py` is the other half: the report shape, driven
straight through `normalize_report` with no HTTP.

Everything here asserts the same thing from a different angle: **an absent
verdict is never a clean one.** A timeout, a 500, a body that will not parse
and a report that cannot say which rules it ran all raise, because an empty
finding list is indistinguishable from a clean feed and would publish bytes
nothing checked.
"""

import httpx
import pytest

from tests.validator_stubs import NOTICES, RULES_RUN
from veodyn_api.services.published_feed_validator import ValidatorUnavailable, validate_feed

CLEAN_BODY = {"summary": {"rulesRun": RULES_RUN}, "notices": []}


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


def _raises_for(handler):
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValidatorUnavailable):
            validate_feed(client, "http://validator:8080", b"\x00", "https://example.org/gtfs.zip", None)


def test_an_empty_report_from_a_real_rule_set_is_a_clean_pass():
    """The one legitimate clean verdict, and it must keep working."""
    outcome = _outcome_for_payload(CLEAN_BODY)

    assert outcome.findings == ()
    assert outcome.has_error is False
    assert outcome.enabled_rules == ("E003", "W009")


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({}, id="empty-object"),
        pytest.param({"error": "validator crashed"}, id="crash-body"),
        pytest.param({"summary": {"rulesRun": RULES_RUN}, "notices": None}, id="null-notices"),
        pytest.param({"summary": {"rulesRun": RULES_RUN}, "notices": {}}, id="notices-is-an-object"),
        pytest.param({"summary": {"rulesRun": RULES_RUN}, "notices": "none"}, id="notices-is-a-string"),
        pytest.param({"summary": {"rulesRun": RULES_RUN}}, id="no-notices-key"),
    ],
)
def test_a_payload_without_notices_fails_closed(payload):
    with pytest.raises(ValidatorUnavailable):
        _outcome_for_payload(payload)


def test_an_absent_rules_run_fails_closed_naming_that_it_cannot_say():
    """ABSENT and EMPTY are different facts and both refuse.

    Absent means the report cannot say what ran; empty means a registry was
    supplied and held nothing. Both are unfit to support a clean verdict, and
    collapsing them into one message would lose which of the two happened.
    """
    with pytest.raises(ValidatorUnavailable, match="does not say which rules"):
        _outcome_for_payload({"summary": {"mode": "modern"}, "notices": []})


def test_an_empty_rules_run_fails_closed_naming_that_none_ran():
    with pytest.raises(ValidatorUnavailable, match="ran no rules"):
        _outcome_for_payload({"summary": {"rulesRun": []}, "notices": []})


@pytest.mark.parametrize(
    "summary",
    [
        pytest.param({"rulesRun": "E003"}, id="rules-run-is-a-string"),
        pytest.param({"rulesRun": {}}, id="rules-run-is-an-object"),
        pytest.param({"rulesRun": None}, id="rules-run-is-null"),
    ],
)
def test_an_unreadable_rules_run_fails_closed(summary):
    with pytest.raises(ValidatorUnavailable):
        _outcome_for_payload({"summary": summary, "notices": []})


@pytest.mark.parametrize("summary", [None, "modern", [], 3])
def test_a_missing_or_unreadable_summary_fails_closed(summary):
    with pytest.raises(ValidatorUnavailable):
        _outcome_for_payload({"summary": summary, "notices": []})


def test_the_inventory_is_checked_even_when_findings_are_readable():
    """Order matters: a report that cannot say what it ran is refused even when
    it carries findings that parse perfectly."""
    with pytest.raises(ValidatorUnavailable):
        _outcome_for_payload({"summary": {}, "notices": NOTICES})


def test_a_validator_error_status_fails_closed():
    _raises_for(lambda request: httpx.Response(500, text="boom"))


def test_a_validator_503_fails_closed():
    """What the service answers while a prepare is in flight. A publish attempt
    during a rebuild is a failed attempt, not a clean one."""
    _raises_for(lambda request: httpx.Response(503, json={"detail": "preparing"}))


def test_a_transport_failure_fails_closed():
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    _raises_for(handler)


def test_a_timeout_fails_closed():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    _raises_for(handler)


def test_malformed_json_fails_closed():
    _raises_for(lambda request: httpx.Response(200, text="not json"))


@pytest.mark.parametrize("body", [[], "clean", 3, None])
def test_a_json_body_that_is_not_a_report_fails_closed(body):
    _raises_for(lambda request: httpx.Response(200, json=body))


def _body_sent(previous):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content
        return httpx.Response(200, json=CLEAN_BODY)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        validate_feed(client, "http://validator:8080", b"\x01", "https://example.org/gtfs.zip", previous)
    return seen["body"]


def test_the_previous_feed_is_sent_when_there_is_one():
    assert b"previous.pb" in _body_sent(b"\x02")


def test_the_previous_feed_is_absent_when_there_is_none():
    assert b"previous.pb" not in _body_sent(None)


def test_the_static_ref_is_sent_as_the_gtfs_field():
    """The service fetches and prepares the archive, so this string is the only
    thing that tells it which one."""
    assert b"https://example.org/gtfs.zip" in _body_sent(None)

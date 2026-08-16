"""Wiring tests against the REAL gtfs_rt_validator package: `run_validation`
gets a real `PreparedFeed` (see `fixtures.py` for why that costs microseconds,
not 48 seconds) and real, decodable GTFS-Realtime bytes, so these prove the
Inputs/cycle plumbing actually works against the package rather than against
this project's own mental model of it.

`test_routes.py` covers the HTTP layer with the package boundary faked, per
the brief; these cover the one piece that must not be faked, because faking
it would only prove the fake agrees with itself.
"""

from __future__ import annotations

from typing import Any, cast

import pytest
from gtfs_rt_validator.report.manifest import rule as manifest_rule
from gtfs_rt_validator.report.modern import build_report
from gtfs_rt_validator.report.occurrence import NoticeContainer, Occurrence
from gtfs_rt_validator.report.summary import RunSummary
from gtfs_rt_validator.rules.registry import Registry

from tests.fixtures import empty_prepared_feed, vehicle_position_bytes
from validator_service.validation import FeedDecodeError, _add_titles, run_validation


def _notice(report: dict[str, Any], code: str) -> dict[str, Any] | None:
    notices = cast(list[dict[str, Any]], report["notices"])
    for notice in notices:
        if notice["code"] == code:
            return notice
    return None


def test_current_message_findings_are_reported() -> None:
    """The baseline: a current message with an unresolvable trip_id must
    produce exactly one E003, with the right total and one sample."""
    feed = empty_prepared_feed()
    current = vehicle_position_bytes(entity_id="v1", trip_id="CURRENT-GHOST")

    report = run_validation(feed, current, None)

    e003 = _notice(report, "E003")
    assert e003 is not None
    assert e003["totalNotices"] == 1
    assert len(e003["sampleNotices"]) == 1
    assert "CURRENT-GHOST" in e003["sampleNotices"][0]["prefix"]


def test_previous_message_findings_are_excluded_from_the_report() -> None:
    """The load-bearing property: `previous` drives iteration-sensitive rules
    but must NOT contribute its own findings to the report. Both messages here
    trigger E003 on their own trip_id; if the previous message's E003 leaked
    into the report, totalNotices would read 2 and the sample could name the
    wrong trip.
    """
    feed = empty_prepared_feed()
    previous = vehicle_position_bytes(entity_id="v0", trip_id="PREVIOUS-GHOST")
    current = vehicle_position_bytes(entity_id="v1", trip_id="CURRENT-GHOST")

    report = run_validation(feed, current, previous)

    e003 = _notice(report, "E003")
    assert e003 is not None
    assert e003["totalNotices"] == 1, "the previous message's own E003 must not be counted"
    assert len(e003["sampleNotices"]) == 1
    assert "CURRENT-GHOST" in e003["sampleNotices"][0]["prefix"]
    assert "PREVIOUS-GHOST" not in e003["sampleNotices"][0]["prefix"]


def test_current_message_that_fails_to_decode_raises_feed_decode_error() -> None:
    """Garbage `feed` bytes must surface as `FeedDecodeError`, which the router
    turns into 400: there is no MessageResult to build a report from."""
    feed = empty_prepared_feed()

    with pytest.raises(FeedDecodeError):
        run_validation(feed, b"\xff\xff\xff not a feed message", None)


def test_previous_that_fails_to_decode_is_treated_as_no_previous() -> None:
    """Garbage `previous` bytes must not fail the request: the current message
    is still validated, exactly as if `previous` had been omitted."""
    feed = empty_prepared_feed()
    current = vehicle_position_bytes(entity_id="v1", trip_id="CURRENT-GHOST")

    report = run_validation(feed, current, b"\xff\xff\xff not a feed message")

    e003 = _notice(report, "E003")
    assert e003 is not None
    assert e003["totalNotices"] == 1


def test_title_is_looked_up_from_the_manifest() -> None:
    """`title` is not in the package's own report; it must be added from
    `manifest.rule`, and it must be the real title, not a placeholder."""
    feed = empty_prepared_feed()
    current = vehicle_position_bytes(entity_id="v1", trip_id="CURRENT-GHOST")

    report = run_validation(feed, current, None)

    e003 = _notice(report, "E003")
    assert e003 is not None
    assert e003["title"] == manifest_rule("E003").title
    assert e003["title"] != ""


def test_rules_run_is_the_full_modern_registry_in_order() -> None:
    """`rulesRun` must be the run's own registry, unfiltered and unreordered by
    this wrapper: exactly what `Registry.modern()` holds."""
    feed = empty_prepared_feed()
    current = vehicle_position_bytes(entity_id="v1", trip_id="CURRENT-GHOST")

    report = run_validation(feed, current, None)

    summary = cast(dict[str, Any], report["summary"])
    assert summary["rulesRun"] == list(Registry.modern().ids())


def test_unknown_rule_code_gets_an_empty_title_not_an_error() -> None:
    """A code the packed manifest does not know (any S- or P-tier id; the
    manifest only carries the 61 upstream E/W ids) must get `title: ""` per
    the brief, not a `KeyError` bubbling out of the enrichment step. Exercised
    directly against a hand-built report so it does not depend on finding a
    real feed that trips a spec/practice rule."""
    container = NoticeContainer()
    container.add(Occurrence("S999", "made up for this test"))
    summary = RunSummary(validated_at="2026-08-16T00:00:00Z", mode="modern", rules_run=("S999",))

    # Exercises the same _add_titles helper run_validation uses, reached the
    # same way: build_report first, then enrich in place.
    report: dict[str, Any] = dict(build_report(container, summary, severity_of=lambda _rule_id: "ERROR"))
    _add_titles(report)

    notices = cast(list[dict[str, Any]], report["notices"])
    assert notices[0]["code"] == "S999"
    assert notices[0]["title"] == ""


def test_rules_run_none_is_absent_from_the_summary() -> None:
    """The package's own contract, pinned so a dependency bump cannot silently
    change it under this wrapper: `rules_run=None` means the summary omits the
    key entirely (Gson-style "null field is absent"), not `"rulesRun": null`
    and not `"rulesRun": []`."""
    container = NoticeContainer()
    summary = RunSummary(validated_at="2026-08-16T00:00:00Z", mode="modern", rules_run=None)

    report = build_report(container, summary)

    assert "rulesRun" not in cast(dict[str, Any], report["summary"])


def test_rules_run_empty_tuple_is_present_as_an_empty_list() -> None:
    """The other half of the same contract: `rules_run=()` is a fact ("a
    registry was supplied and it held nothing") and must render as
    `"rulesRun": []`, distinct from the absent case above."""
    container = NoticeContainer()
    summary = RunSummary(validated_at="2026-08-16T00:00:00Z", mode="modern", rules_run=())

    report = build_report(container, summary)

    assert cast(dict[str, Any], report["summary"])["rulesRun"] == []

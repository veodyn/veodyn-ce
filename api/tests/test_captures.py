"""cadence_label and build_captures: pure, so the whole board is testable
without a backend.

The route-level contract (the /captures endpoint, degradation when Redash is
unreachable, the expectation and alert writes) is in test_captures_route.py.
"""

import pytest

from veodyn_api.schemas.catalog import DatasetCoverageOut, DatasetFreshnessOut, DatasetOut
from veodyn_api.services.captures import NO_SCHEDULE, QueryFacts, build_captures, cadence_label

# ─── cadence_label: the round trip lib/capture-status.ts depends on ──────────────


@pytest.mark.parametrize(
    ("seconds", "label"),
    [
        (60, "minutely"),
        (3600, "hourly"),
        (86400, "daily"),
        (604800, "weekly"),
        (300, "every 5 mins"),
        (7200, "every 2 hours"),
        (172800, "every 2 days"),
        (30, "every 30 secs"),
        (0, NO_SCHEDULE),
        (-1, NO_SCHEDULE),
    ],
)
def test_cadence_label_reads_as_english(seconds: int, label: str) -> None:
    assert cadence_label(seconds) == label


# `cadenceToMs` in app/src/lib/capture-status.ts, transcribed. The browser
# derives fresh/stale/down by comparing this period against the last capture, so
# a label it cannot parse silently disables the derivation instead of failing.
def cadence_to_ms(cadence: str) -> int | None:
    import re

    named = {"minutely": 60_000, "hourly": 3_600_000, "daily": 86_400_000, "weekly": 604_800_000}
    if cadence in named:
        return named[cadence]
    match = re.search(r"(\d+)\s*(sec|second|min|minute|hour|day|week)s?", cadence)
    if not match:
        return None
    unit = {"sec": 1_000, "second": 1_000, "min": 60_000, "minute": 60_000}
    unit |= {"hour": 3_600_000, "day": 86_400_000, "week": 604_800_000}
    return int(match.group(1)) * unit[match.group(2)]


@pytest.mark.parametrize("seconds", [30, 60, 300, 900, 3600, 7200, 86400, 172800, 604800])
def test_every_label_survives_the_round_trip_through_the_frontend_parser(seconds: int) -> None:
    assert cadence_to_ms(cadence_label(seconds)) == seconds * 1000


def test_an_unscheduled_query_is_labelled_so_the_parser_gives_up_cleanly() -> None:
    # Not a cosmetic choice: a label that parsed would invent a period and start
    # calling a hand-run capture late.
    assert cadence_to_ms(cadence_label(0)) is None


# ─── build_captures: pure, so the whole board is testable without a backend ──────


def dataset(id_: str, *, query_id: int, last: str, status: str = "fresh", origin: str = "capture") -> DatasetOut:
    return DatasetOut(
        id=id_,
        name=f"Query {query_id}",
        description="",
        domain=None,
        schema=[],
        freshness=DatasetFreshnessOut(last_updated_at=last, status=status, capture_id=id_),
        coverage=DatasetCoverageOut(start="", end=last),
        row_count=1,
        sources=[],
        tags=[],
        sample_query_id=query_id,
        origin=origin,
    )


def test_a_capture_carries_its_cadence_and_the_source_its_query_reads() -> None:
    captures = build_captures(
        [dataset("t_21", query_id=21, last="2026-07-25T11:30:00+00:00")],
        facts={21: QueryFacts(interval_seconds=300, data_source_id=3)},
        sources={3: "Light Rail"},
    )

    assert [(c.id, c.cadence, c.source, c.dataset_count) for c in captures] == [
        ("t_21", "every 5 mins", "Light Rail", 1)
    ]


def test_a_query_missing_from_redash_keeps_its_row_and_loses_only_its_labels() -> None:
    # An archived query still captured the table somebody is reading. Dropping
    # the row would be the empty-list failure this endpoint exists to end.
    captures = build_captures(
        [dataset("t_99", query_id=99, last="2026-07-25T11:30:00+00:00")],
        facts={},
        sources={},
    )

    assert len(captures) == 1
    assert captures[0].cadence == NO_SCHEDULE
    assert captures[0].source == ""
    assert captures[0].last_received_at == "2026-07-25T11:30:00+00:00"


def test_a_table_that_never_captured_anything_is_not_a_capture() -> None:
    captures = build_captures([dataset("t_0", query_id=1, last="")], facts={}, sources={})

    assert captures == []


def test_the_status_is_the_catalog_s_own_verdict_not_a_second_opinion() -> None:
    # The disagreement that produced this endpoint was two surfaces computing
    # freshness separately. build_captures must copy, never recompute.
    captures = build_captures(
        [dataset("t_1", query_id=1, last="2026-01-01T00:00:00+00:00", status="stale")],
        facts={1: QueryFacts(interval_seconds=60, data_source_id=3)},
        sources={3: "Light Rail"},
    )

    assert captures[0].status == "stale"

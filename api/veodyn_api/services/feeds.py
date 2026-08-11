"""Feed Health, derived from the catalog rather than assembled beside it.

A feed in this product is a scheduled Redash query that captures into the
historical warehouse. That is not what the frontend fixtures depict (they show
upstream providers: "AirNow Air Quality" delivered by "EPA AirNow"), and it is
worth being explicit that nothing in this stack records those. `_catalog` knows
which query captured which table and against which Redash connection; nobody
stores that the connection is fed by the EPA. So a feed is named after its query
and sourced by its Redash data source, which is the honest version of the same
board.

Built ON TOP of build_catalog, not next to it, and that is the load-bearing
decision here. The defect that produced this endpoint was two surfaces
disagreeing about freshness: Home showed two fresh feeds from /catalog while
Feed Health showed none, because /feeds did not exist and the page rendered the
404 as an empty list. A second freshness computation would have been a slower
way to earn the same disagreement back. Deriving from the catalog makes the two
answers the same answer by construction, and it costs no extra warehouse reads.
"""

import logging
from dataclasses import dataclass
from typing import Any

from veodyn_api.errors import ApiError
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.schemas.feed import FeedOut
from veodyn_api.services.redash import RedashClient

logger = logging.getLogger(__name__)

# Intervals with an English name the frontend already parses (lib/feed-status.ts
# `cadenceToMs`). Preferred over "every 1 hour" because the board renders this
# string verbatim.
CADENCE_NAMES = {60: "minutely", 3600: "hourly", 86400: "daily", 604800: "weekly"}

# Largest unit first, so 300 reads "every 5 min" rather than "every 300 sec".
CADENCE_UNITS = ((604800, "week"), (86400, "day"), (3600, "hour"), (60, "min"), (1, "sec"))

# A query in the registry with no schedule was captured by hand at least once.
# It still belongs on the board (it produced a table somebody reads), but it has
# no cadence to be late against. Deliberately unparseable by `cadenceToMs`,
# which returns null for it, so `deriveFeedStatus` falls back to the status
# below instead of inventing a period out of nothing.
NO_SCHEDULE = "not scheduled"


def cadence_label(interval_seconds: int) -> str:
    """A Redash schedule interval as a string lib/feed-status.ts can parse back.

    The round trip is the contract: whatever this returns, `cadenceToMs` must
    turn back into the same number of seconds, because the browser decides
    fresh/stale/down by comparing that period against the last capture. Emitting
    a label it cannot parse is not a cosmetic bug, it silently disables the
    derivation and leaves every feed on this service's coarser verdict.
    """
    if interval_seconds <= 0:
        return NO_SCHEDULE
    if interval_seconds in CADENCE_NAMES:
        return CADENCE_NAMES[interval_seconds]
    for size, unit in CADENCE_UNITS:
        if interval_seconds % size == 0:
            count = interval_seconds // size
            return f"every {count} {unit}{'' if count == 1 else 's'}"
    # Unreachable: every integer is divisible by the 1-second unit above.
    return NO_SCHEDULE


@dataclass(frozen=True)
class QueryFacts:
    """What Redash knows about a captured query that the warehouse does not."""

    interval_seconds: int
    data_source_id: int


def _interval_seconds(schedule: Any) -> int:
    """Seconds between runs, or 0 for a query nothing schedules.

    `schedule` is a JSONB column, so it arrives as null for an unscheduled query
    and as an object with a possibly-null `interval` for one that was scheduled
    and then had it cleared. Both are 0 here.
    """
    if not isinstance(schedule, dict):
        return 0
    interval = schedule.get("interval")
    return interval if isinstance(interval, int) and not isinstance(interval, bool) else 0


def query_facts(
    redash: RedashClient, *, api_key: str | None = None, cookie: str | None = None
) -> dict[int, QueryFacts]:
    """Schedule and data source for every query this caller can list.

    Empty is "we could not find out", and build_feeds treats it that way: a feed
    with no facts keeps its name, its id and its last capture, and loses only its
    cadence and its source. Refusing the whole board because a labelling call
    failed would reproduce the defect this endpoint exists to fix.

    Redash excludes drafts and archived queries from this listing, and it is one
    page. A captured table whose query has since been archived is therefore still
    listed as a feed, with no cadence: the capture happened, and pretending the
    table has no history because its query was tidied away would be a worse lie
    than an unlabelled row.
    """
    try:
        rows = redash.list_tagged("queries", "", api_key=api_key, cookie=cookie)
    except ApiError:
        logger.info("could not list the queries; feeds go without a cadence or a source")
        return {}
    facts: dict[int, QueryFacts] = {}
    for row in rows:
        query_id = row.get("id")
        if not isinstance(query_id, int):
            continue
        source_id = row.get("data_source_id")
        facts[query_id] = QueryFacts(
            interval_seconds=_interval_seconds(row.get("schedule")),
            data_source_id=source_id if isinstance(source_id, int) else 0,
        )
    return facts


def build_feeds(
    datasets: list[DatasetOut],
    *,
    facts: dict[int, QueryFacts],
    sources: dict[int, str],
    expectations: dict[str, int] | None = None,
    alert_links: dict[str, int] | None = None,
) -> list[FeedOut]:
    """One feed per captured dataset, in the catalog's own order.

    Pure: every warehouse read already happened in build_catalog, and the three
    lookups are passed in. So the whole shape of this board is testable without
    a ClickHouse or a Redash on the other end, which is the reason the router
    below has almost nothing in it.

    `expectations` wins over the schedule, keyed by feed id. It is a person
    saying how often data should arrive, which beats Redash's record of who is
    supposed to run the capture, and on this instance the two disagree about
    every feed: nothing is scheduled and everything is delivering. The schedule
    stays as the fallback because where it is set it is a true statement and
    needs no one to maintain it.
    """
    declared = expectations or {}
    armed = alert_links or {}
    feeds: list[FeedOut] = []
    for dataset in datasets:
        # A dataset with no last capture has never delivered anything. It is a
        # registry row for a table that exists and is empty, and putting it on a
        # freshness board as "last received: never" would give the reader a row
        # they cannot act on.
        if not dataset.freshness.last_updated_at:
            continue
        fact = facts.get(dataset.sample_query_id or 0)
        expected = declared.get(dataset.id)
        interval = expected if expected is not None else (fact.interval_seconds if fact else 0)
        feeds.append(
            FeedOut(
                # The dataset id, so freshness.feedId on the catalog side points
                # here and the board's Datasets column resolves. See
                # services/catalog.py, where that field is set to the same value.
                id=dataset.id,
                name=dataset.name,
                source=sources.get(fact.data_source_id, "") if fact else "",
                cadence=cadence_label(interval),
                cadence_source=("declared" if expected is not None else ("schedule" if interval > 0 else "none")),
                expected_interval_seconds=expected,
                alert_id=armed.get(dataset.id),
                last_received_at=dataset.freshness.last_updated_at,
                status=dataset.freshness.status,
                # Structural, not a count: one query captures into one table.
                dataset_count=1,
            )
        )
    return feeds

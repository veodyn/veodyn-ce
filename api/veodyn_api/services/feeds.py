"""Feed Health, derived from the catalog rather than assembled beside it.

A feed here is a scheduled Redash query that captures into the historical
warehouse. Nothing in this stack records the upstream provider the frontend
fixtures depict: `_catalog` knows which query captured which table over which
Redash connection, not that the connection is fed by the EPA. So a feed is named
after its query and sourced by its Redash data source.

Built ON TOP of build_catalog, not next to it: a second freshness computation is
how the two surfaces come to disagree about whether a feed is fresh. Deriving
from the catalog makes them one answer, at no extra warehouse read.
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

# A query in the registry with no schedule was captured by hand at least once, so
# it belongs on the board with no cadence to be late against. Unparseable by
# `cadenceToMs`, which returns null, so `deriveFeedStatus` falls back to the
# status this service computed instead of inventing a period.
NO_SCHEDULE = "not scheduled"


def cadence_label(interval_seconds: int) -> str:
    """A Redash schedule interval as a string lib/feed-status.ts can parse back.

    The round trip is the contract: whatever this returns, `cadenceToMs` must turn
    back into the same number of seconds, because the browser decides
    fresh/stale/down by comparing that period against the last capture. A label it
    cannot parse silently disables that derivation.
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
    with no facts keeps its name, id and last capture, and loses only its cadence
    and source.

    Redash excludes drafts and archived queries from this listing, and it is one
    page, so a captured table whose query was since archived is still a feed with
    no cadence.
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

    Pure: every warehouse read already happened in build_catalog and the three
    lookups are passed in, so this board is testable with no ClickHouse or Redash.

    `expectations` wins over the schedule, keyed by feed id: it is a person saying
    how often data should arrive, and on this instance nothing is scheduled while
    everything is delivering. The schedule stays as the fallback.
    """
    declared = expectations or {}
    armed = alert_links or {}
    feeds: list[FeedOut] = []
    for dataset in datasets:
        # Only a captured dataset is a feed: a contributed one has no cadence and
        # no source, so its row would say "last received" about something nobody
        # sends. A shadowed dataset is still a capture and still belongs here.
        if dataset.origin != "capture":
            continue
        # A dataset with no last capture has never delivered anything, so it is a
        # row nobody can act on.
        if not dataset.freshness.last_updated_at:
            continue
        fact = facts.get(dataset.sample_query_id or 0)
        expected = declared.get(dataset.id)
        interval = expected if expected is not None else (fact.interval_seconds if fact else 0)
        feeds.append(
            FeedOut(
                # The dataset id, so freshness.feedId on the catalog side points
                # here (services/catalog.py sets it to the same value).
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

"""The Redash alert derived from a feed's expected interval.

A sibling of services/kpi_alert.py, built on its four rules:

- **Owned by the SERVICE ACCOUNT, never by the arming user.** Redash assigns
  `user=current_user` on create and gates later writes on
  `require_admin_or_owner`, so an admin arming someone else's feed would
  otherwise lock the owner out.
- **A sync merges, it does not replace.** Redash's `update_model` is a plain
  setattr, so posting `options` swaps the whole dict and would un-mute an alert.
- **Create writes the alert first, then commits; delete commits first, then
  deletes.** The other order destroys the alert and its subscriptions if the
  commit fails.
- **The forward link lives on the owning row.** `feed_expectation.alert_id` is
  the authority, not an `options.feed_id` label any Redash user could post.

What is new here is the query, since staleness is not a value in any result:

    SELECT dateDiff('second', max(captured_at), now()) AS seconds_since_last_row
    FROM <database>.<table>

`captured_at` is the capture layer's contract (services/ai_capture_semantics.py,
and the column glossary in services/catalog.py): one value per run, and the
tables are ORDER BY captured_at, so max() is an index read. A table without it
is refused at arm time rather than watched by a probe that can never fire.
"""

import logging
from typing import Any

from sqlalchemy.orm import Session

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.models.feed_expectation import FeedExpectation
from veodyn_api.services.redash import RedashClient

logger = logging.getLogger(__name__)

# The column the probe reads, and the one the alert compares. Named once.
PROBE_COLUMN = "seconds_since_last_row"

# The capture timestamp every table in the warehouse carries. See the module
# docstring for why this is a contract rather than a convention.
CAPTURE_COLUMN = "captured_at"

# Fresh within two periods, Stale to ten, Down beyond: the boundary
# lib/feed-status.ts already draws. The alert fires at the SAME boundary, from
# the same number.
LATE_AFTER_PERIODS = 2

# The probe runs at half the interval it polices, floored here: any less often
# and it cannot observe the boundary it exists to observe.
MIN_PROBE_INTERVAL_SECONDS = 60


def probe_sql(database: str, table: str) -> str:
    """The staleness probe for one captured table.

    Bare-string interpolation of the identifiers, safe only because `table` is a
    warehouse table name resolved from this service's own registry: the router
    never passes a caller's feed id through to here.
    """
    return f"SELECT dateDiff('second', max({CAPTURE_COLUMN}), now()) AS {PROBE_COLUMN}\nFROM {database}.{table}"


def probe_interval(expected_interval_seconds: int) -> int:
    return max(MIN_PROBE_INTERVAL_SECONDS, expected_interval_seconds // 2)


def late_after_seconds(expected_interval_seconds: int) -> int:
    return expected_interval_seconds * LATE_AFTER_PERIODS


def probe_name(feed_name: str) -> str:
    """Seeded once at creation and never rewritten, so a rename survives."""
    return f"Veodyn feed probe — {feed_name}"


def alert_name(feed_name: str) -> str:
    return f"{feed_name} is late"


def derived_options(expected_interval_seconds: int, feed_id: str) -> dict[str, Any]:
    """The half of the alert's options this service owns.

    `muted` is absent, so a resync cannot un-mute an alert someone silenced.
    `feed_id` is a LABEL for a human reading the alert in Redash, not an
    authority; the authoritative test is the forward link on the row.
    """
    return {
        "column": PROBE_COLUMN,
        "op": ">",
        "value": float(late_after_seconds(expected_interval_seconds)),
        # The probe returns exactly one row. Stated rather than left to Redash's
        # default, so a change to that default cannot move what this reads.
        "selector": "first",
        "feed_id": feed_id,
    }


def merged_options(stored: Any, expected_interval_seconds: int, feed_id: str) -> dict[str, Any]:
    """The derived keys laid over whatever Redash currently holds.

    `stored` is checked rather than trusted because it is a JSON column on the far
    side of an HTTP call: `options: ["bad"]` makes dict() raise ValueError, which
    is not an ApiError and would escape every handler above.
    """
    merged = dict(stored) if isinstance(stored, dict) else {}
    merged.update(derived_options(expected_interval_seconds, feed_id))
    merged.setdefault("muted", False)
    return merged


def arm(
    redash: RedashClient,
    *,
    feed_id: str,
    feed_name: str,
    database: str,
    table: str,
    data_source_id: int,
    expected_interval_seconds: int,
    api_key: str | None,
) -> tuple[int, int]:
    """Write the probe and its alert as the service account.

    Answers (query_id, alert_id). The query first: an alert needs a query to
    exist, and a probe left behind by a failed alert create is recoverable by
    the caller, while an alert pointing at a query that was never written is
    not.
    """
    if data_source_id <= 0:
        raise ApiError(
            ErrorId.FEED_NOT_WATCHABLE,
            f"{feed_name} has no capture query, so there is no data source to watch it on",
            status_code=422,
        )
    created_query = redash.create_query(
        name=probe_name(feed_name),
        query=probe_sql(database, table),
        data_source_id=data_source_id,
        schedule_interval=probe_interval(expected_interval_seconds),
        description=(
            "Written by Veodyn to watch how long this capture has been quiet. "
            "Editing it changes when the feed's late alert fires."
        ),
        api_key=api_key,
    )
    query_id = int(created_query["id"])
    created_alert = redash.create_alert(
        name=alert_name(feed_name),
        query_id=query_id,
        options={**derived_options(expected_interval_seconds, feed_id), "muted": False},
        # Notify once per crossing rather than on every probe run.
        rearm=None,
        api_key=api_key,
    )
    return query_id, int(created_alert["id"])


def resync(
    redash: RedashClient,
    row: FeedExpectation,
    *,
    feed_id: str,
    api_key: str | None,
) -> bool:
    """Rewrite the derived half after the expected interval changed.

    False means Redash says the alert is gone, which is a normal state: someone
    may have deleted it, and archiving the probe deletes it too. The caller
    decides whether that is a re-arm or a disarm.
    """
    alert_id = row.alert_id
    if alert_id is None:
        return False
    stored = redash.get_alert(alert_id, api_key=api_key)
    if stored is None:
        return False
    written = redash.update_alert(
        alert_id,
        payload={"options": merged_options(stored.get("options"), row.expected_interval_seconds, feed_id)},
        api_key=api_key,
    )
    return written is not None


def disarm(redash: RedashClient, row: FeedExpectation, *, api_key: str | None) -> None:
    """Take down the alert and the probe that fed it.

    The alert first, then the query: archiving a query deletes every alert on it,
    so the reverse order has delete_alert answering 404 for an alert this service
    just destroyed. Both verbs treat already-gone as done.
    """
    if row.alert_id is not None:
        redash.delete_alert(row.alert_id, api_key=api_key)
    if row.alert_query_id is not None:
        redash.archive_query(row.alert_query_id, api_key=api_key)


def clear_alert_link(db: Session, row: FeedExpectation) -> None:
    """Forget an alert Redash no longer has, in a transaction of its own.

    Its own session rather than db.commit(), which would flush every pending
    change in the caller's. The in-memory row is updated too, since callers hold it.
    """
    with Session(bind=db.get_bind()) as writer:
        stored = writer.get(FeedExpectation, (row.org_slug, row.feed_id))
        if stored is not None:
            stored.alert_id = None
            stored.alert_query_id = None
        writer.commit()
    row.alert_id = None
    row.alert_query_id = None

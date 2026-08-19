"""Response model for the Captures endpoint.

The wire shape is the contract in app/src/types/capture.ts. Do not add or
rename a field here without changing it there too: the frontend renders these
objects directly, and a drift shows up as a board that is quietly missing a
column rather than as an error.
"""

from typing import Literal

from veodyn_api.schemas.catalog import CamelModel


class CaptureOut(CamelModel):
    """One upstream capture, as the Captures board reads it.

    A capture here IS a scheduled Redash query that captures into the historical
    warehouse, so the id is the table it captures into and it matches the
    dataset of the same id one to one. That is structural rather than a
    convention worth breaking: `get_or_create_table_name` keys the registry on
    query_id and hands back exactly one table, so `dataset_count` cannot be
    anything but 1 while that holds.
    """

    id: str
    name: str
    source: str
    # The interval the board ages this feed against. An operator's declared
    # expectation when there is one, otherwise the capture query's Redash
    # schedule, otherwise NO_SCHEDULE. One field because the reader wants one
    # answer; `cadence_source` says which of the three it is.
    cadence: str
    # Where `cadence` came from, so the board can tell "the runner says hourly"
    # apart from "an operator expects hourly" apart from "nobody has said".
    # Without it the three were one unexplained string, and the middle case did
    # not exist at all: every capture here is unscheduled while its table
    # updates every forty seconds, so the board read "not scheduled" beside
    # "59 seconds ago" and lib/capture-status.ts had no period to age against.
    cadence_source: Literal["declared", "schedule", "none"]
    # Seconds, when an operator has declared one. Sent alongside the label so
    # the editing control can open on the current value without parsing prose
    # back into a number.
    expected_interval_seconds: int | None
    # The derived late-alert, when one is armed. The forward link, and therefore
    # the authority for "this alert is derived from a feed": the alert's own
    # options carry a capture_id label that any Redash user could forge.
    alert_id: int | None
    last_received_at: str
    # Never "down" from here. Down is a verdict about lateness relative to a
    # cadence, and lib/capture-status.ts derives it in the browser against the
    # reader's own clock, taking the worse of its verdict and this one. This
    # field is what the warehouse can say on its own: the capture is inside the
    # catalog's staleness window, or it is not.
    status: Literal["fresh", "stale"]
    dataset_count: int

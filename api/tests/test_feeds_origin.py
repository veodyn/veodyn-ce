"""Only a captured dataset is a feed.

Split out of test_feeds.py: that file already sits at the 300-line block on
its own account, so a build_feeds case added there would trip the hook. See
test_domains_shadowing.py for the same move made for the same reason.

Feed Health answers "is data still arriving". A dataset someone types into by
hand has no cadence, no source and no schedule, so its row would report "last
received" about something nobody sends: a row the reader cannot act on. That is
the same reasoning as the `last_updated_at` skip in build_feeds, which drops a
dataset that has never captured anything.
"""

from tests.test_feeds import dataset
from veodyn_api.services.feeds import build_feeds


def test_a_contributed_dataset_is_not_a_feed() -> None:
    """Feed Health answers "is data still arriving". A dataset someone types
    into has no cadence and no source, so the row would be unactionable, which
    is the same reason a dataset with no last capture is skipped above it."""
    typed = dataset("restrooms", query_id=0, last="2026-08-16T00:00:00Z", origin="contributed")
    captured = dataset("q_trips_9", query_id=9, last="2026-08-16T00:00:00Z")
    feeds = build_feeds([typed, captured], facts={}, sources={})
    assert [feed.id for feed in feeds] == ["q_trips_9"]


def test_a_dataset_with_capture_origin_is_still_a_feed() -> None:
    # The filter cannot silently empty the board: a plain capture, with the
    # keyword passed explicitly, must still make it through on its own.
    feeds = build_feeds(
        [dataset("q_trips_9", query_id=9, last="2026-08-16T00:00:00Z", origin="capture")],
        facts={},
        sources={},
    )
    assert [feed.id for feed in feeds] == ["q_trips_9"]

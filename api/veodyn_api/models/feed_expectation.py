from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base


class FeedExpectation(Base):
    """How often an operator expects a capture to deliver.

    Deliberately not the capture query's Redash schedule, which is what
    `services/feeds.py` already reports as `cadence`. Those are two different
    claims and the board needs both kept apart:

    - the schedule is Redash's belief about who runs the capture
    - this is an operator's belief about how often data should arrive

    On the instance this was built for, every capture query is unscheduled while
    its table updates every forty seconds or so, because something outside
    Redash drives the capture. So the board showed "not scheduled" beside a Last
    received of "59 seconds ago", and `deriveFeedStatus` (which needs a period
    to age against) fell back to repeating the upstream's own status. Nothing on
    that board was being checked. Writing a Redash schedule to fix it would have
    described a runner that is not the real one.

    Keyed on the feed id, which is the warehouse table name and is also the
    dataset id: `schemas/feed.py` documents that one-to-one as structural rather
    than conventional. So a row here can outlive a capture being dropped and
    re-added under the same table, which is the behaviour wanted.

    org_slug is part of the primary key for the reason it is on Kpi and
    Favorite: it makes a cross-tenant row impossible to address by id alone.
    """

    __tablename__ = "feed_expectation"

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    feed_id: Mapped[str] = mapped_column(Text, primary_key=True)

    # Seconds. Never zero or negative: clearing the expectation deletes the row
    # rather than storing a nought, so "no expectation" has one representation
    # and `cadence_label` cannot be handed a value it would render as
    # "not scheduled" while a row insists an expectation exists.
    expected_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False)

    # Redash's user id, never a display name: a record keyed on a mutable name
    # follows the wrong person after a rename. Same rule as Kpi.owner_user_id.
    set_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False)

    # The derived late-alert, and the staleness probe it watches. Both null
    # until someone arms it; an expectation is useful on its own, because it is
    # what lets the board judge the feed at all.
    #
    # These two are the FORWARD link, and the forward link is the authority for
    # "this alert is derived from a feed", exactly as Kpi.alert_id is for a KPI.
    # The alert's own options carry a `feed_id` label for a human reading it in
    # Redash, and that label is not evidence: any Redash user can post arbitrary
    # option keys, so a UI trusting it could be made to lock an unrelated alert.
    alert_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    alert_query_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from veodyn_api.models.base import Base


class FeedExpectation(Base):
    """How often an operator expects a capture to deliver.

    Not the capture query's Redash schedule, which `services/feeds.py` reports
    separately as `cadence`. `deriveFeedStatus` needs a period to age against,
    and the schedule cannot supply one where something outside Redash drives the
    capture.

    Keyed on the feed id, which is the warehouse table name and also the dataset
    id (`schemas/feed.py` documents that one-to-one as structural). org_slug is
    in the primary key so a cross-tenant row cannot be addressed by id alone.
    """

    __tablename__ = "feed_expectation"

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    feed_id: Mapped[str] = mapped_column(Text, primary_key=True)

    # Seconds, never zero or negative: clearing the expectation deletes the row,
    # so "no expectation" has exactly one representation.
    expected_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False)

    # Redash's user id, never a display name: a mutable name follows the wrong
    # person after a rename. Same rule as Kpi.owner_user_id.
    set_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False)

    # The derived late-alert and the staleness probe it watches, both null until
    # armed. This forward link is the only authority for "this alert is derived
    # from a feed": the alert's own `feed_id` option is caller-writable in Redash
    # and trusting it would let a UI be pointed at an unrelated alert.
    alert_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    alert_query_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

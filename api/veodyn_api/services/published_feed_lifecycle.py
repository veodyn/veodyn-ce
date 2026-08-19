"""Taking a published feed off the air when its declaration changes.

`routers/published_feeds.py` owns when this runs: on every edit and every delete,
from `update_feed` and `delete_feed`.
"""

from sqlalchemy.orm import Session

from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.publish_engine import current_artifact


def take_the_feed_off_the_air(db: Session, feed: PublishedFeed) -> None:
    """Clear the served pointer, because the declaration it was evidence for is gone.

    The engine keeps the pointer per feed and knows nothing about revisions, so
    doing nothing here would go on serving the old artifact indefinitely. An edit
    takes the feed dark until an attempt republishes under the new revision;
    deleting the binding does the same, permanently.

    `block`'s promise to keep serving the last valid artifact covers a FAILED
    ATTEMPT under an unchanged binding. `published_feed.py`'s docstring is the
    rule here: never serve bytes nothing validated in the feed's current shape.

    Cleared on EVERY edit, including `visibility` and `on_error`, which do not
    change the bytes. A list of artifact-affecting fields is one somebody has to
    remember to extend, and forgetting it fails silently; clearing unconditionally
    costs at most one publish tick.

    Delete clears it too because `publish_attempt` has no foreign key here, so
    recreating the slug would serve a new binding the dead feed's bytes.
    """
    served = current_artifact(db, feed)
    if served is not None:
        served.is_current = False

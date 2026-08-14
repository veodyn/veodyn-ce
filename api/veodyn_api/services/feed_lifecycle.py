"""Taking a published feed off the air when its declaration changes.

Split out of `routers/published_feeds.py`, which was at the project's file-size
limit before this task added the attempts endpoint to it. The router still
owns exactly when this runs (on every edit and every delete, from
`update_feed` and `delete_feed`); only the mechanics moved.
"""

from sqlalchemy.orm import Session

from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.publish_engine import current_artifact


def take_the_feed_off_the_air(db: Session, feed: PublishedFeed) -> None:
    """Clear the served pointer, because the declaration it was evidence for is gone.

    THIS IS THE DECISION THIS MODULE OWNS, and it is an act rather than an
    omission: the engine keeps the pointer per feed and knows nothing about
    revisions, so doing nothing here would go on serving the old artifact
    indefinitely. Both readings are defensible and only one can be the code's,
    so it is written down.

    A binding edit takes the feed dark until an attempt republishes under the
    new revision. Deleting the binding does the same, permanently.

    Why not keep serving it. `block`'s promise to keep serving the last valid
    artifact is a promise about a FAILED ATTEMPT under an unchanged binding: the
    artifact still answers the declaration, it is merely not fresh. An edit is a
    different event. It retires the declaration the artifact was evidence for,
    so there is no last-valid-artifact-for-this-feed left to continue serving.
    What is left is only bytes built from a column map, a query or a schedule
    reference that the feed no longer claims. `published_feed.py`'s own docstring says the endpoint
    must never serve bytes nothing validated in the feed's current shape, and
    keeping the pointer is precisely how that happens.

    Why the direction matters more than the cost. Going dark is loud, immediate,
    visible to the admin who just made the edit, and undone by the next
    successful attempt. Serving an artifact against a declaration that has moved
    is silent, indistinguishable from a healthy feed at the endpoint, and a
    consumer acting on it cannot tell. A careless edit taking a live feed down
    is the failure that reports itself.

    Why every edit and not only the material ones. `visibility` and `on_error`
    do not change what the bytes are, so a set of artifact-affecting fields
    would spare them. That set is a thing somebody has to remember to extend
    when a field lands, and forgetting fails in the silent direction: a new
    field changes the feed while the old artifact keeps being served. Clearing
    unconditionally is wrong only in the direction that announces itself, and
    costs at most one publish tick.

    Delete gets the same treatment for a sharper reason: `publish_attempt` has no
    foreign key here, so a delete leaves the artifact row behind with its pointer
    set, and recreating the slug would serve a new binding the dead feed's bytes.
    """
    served = current_artifact(db, feed)
    if served is not None:
        served.is_current = False

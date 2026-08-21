"""Who may read a PRIVATE published feed: a seam a pack fills with token
resolution.

Same shape as the seams in `registry.py`, a module-level list an import fills
in, and `extras.load_extra_modules` is what makes the pack's import happen.
Community registers nothing, so `resolve_feed_for_token` answers None for every
token and `routers/public_feeds.py` refuses a private feed exactly as it did
before this module existed.

Nothing here knows what a token is. How one is stored and issued is the pack's
business, and a resolver answering None is all of "no such token", "revoked" and
"expired" at once: the serving route cannot tell them apart, which is what keeps
them one 404 on the wire.

`published_feed_registry.py` next door is the other half of the same split. That
one says what a binding may name; this one says who may read one.
"""

from collections.abc import Callable, Iterator
from contextlib import contextmanager

from sqlalchemy.orm import Session

from veodyn_api.models.published_feed import PublishedFeed

FeedTokenResolver = Callable[[Session, str, str], PublishedFeed | None]
"""(db, slug, token) -> the feed this token grants at this slug, or None."""

_RESOLVERS: list[FeedTokenResolver] = []


def register_feed_token_resolver(resolver: FeedTokenResolver) -> None:
    """Contribute a resolver, asked in registration order."""
    _RESOLVERS.append(resolver)


def resolve_feed_for_token(db: Session, slug: str, token: str) -> PublishedFeed | None:
    """The first registered resolver's hit, or None when none of them grants it.

    The walk stops at the first answer: a resolver behind a hit is never given
    the token, since handing one credential to every installed pack is a wider
    disclosure than the single read it authorizes.
    """
    for resolver in _RESOLVERS:
        feed = resolver(db, slug, token)
        if feed is not None:
            return feed
    return None


@contextmanager
def restored_feed_token_resolvers() -> Iterator[None]:
    """Put the list back exactly as it was when the block ends.

    Registration happens at import, so there is no `unregister`. One process
    runs the whole suite, so a test's resolver left standing would hand every
    later test a build that is not the community one. See
    `registry.restored_registries`.
    """
    saved = list(_RESOLVERS)
    try:
        yield
    finally:
        _RESOLVERS[:] = saved

"""The seam a pack registers feed-token resolution through.

Community registers nothing, and `test_public_feed_token.py` is what asserts an
empty registry leaves the serving route exactly as it was. This file is about
the list itself: order, first hit wins, and that one test's registration does
not outlive its own block.

Every case takes the `db` session the resolvers are handed, rather than a stand-
in, because that argument is half the contract the pack implements against.
"""

from sqlalchemy.orm import Session

from tests.publish_stubs import make_feed
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.services.published_feed_token_registry import (
    register_feed_token_resolver,
    resolve_feed_for_token,
    restored_feed_token_resolvers,
)


def test_an_empty_registry_grants_nothing(db: Session) -> None:
    """What a community build is: every token, including a real-looking one,
    resolves to None, so the serving route has nothing to serve."""
    make_feed(db, org_slug="acme", slug="vehicles", visibility="private")

    assert resolve_feed_for_token(db, "vehicles", "any-token-at-all") is None


def test_a_registered_resolver_is_asked_and_its_feed_returned(db: Session) -> None:
    feed = make_feed(db, org_slug="acme", slug="vehicles", visibility="private")
    asked: list[tuple[str, str]] = []

    def resolver(session: Session, slug: str, token: str) -> PublishedFeed | None:
        asked.append((slug, token))
        return feed

    with restored_feed_token_resolvers():
        register_feed_token_resolver(resolver)

        assert resolve_feed_for_token(db, "vehicles", "t") is feed

    assert asked == [("vehicles", "t")]


def test_the_first_resolver_that_answers_wins_and_the_rest_are_not_asked(db: Session) -> None:
    """Registration order is the resolution order, and a hit stops the walk.

    A pack that answers must not have its answer overwritten by one registered
    after it, and a resolver behind a hit must not be given the token at all:
    handing a token to every installed pack is a wider disclosure than the read
    it authorizes.
    """
    first = make_feed(db, org_slug="acme", slug="vehicles", visibility="private")
    second = make_feed(db, org_slug="other", slug="internal", visibility="private")
    asked_second = False

    def answers_first(session: Session, slug: str, token: str) -> PublishedFeed | None:
        return first

    def answers_second(session: Session, slug: str, token: str) -> PublishedFeed | None:
        nonlocal asked_second
        asked_second = True
        return second

    with restored_feed_token_resolvers():
        register_feed_token_resolver(answers_first)
        register_feed_token_resolver(answers_second)

        assert resolve_feed_for_token(db, "vehicles", "t") is first

    assert asked_second is False


def test_a_resolver_answering_none_falls_through_to_the_next(db: Session) -> None:
    """None is "not mine", not "refused for everybody". Two packs can each own
    some feeds, and the one that knows this token is not always the first."""
    feed = make_feed(db, org_slug="acme", slug="vehicles", visibility="private")

    def knows_nothing(session: Session, slug: str, token: str) -> PublishedFeed | None:
        return None

    def knows_it(session: Session, slug: str, token: str) -> PublishedFeed | None:
        return feed

    with restored_feed_token_resolvers():
        register_feed_token_resolver(knows_nothing)
        register_feed_token_resolver(knows_it)

        assert resolve_feed_for_token(db, "vehicles", "t") is feed


def test_a_registration_does_not_outlive_its_block(db: Session) -> None:
    """One process runs the whole suite, so a resolver left standing would hand
    every later test a build that is not the community one. See
    `registry.restored_registries`, which this mirrors."""
    feed = make_feed(db, org_slug="acme", slug="vehicles", visibility="private")

    def resolver(session: Session, slug: str, token: str) -> PublishedFeed | None:
        return feed

    with restored_feed_token_resolvers():
        register_feed_token_resolver(resolver)
        assert resolve_feed_for_token(db, "vehicles", "t") is feed

    assert resolve_feed_for_token(db, "vehicles", "t") is None

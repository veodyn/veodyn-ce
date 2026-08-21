"""Keeping a feed token out of this service's own access log.

Uvicorn formats the access line's path WITH its query string
(`protocols/utils.get_path_with_query_string`), and `?token=` is the transport
`routers/public_feeds.py` offers first, because a great many feed pollers are a
URL field and nothing else. Left alone, every poll of a private feed writes the
credential into our log, where it outlives the request, gets shipped, and gets
read by people the feed was never shared with.

A URL-borne credential is a tradeoff about intermediaries nobody here controls.
This log is not one of those, so it is redacted.

A logging FILTER, not a formatter and not middleware. Uvicorn writes this line
itself, outside the ASGI app, so no middleware can reach it; and a filter
rewrites the record before any handler formats it, so a deployment that swaps in
its own formatter or adds a second handler does not quietly start logging the
token again.
"""

import logging

REDACTED = "REDACTED"

# The one surface that takes a feed token. Scoped rather than global: every other
# route's access line has to read exactly as it did, and a service-wide rewrite
# of anything spelled `token` would edit lines this change has no business in.
FEED_PATH_PREFIX = "/public/feeds"

# Matched by name, and case-sensitively, because that is how the route reads it:
# `?TOKEN=` is not a credential this service accepts.
TOKEN_PARAM = "token"

ACCESS_LOGGER = "uvicorn.access"


def redact_feed_token(path: str) -> str:
    """`/public/feeds/x?token=abc` -> `...?token=REDACTED`. Anything else as is.

    Operates on the raw query string uvicorn logs, so a percent-encoded value is
    replaced whole rather than decoded first.
    """
    if not path.startswith(FEED_PATH_PREFIX):
        return path
    base, separator, query = path.partition("?")
    if not separator:
        return path
    pairs = []
    for pair in query.split("&"):
        name, equals, _value = pair.partition("=")
        # No `=` is a parameter carrying no value, and inventing one would put a
        # credential-shaped string in the log that nobody sent.
        pairs.append(f"{name}={REDACTED}" if name == TOKEN_PARAM and equals else pair)
    return f"{base}?{'&'.join(pairs)}"


class RedactFeedToken(logging.Filter):
    """Rewrite a feed token out of an access record before it is formatted."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Every string argument is offered to the redactor rather than the one at
        # uvicorn's current index: only a feed path with a token in it changes,
        # so scanning cannot damage anything, and the filter does not break the
        # day uvicorn reorders its own format string.
        if not isinstance(record.args, tuple):
            return True
        record.args = tuple(
            redact_feed_token(argument) if isinstance(argument, str) else argument for argument in record.args
        )
        return True


def install_feed_token_redaction(logger_name: str = ACCESS_LOGGER) -> bool:
    """Attach the filter to the access logger, once. True if it was added.

    Called from `create_app`, so it is active under the image's own
    `uvicorn veodyn_api.main:app` and not only under some dev entrypoint.
    Uvicorn configures logging in `Config.__init__` and imports the app
    afterwards in `Config.load`, so a filter added at app import is not undone by
    a later `dictConfig`.
    """
    logger = logging.getLogger(logger_name)
    if any(isinstance(existing, RedactFeedToken) for existing in logger.filters):
        return False
    logger.addFilter(RedactFeedToken())
    return True

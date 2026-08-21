"""A feed token must not survive into this service's own access log.

Uvicorn formats the access line's path WITH its query string
(`protocols/utils.get_path_with_query_string`), and `?token=` is the transport
`routers/public_feeds.py` offers first, so every poll of a private feed would
write the credential into our log. Presenting a token in a URL is a tradeoff
about intermediaries nobody here controls; this log is not one of those.

Asserted on the filter and on the rendered line, not through a served request:
uvicorn writes that line itself, outside the ASGI app, so no TestClient request
produces one.
"""

import logging

from veodyn_api.access_log import REDACTED, RedactFeedToken, install_feed_token_redaction, redact_feed_token

ACCESS_FORMAT = '%s - "%s %s HTTP/%s" %d'
CLIENT = "10.0.0.7:52341"
SECRET = "s3cret-token-value"


def access_record(path: str) -> logging.LogRecord:
    """The record uvicorn logs, argument for argument.

    Built by hand rather than captured, because the shape of this record IS the
    contract being relied on: uvicorn passes the path as one positional argument
    and the formatter interpolates it later, which is what makes a filter able to
    rewrite it at all.
    """
    return logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg=ACCESS_FORMAT,
        args=(CLIENT, "GET", path, "1.1", 200),
        exc_info=None,
    )


def filtered(path: str) -> str:
    record = access_record(path)
    assert RedactFeedToken().filter(record) is True
    return record.getMessage()


def test_the_logged_line_keeps_everything_except_the_token_value() -> None:
    """The whole line, compared exactly. A redaction that also dropped the slug,
    the status or the client address would take the log's usefulness with it,
    and "the secret is gone" alone cannot see that."""
    line = filtered(f"/public/feeds/vehicles?token={SECRET}")

    assert SECRET not in line
    assert line == f'{CLIENT} - "GET /public/feeds/vehicles?token={REDACTED} HTTP/1.1" 200'


def test_a_member_file_address_is_redacted_the_same_way() -> None:
    """Both routes take the token, so both write it. The member route is the one
    a GBFS consumer polls most often."""
    line = filtered(f"/public/feeds/bikes/station_status.json?token={SECRET}")

    assert SECRET not in line
    assert f"/public/feeds/bikes/station_status.json?token={REDACTED}" in line


def test_the_other_query_parameters_survive_in_their_own_order() -> None:
    assert (
        redact_feed_token(f"/public/feeds/vehicles?format=json&token={SECRET}&trace=1")
        == f"/public/feeds/vehicles?format=json&token={REDACTED}&trace=1"
    )


def test_a_feed_address_with_no_query_string_is_left_exactly_alone() -> None:
    assert redact_feed_token("/public/feeds/vehicles") == "/public/feeds/vehicles"


def test_a_route_that_is_not_a_feed_is_not_rewritten() -> None:
    """Scoped to the one surface that takes a feed token. Every other route's
    access line has to read as it did, so this cannot become a global rewrite of
    anything spelled `token`."""
    other = f"/published-feeds/vehicles?token={SECRET}"

    assert redact_feed_token(other) == other


def test_only_the_parameter_named_token_is_touched() -> None:
    """Matched by NAME, not as a substring: a parameter that merely contains the
    word is a different parameter, and rewriting it would corrupt a log line
    while pretending to protect something."""
    path = f"/public/feeds/vehicles?tokenish=keep&not_token=keep&x=token={SECRET}"

    assert redact_feed_token(path) == path


def test_a_valueless_token_parameter_is_left_as_it_is() -> None:
    """`?token` with no `=` carries no value to hide, and inventing one would put
    a credential-shaped string in the log that nobody ever sent."""
    assert redact_feed_token("/public/feeds/vehicles?token") == "/public/feeds/vehicles?token"


def test_a_record_that_is_not_shaped_like_an_access_line_passes_through() -> None:
    """The filter sits on a logger, so it sees whatever else is logged there.
    Anything it does not recognize is left untouched and still emitted."""
    record = logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="a plain message with no args",
        args=None,
        exc_info=None,
    )

    assert RedactFeedToken().filter(record) is True
    assert record.getMessage() == "a plain message with no args"


def test_installing_it_twice_leaves_one_filter_on_the_access_logger() -> None:
    """`create_app` runs once per process in the container and many times in this
    suite. A filter appended per call would stack up copies of itself."""
    logger = logging.getLogger("veodyn-test.access")
    logger.filters = []
    try:
        assert install_feed_token_redaction(logger.name) is True
        assert install_feed_token_redaction(logger.name) is False

        assert len([one for one in logger.filters if isinstance(one, RedactFeedToken)]) == 1
    finally:
        logger.filters = []


def test_the_app_installs_it_on_the_logger_uvicorn_actually_writes_to() -> None:
    """The name is the contract with uvicorn: `uvicorn.access` is the logger its
    access line goes to, and a filter on any other name protects nothing.

    Uvicorn configures logging in `Config.__init__` and imports the app after,
    in `Config.load`, so a filter installed at app import survives to the first
    request rather than being dropped by a later dictConfig.
    """
    from veodyn_api.main import create_app

    create_app()

    installed = [one for one in logging.getLogger("uvicorn.access").filters if isinstance(one, RedactFeedToken)]
    assert len(installed) == 1

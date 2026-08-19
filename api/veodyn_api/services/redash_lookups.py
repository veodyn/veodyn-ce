"""Small Redash reads that label something this service already assembled.

A lookup lands here once a SECOND feature needs it.

The auth posture is the CALLER's choice, so both credentials are parameters and
neither has a default. AI grounding runs as the Redash service account, because
the relay in veodyn-de strips the browser cookie and this service cannot know who
is asking. Feed Health runs as the reader, so a data source they cannot see goes
unnamed rather than named for them.
"""

import logging

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash import RedashClient

logger = logging.getLogger(__name__)

WAREHOUSE_SOURCE_TYPE = "clickhouse"
"""Redash derives a runner's type from its class name, so the ClickHouse runner
in `node/redash/query_runner/clickhouse.py` registers under this string."""


def data_source_names(
    redash: RedashClient, *, api_key: str | None = None, cookie: str | None = None
) -> dict[int, str]:
    """Every data source this credential can see, id to name.

    Empty means "we could not find out", and every caller treats it that way: the
    thing being labelled comes back unlabelled rather than not at all.
    """
    try:
        sources = redash.list_data_sources(api_key=api_key, cookie=cookie)
    except ApiError:
        logger.info("could not list the data sources; what they label goes unnamed")
        return {}
    return {
        source["id"]: name
        for source in sources
        if isinstance(source.get("id"), int) and (name := str(source.get("name") or "").strip())
    }


def warehouse_data_source_id(redash: RedashClient, *, api_key: str | None = None, cookie: str | None = None) -> int:
    """The data source a query against the historical warehouse must be bound to.

    Discovered rather than configured, so an instance that already has a working
    ClickHouse connection needs no values-file line to gain one. The credential
    is the SERVICE account's at every call site, because the queries this
    answers for are written and run by the service account, not by the author
    binding them.

    Raises rather than falling back, and that is the whole point of the
    function. The two writers it serves each used to bind the query to the data
    source of the query the capture came from, which is the API connector that
    ingests the feed: those runners parse query text as JSON, so every generated
    query failed on its first character. A fallback here would restore exactly
    that.

    Nothing to pick from and more than one are the same refusal because the
    caller's move is the same in both: fix the Redash data sources. Guessing
    between two would be worse than refusing, since the wrong warehouse still
    answers and the KPI would simply be wrong.
    """
    sources = redash.list_data_sources(api_key=api_key, cookie=cookie)
    warehouses = [
        source_id
        for source in sources
        if isinstance(source_id := source.get("id"), int)
        and str(source.get("type") or "").strip() == WAREHOUSE_SOURCE_TYPE
    ]
    if len(warehouses) != 1:
        raise ApiError(
            ErrorId.WAREHOUSE_SOURCE_UNRESOLVABLE,
            f"this deployment has {len(warehouses)} redash data sources of type "
            f"{WAREHOUSE_SOURCE_TYPE!r}, so there is no one warehouse to run a generated query on",
            status_code=503,
        )
    return warehouses[0]

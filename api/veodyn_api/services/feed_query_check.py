"""Whether the query behind a binding is there and this service can read it.

Split out of `routers/published_feeds.py` to keep that router under the
project's file-size limit after this task added the attempts endpoint. `_check`
next door in the router still owns when this runs: before `query_result_columns`
is ever called, on every create and every edit.
"""

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash import RedashClient
from veodyn_api.settings import Settings


def require_a_readable_query(redash: RedashClient, settings: Settings, query_id: int) -> None:
    """Prove the query is there and this service can read it. Separate call, on purpose.

    `query_result_columns` cannot answer this question. It turns EVERY failure
    into `()` (no such query, no permission on it, Redash 5xx), and its own
    docstring says `()` means "we could not find out", never "it has none".
    `check_column_map` reads `()` as `unvalidated`, the right answer for a query
    that has simply never run and the wrong one for a query nobody can see.
    Conflated, a typoed `queryId` is ACCEPTED: the write lands, the revision
    bumps, the served pointer is cleared, and a working feed goes dark on a 200.

    So existence and readability come first, from the same cheap metadata read
    the KPI source gate makes, which fails closed on every non-success. Only then
    does `()` mean what the check believes it means.
    """
    try:
        redash.get_query(query_id, api_key=settings.redash_service_api_key)
    except ApiError as unreadable:
        if unreadable.error_id is not ErrorId.KPI_SOURCE_UNRESOLVABLE:
            # Redash being unreachable is not a verdict about the query and must
            # not be reported as one. It keeps its own 503, and either way
            # nothing here has been written.
            raise
        raise ApiError(
            ErrorId.PUBLISHED_FEED_QUERY_UNREADABLE,
            f"query {query_id} does not exist or this service cannot read it",
            status_code=422,
        ) from unreadable

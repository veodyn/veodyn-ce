"""The rows an attempt publishes, read from the query's last cached result.

Deliberately NOT `ai_grounding.query_result_columns`, which turns every failure
into `()` and says so in its own docstring. That economy is right for a hint
nobody acts on and wrong here: publishing bytes built from a result we could not
actually read is the failure this whole design exists to prevent. So this raises.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash import RedashClient


@dataclass(frozen=True)
class LatestResult:
    result_id: int
    rows: list[dict[str, Any]]
    # Epoch seconds. The engine never reads a clock, so the caller owns it, and
    # the honest value is when the DATA was retrieved rather than when the
    # button was pressed: the validator's freshness rules are about the feed.
    retrieved_at: int


def _epoch(raw: object, query_id: int) -> int:
    """Redash's ISO timestamp as epoch seconds. Refuses whatever it cannot read.

    This value becomes the GTFS header timestamp, which is the thing the
    validator's freshness rules judge and the thing a consumer trusts to decide
    how old the data is. Substituting the wall clock would publish a header
    swearing that hours-old rows had just been retrieved, and the feed would
    then validate cleanly precisely because it lied.

    So this refuses, like everything else on the publish path: an unconfigured
    validator refuses, an unreadable query refuses, a result that is not newer
    refuses. Not publishing is visible and recoverable. Publishing a timestamp
    nobody can stand behind is neither.
    """
    parsed: datetime | None = None
    if isinstance(raw, str):
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            parsed = None
    if parsed is None:
        raise ApiError(
            ErrorId.PUBLISHED_FEED_NO_RESULT,
            f"the cached result for query {query_id} does not say when it was retrieved, "
            "so the feed header cannot honestly state its age",
            status_code=422,
        )
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return int(parsed.timestamp())


def latest_result(redash: RedashClient, query_id: int, api_key: str) -> LatestResult:
    """The query's last cached result. Raises when there is not one to publish.

    Two reads, the same pair `query_result_columns` makes: the query for its
    `latest_query_data_id`, then that result for its rows. Errors from the
    client (an unreadable query, Redash down) propagate as themselves, because
    "we could not ask" must never be reported as "there is nothing there".
    """
    query = redash.get_query(query_id, api_key=api_key)
    result_id = query.get("latest_query_data_id")
    if not isinstance(result_id, int):
        raise ApiError(
            ErrorId.PUBLISHED_FEED_NO_RESULT,
            f"query {query_id} has no cached result yet, so there is nothing to publish",
            status_code=422,
        )

    payload = redash.get_query_result(result_id, api_key=api_key)
    result = payload.get("query_result")
    inner = result.get("data") if isinstance(result, dict) else None
    rows = inner.get("rows") if isinstance(inner, dict) else None
    if not isinstance(rows, list):
        raise ApiError(
            ErrorId.PUBLISHED_FEED_NO_RESULT,
            f"the cached result for query {query_id} carries no rows",
            status_code=422,
        )

    if any(not isinstance(row, dict) for row in rows):
        # Refused whole, never filtered. Dropping the rows that are not objects
        # publishes a shorter feed that validates perfectly cleanly, which is the
        # silent-drop failure this design exists to prevent, and it is invisible
        # at the endpoint: `gtfs_rt_serializer` holds the same line about mapped
        # values, so the reader on the other side has no way to tell.
        raise ApiError(
            ErrorId.PUBLISHED_FEED_NO_RESULT,
            f"the cached result for query {query_id} carries a row that is not an object, "
            "and publishing the rest would drop it without saying so",
            status_code=422,
        )

    retrieved_at = result.get("retrieved_at") if isinstance(result, dict) else None
    return LatestResult(
        result_id=result_id,
        rows=list(rows),
        retrieved_at=_epoch(retrieved_at, query_id),
    )

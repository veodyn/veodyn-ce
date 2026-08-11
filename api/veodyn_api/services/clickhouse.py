"""Read-only HTTP client for the historical warehouse.

Redash writes that warehouse (node/redash/historical/); this service only
reads it, so there is no insert or DDL here on purpose. Adding one would give
this service a second writer of a schema it does not own.

Statement style mirrors services/redash.py: every upstream failure becomes a
named ApiError rather than an unexplained 500.
"""

from typing import Any

import httpx

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.settings import Settings

# ClickHouse's own codes for "the thing you named is not there", as opposed to
# every other reason a read can fail. Both arrive as HTTP 404 with the code in
# the body; nothing else this service reads answers 404.
UNKNOWN_TABLE = 60
UNKNOWN_DATABASE = 81


class WarehouseTableMissing(ApiError):
    """The warehouse answered, and the table or database is simply not there.

    Its own class so a caller can tell "there is nothing captured yet" from
    "the warehouse is broken", which are the same 502 to anyone who does not
    care and very different answers to a user looking at an empty catalog on a
    fresh install. Still an ApiError with the same id and status, so a caller
    that does not catch it behaves exactly as before.
    """


def _failure(response: httpx.Response) -> tuple[int | None, str]:
    """The ClickHouse error code and a readable reason, out of a failed read.

    Every statement this client sends ends `FORMAT JSON`, so a failure comes
    back as a JSON document carrying an `exception` string, NOT as plain text.
    The previous version of this took the first line of the body, which for a
    JSON document is always `{`, so the only message this error path could ever
    produce was `the historical warehouse refused a read: {`. Both forms are
    handled here because a proxy or a gateway in front of ClickHouse can answer
    with neither.
    """
    body = response.text.strip()
    try:
        payload = response.json()
    except ValueError:
        payload = None
    exception = payload.get("exception") if isinstance(payload, dict) else None
    if isinstance(exception, str) and exception:
        # "Code: 60. DB::Exception: Unknown table expression ..."
        code = None
        head, _, _ = exception.partition(".")
        digits = head.removeprefix("Code:").strip()
        if digits.isdigit():
            code = int(digits)
        return code, exception
    first_line = body.splitlines()[:1]
    return None, first_line[0] if first_line else str(response.status_code)


class ClickHouseClient:
    def __init__(self, settings: Settings) -> None:
        self._url = settings.clickhouse_url.rstrip("/")
        self._auth = (settings.clickhouse_user, settings.clickhouse_password)
        self._timeout = settings.clickhouse_timeout_seconds
        # Which database an UNQUALIFIED name resolves in. Without it the HTTP
        # interface uses the connection's own default, which is not the one the
        # captures live in.
        #
        # This service used to hide the problem rather than not have it: every
        # statement it wrote named `historical.<table>` in full, so nothing
        # noticed. A dataset's id is the BARE table name, though, so the moment
        # anything built a statement from an id (profiling a table, DESCRIBE-ing
        # a generated SELECT that names the table the model was given) it read a
        # database that has no such table. The error is swallowed one layer up,
        # so the symptom was not a failure: it was an assistant that silently
        # never had a profile and never had chart options.
        self._database = settings.clickhouse_database

    @property
    def configured(self) -> bool:
        return bool(self._url)

    def query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Run a SELECT and return its rows.

        Values are passed as ClickHouse query parameters ({name:Type}) rather
        than interpolated, so a table name coming from the catalog table cannot
        end a statement and start another one.
        """
        if not self.configured:
            raise ApiError(
                ErrorId.WAREHOUSE_NOT_CONFIGURED,
                "no historical warehouse is configured for this instance",
                status_code=503,
            )

        # A qualified name in the statement still wins, so every statement this
        # service already wrote is unaffected, including the system.* reads.
        query_params: dict[str, Any] = {f"param_{key}": value for key, value in (params or {}).items()}
        if self._database:
            query_params["database"] = self._database
        try:
            response = httpx.post(
                self._url,
                content=f"{sql}\nFORMAT JSON",
                params=query_params,
                auth=self._auth,
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise ApiError(
                ErrorId.WAREHOUSE_UNREACHABLE,
                "the historical warehouse is not answering",
                status_code=502,
            ) from exc

        if response.status_code >= 400:
            code, reason = _failure(response)
            cause = WarehouseTableMissing if code in (UNKNOWN_TABLE, UNKNOWN_DATABASE) else ApiError
            raise cause(
                ErrorId.WAREHOUSE_UNREACHABLE,
                f"the historical warehouse refused a read: {reason}",
                status_code=502,
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise ApiError(
                ErrorId.WAREHOUSE_UNREACHABLE,
                "the historical warehouse returned a non-JSON body",
                status_code=502,
            ) from exc

        data = payload.get("data") if isinstance(payload, dict) else None
        return data if isinstance(data, list) else []


def get_clickhouse_client(settings: Settings) -> ClickHouseClient:
    return ClickHouseClient(settings)

"""Reading a Redash response body without turning a bad one into a 500.

Split out of redash.py, which is the HTTP client itself. These three are the
decoding half: what to do with a body once it has arrived, and how to fail when
it is not the shape the caller was promised. They are pure, so they are testable
without a transport, and the client file stays about the calls it makes.

The rule they share: an upstream that answers oddly is named as the cause. A
Redash upgrade that changes a payload shape, a reverse proxy returning an HTML
error page, an unauthenticated request answered with a login redirect: each of
those has a cause worth reporting, and each of them reaches the reader as an
unexplained 500 if the body is indexed into directly.
"""

from typing import Any

import httpx

from veodyn_api.errors import ApiError, ErrorId


def json_object(response: httpx.Response, what: str) -> dict[str, Any]:
    """Decode a Redash response body, or fail with a cause instead of a 500.

    Redash does not always answer with JSON: a reverse proxy can return an HTML
    error page, and a Flask traceback is HTML too. Calling .json() straight
    through turns that into a JSONDecodeError, which reaches the client as an
    unexplained 500 rather than "the upstream is not answering properly".
    """
    try:
        payload = response.json()
    except ValueError as exc:
        raise ApiError(
            ErrorId.REDASH_UNREACHABLE,
            f"redash returned a non-JSON body for {what}",
            status_code=502,
        ) from exc
    if not isinstance(payload, dict):
        raise ApiError(
            ErrorId.REDASH_UNREACHABLE,
            f"redash returned an unexpected body for {what}",
            status_code=502,
        )
    return payload


def dig(payload: dict[str, Any], path: tuple[str, ...], what: str) -> Any:
    """Walk a nested key path, naming the upstream when the shape is not there.

    Indexing straight into a Redash payload makes any upstream shape change a
    KeyError, so a Redash upgrade would surface as a 500 with no indication
    that Redash is the reason.
    """
    cursor: Any = payload
    for key in path:
        if not isinstance(cursor, dict) or key not in cursor:
            raise ApiError(
                ErrorId.QUERY_EXECUTION_FAILED,
                f"redash response for {what} has no {'.'.join(path)}",
                status_code=502,
            )
        cursor = cursor[key]
    return cursor


def auth_headers(api_key: str | None, cookie: str | None) -> dict[str, str]:
    headers = {"accept": "application/json"}
    if api_key:
        headers["authorization"] = f"Key {api_key}"
    if cookie:
        headers["cookie"] = cookie
    return headers

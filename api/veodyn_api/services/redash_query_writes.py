"""Writing a query this service authored, mixed into RedashClient.

Its own file for the reason redash_alerts.py is: redash.py holds the read
surface and is already at the size the project allows. Nothing here opens a
connection of its own; every call goes back through the client's own transport.

Only two verbs, and only enough of each for the one caller that needs them.
This service creates exactly one kind of query, the staleness probe behind a
feed's derived alert (services/capture_alert.py). It is not a general query-writing
API and should not grow into one: a query authored here has no author on screen
to correct it, so every field it carries has to be decided by code that can be
read in one place.
"""

from abc import ABC, abstractmethod
from typing import Any

import httpx

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash_payload import auth_headers, json_object


def _refuse(response: httpx.Response, refusal: str) -> None:
    """The same classification redash_alerts uses, for the same reason.

    One outage reported under two causes depending on which call was in flight
    is two support threads for one incident. A redirect counts as a refusal
    because an unauthenticated Redash answers @login_required with a 302.
    """
    if response.status_code >= 500:
        raise ApiError(ErrorId.REDASH_UNREACHABLE, f"redash returned {response.status_code}", status_code=503)
    if response.status_code >= 400 or response.is_redirect:
        raise ApiError(ErrorId.FEED_ALERT_SYNC_FAILED, f"{refusal} ({response.status_code})", status_code=502)


class QueryWriteVerbs(ABC):
    """The query-authoring half of RedashClient. Mixed in, never alone."""

    @abstractmethod
    def _post(self, path: str, headers: dict[str, str], json: dict[str, Any]) -> httpx.Response: ...

    @abstractmethod
    def _delete(self, path: str, headers: dict[str, str]) -> httpx.Response: ...

    def create_query(
        self,
        *,
        name: str,
        query: str,
        data_source_id: int,
        schedule_interval: int | None = None,
        description: str = "",
        api_key: str | None = None,
        cookie: str | None = None,
    ) -> dict[str, Any]:
        """The new query, guaranteed to carry an int `id`.

        Published, not a draft: Redash creates queries as drafts, and an alert
        on a draft query is invisible to everyone but its author. The id is
        checked here rather than by the caller for the reason create_alert
        checks its own: a 200 of `{}` would otherwise leak a KeyError out of the
        arm path as an unexplained 500.
        """
        payload: dict[str, Any] = {
            "name": name,
            "query": query,
            "data_source_id": data_source_id,
            "description": description,
            "is_draft": False,
            "options": {},
        }
        if schedule_interval is not None:
            payload["schedule"] = {"interval": schedule_interval, "until": None, "day_of_week": None, "time": None}
        response = self._post("/api/queries", auth_headers(api_key, cookie), payload)
        _refuse(response, "redash refused to create the query")
        created = json_object(response, "the new query")
        query_id = created.get("id")
        if not isinstance(query_id, int) or isinstance(query_id, bool):
            raise ApiError(
                ErrorId.FEED_ALERT_SYNC_FAILED,
                "redash answered the create with no usable query id",
                status_code=502,
            )
        return created

    def archive_query(self, query_id: int, *, api_key: str | None = None, cookie: str | None = None) -> bool:
        """True when it was archived, False when Redash says it is already gone.

        Archive, not delete, because that is all Redash's DELETE does
        (QueryResource.delete calls query.archive). Worth knowing at the call
        site: archiving deletes every alert on the query, so a caller that
        archives the probe has also disarmed it and must not then try to delete
        the alert separately and read the 404 as a failure.
        """
        response = self._delete(f"/api/queries/{query_id}", auth_headers(api_key, cookie))
        if response.status_code == 404:
            return False
        _refuse(response, f"redash refused to archive query {query_id}")
        return True

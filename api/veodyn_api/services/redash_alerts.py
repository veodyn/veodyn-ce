"""The derived KPI alert verbs, mixed into RedashClient.

Nothing here opens a connection of its own: every call goes back through the
client's own transport, so RedashClient stays the only place in this service that
speaks HTTP to Redash.

The shared rules of this file:

- a Redash refusal is mapped onto a named cause rather than escaping as an
  httpx error, and "already gone" is not a refusal,
- every verb classifies a status the same way, through `_refuse`, so one outage
  does not report as REDASH_UNREACHABLE or KPI_ALERT_SYNC_FAILED depending on
  which call was in flight,
- a 200 is not a contract. A body is checked here, at the boundary, so no
  caller has to index into whatever arrived.
"""

from abc import ABC, abstractmethod
from typing import Any

import httpx

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash_payload import auth_headers, json_object


def _refuse(response: httpx.Response, refusal: str) -> None:
    """Raise the named cause this status deserves, or return quietly.

    5xx is Redash being unwell and the fix is to wait; a 4xx or a redirect is this
    service asking for something Redash will not do. A redirect counts as a
    refusal because an unauthenticated Redash answers @login_required with a 302.
    """
    if response.status_code >= 500:
        raise ApiError(ErrorId.REDASH_UNREACHABLE, f"redash returned {response.status_code}", status_code=503)
    if response.status_code >= 400 or response.is_redirect:
        raise ApiError(ErrorId.KPI_ALERT_SYNC_FAILED, f"{refusal} ({response.status_code})", status_code=502)


class AlertVerbs(ABC):
    """The alert half of RedashClient. Mixed in, never instantiated alone.

    The three transport methods are declared and not implemented: the client this
    is mixed into supplies them, and declaring them is what lets the bodies below
    be type-checked rather than standing on an untyped `self`.
    """

    @abstractmethod
    def _get(self, path: str, headers: dict[str, str], params: dict[str, Any] | None = None) -> httpx.Response: ...

    @abstractmethod
    def _post(self, path: str, headers: dict[str, str], json: dict[str, Any]) -> httpx.Response: ...

    @abstractmethod
    def _delete(self, path: str, headers: dict[str, str]) -> httpx.Response: ...

    def get_alert(
        self, alert_id: int, *, api_key: str | None = None, cookie: str | None = None
    ) -> dict[str, Any] | None:
        """The alert, or None when Redash says it is gone.

        404 is a return value rather than a raise because it is a NORMAL state:
        deleting the alert is a legitimate way to disarm a KPI, and
        Query.archive() deletes every alert attached to the query. The worker's
        repair pass turns this None into a cleared alert_id.
        """
        response = self._get(f"/api/alerts/{alert_id}", auth_headers(api_key, cookie))
        if response.status_code == 404:
            return None
        _refuse(response, f"alert {alert_id} is not readable")
        return json_object(response, f"alert {alert_id}")

    def create_alert(
        self,
        *,
        name: str,
        query_id: int,
        options: dict[str, Any],
        rearm: int | None = None,
        api_key: str | None = None,
        cookie: str | None = None,
    ) -> dict[str, Any]:
        """The new alert, guaranteed to carry an int `id`.

        The id is checked here because it is the one field the KPI row stores: a
        200 of `{}` would leak a KeyError and `{"id": null}` a TypeError out of
        kpi_alert.arm as an unexplained 500. Refused rather than coerced, so a
        Redash version that starts sending something else is not hidden.
        """
        payload: dict[str, Any] = {"name": name, "query_id": query_id, "options": options, "rearm": rearm}
        response = self._post("/api/alerts", auth_headers(api_key, cookie), payload)
        _refuse(response, "redash refused to create the alert")
        created = json_object(response, "the new alert")
        alert_id = created.get("id")
        if not isinstance(alert_id, int) or isinstance(alert_id, bool):
            raise ApiError(
                ErrorId.KPI_ALERT_SYNC_FAILED,
                "redash answered the create with no usable alert id",
                status_code=502,
            )
        return created

    def update_alert(
        self,
        alert_id: int,
        *,
        payload: dict[str, Any],
        api_key: str | None = None,
        cookie: str | None = None,
    ) -> dict[str, Any] | None:
        """The updated alert, or None when Redash says it is gone.

        404 mirrors get_alert: an alert deleted between that read and this write is
        the same "already gone" state, and resync has to answer False for both. As
        a raise, a real deletion is indistinguishable from a retryable refusal.
        """
        response = self._post(f"/api/alerts/{alert_id}", auth_headers(api_key, cookie), payload)
        if response.status_code == 404:
            return None
        _refuse(response, f"redash refused to update alert {alert_id}")
        return json_object(response, f"alert {alert_id}")

    def delete_alert(self, alert_id: int, *, api_key: str | None = None, cookie: str | None = None) -> bool:
        """True when it was deleted, False when Redash says it was already gone.

        Already-gone is a success for every caller here: disarm, KPI delete and
        the worker's repair all want the alert not to exist afterwards.
        """
        response = self._delete(f"/api/alerts/{alert_id}", auth_headers(api_key, cookie))
        if response.status_code == 404:
            # Not provably a deletion: Redash answers 404 for an alert in ANOTHER
            # organization (node/tests/handlers/test_alerts.py pins that), so this
            # cannot tell "gone" from "not yours". Safe only while the worker and
            # the routers hold ONE org's service key. Spec section 15, multi-org.
            return False
        _refuse(response, f"redash refused to delete alert {alert_id}")
        return True

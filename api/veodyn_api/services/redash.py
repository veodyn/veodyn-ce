import time
from typing import Any

import httpx

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash_alerts import AlertVerbs
from veodyn_api.services.redash_payload import auth_headers, dig, json_object
from veodyn_api.services.redash_query_writes import QueryWriteVerbs

# Redash's own job status codes (serializers/__init__.py): 1 queued, 2 started,
# 3 finished, 4 failed, 5 cancelled.
JOB_FINISHED = 3
JOB_FAILED = 4
JOB_CANCELLED = 5
POLL_INTERVAL_SECONDS = 0.5


class RedashClient(AlertVerbs, QueryWriteVerbs):
    """The only place in this service that speaks HTTP to Redash.

    Redirects are never followed: Redash's @login_required answers an
    unauthenticated request with a 302 to the login page, and following it
    would turn "not signed in" into a 200 with an HTML body.

    The KPI alert verbs are mixed in from redash_alerts.py rather than
    written here, because this file is already at the size the project
    allows. They still call back through the three transport methods below,
    so the sentence above stays true: there is one client and one place
    that decides how a Redash refusal is named.
    """

    def __init__(self, base_url: str, timeout: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.Client(timeout=timeout, follow_redirects=False)

    def _get(self, path: str, headers: dict[str, str], params: dict[str, Any] | None = None) -> httpx.Response:
        try:
            return self._client.get(f"{self._base_url}{path}", headers=headers, params=params)
        except httpx.HTTPError as exc:
            raise ApiError(ErrorId.REDASH_UNREACHABLE, f"redash unreachable: {exc}", status_code=503) from exc

    def _post(self, path: str, headers: dict[str, str], json: dict[str, Any]) -> httpx.Response:
        try:
            return self._client.post(f"{self._base_url}{path}", headers=headers, json=json)
        except httpx.HTTPError as exc:
            raise ApiError(ErrorId.REDASH_UNREACHABLE, f"redash unreachable: {exc}", status_code=503) from exc

    def _delete(self, path: str, headers: dict[str, str]) -> httpx.Response:
        try:
            return self._client.delete(f"{self._base_url}{path}", headers=headers)
        except httpx.HTTPError as exc:
            raise ApiError(ErrorId.REDASH_UNREACHABLE, f"redash unreachable: {exc}", status_code=503) from exc

    def get_session(self, cookie: str | None, authorization: str | None) -> dict[str, Any]:
        headers = {"accept": "application/json"}
        if cookie:
            headers["cookie"] = cookie
        if authorization:
            headers["authorization"] = authorization

        response = self._get("/api/session", headers)
        if response.is_redirect or response.status_code in (401, 403):
            raise ApiError(ErrorId.UNAUTHENTICATED, "redash rejected the credential", status_code=401)
        if response.status_code >= 500:
            raise ApiError(ErrorId.REDASH_UNREACHABLE, f"redash returned {response.status_code}", status_code=503)
        return json_object(response, "the session")

    def get_query(self, query_id: int, *, api_key: str | None = None, cookie: str | None = None) -> dict[str, Any]:
        response = self._get(f"/api/queries/{query_id}", auth_headers(api_key, cookie))
        if response.status_code >= 500:
            raise ApiError(ErrorId.REDASH_UNREACHABLE, f"redash returned {response.status_code}", status_code=503)
        if response.status_code >= 400 or response.is_redirect:
            # EVERY non-success is one cause from our side: the query is not
            # something this caller can build a KPI on. This is an authorization
            # gate, so it must fail closed. Listing only 403 and 404 let an
            # unhandled 401 or 400 return its JSON error body as if it were a
            # query, and the caller committed a source they cannot read.
            raise ApiError(
                ErrorId.KPI_SOURCE_UNRESOLVABLE,
                f"query {query_id} does not exist or is not accessible",
                status_code=422,
            )
        return json_object(response, f"query {query_id}")

    def execute_query(
        self, query_id: int, max_age: int, *, api_key: str | None = None, cookie: str | None = None
    ) -> dict[str, Any]:
        """Ask Redash for the result, letting it decide cache versus execute.

        max_age is the whole "read latest, refresh if stale" rule: Redash
        returns its cached result when it is younger than max_age and starts a
        job otherwise, so this service never compares timestamps itself.

        The credential is whatever the caller has: the worker holds a service
        API key, a browser-driven recompute holds only a session cookie. One or
        the other reaches Redash; sending neither makes it 302 to the login page.
        """
        response = self._post(f"/api/queries/{query_id}/results", auth_headers(api_key, cookie), {"max_age": max_age})
        if response.status_code in (403, 404) or response.is_redirect:
            raise ApiError(
                ErrorId.KPI_SOURCE_UNRESOLVABLE,
                f"query {query_id} does not exist or is not accessible",
                status_code=422,
            )
        if response.status_code >= 400:
            raise ApiError(ErrorId.QUERY_EXECUTION_FAILED, f"redash refused to run query {query_id}", status_code=502)
        return json_object(response, f"running query {query_id}")

    def poll_job(
        self, job_id: str, *, api_key: str | None = None, cookie: str | None = None, timeout_seconds: int
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        while True:
            response = self._get(f"/api/jobs/{job_id}", auth_headers(api_key, cookie))
            if response.status_code >= 400 or response.is_redirect:
                # A session that expires mid-poll answers with a redirect to the
                # login page, whose body is HTML. Stop rather than spin.
                raise ApiError(
                    ErrorId.QUERY_EXECUTION_FAILED,
                    f"redash stopped reporting on job {job_id}",
                    status_code=502,
                )
            job = json_object(response, f"job {job_id}").get("job") or {}
            status = job.get("status")
            if status == JOB_FINISHED:
                return job
            if status in (JOB_FAILED, JOB_CANCELLED):
                raise ApiError(
                    ErrorId.QUERY_EXECUTION_FAILED,
                    str(job.get("error") or "the source query failed"),
                    status_code=502,
                )
            if time.monotonic() >= deadline:
                raise ApiError(
                    ErrorId.KPI_EVALUATION_TIMED_OUT,
                    f"the source query was still running after {timeout_seconds}s",
                    status_code=504,
                )
            time.sleep(POLL_INTERVAL_SECONDS)

    def get_query_result(
        self, result_id: int, *, api_key: str | None = None, cookie: str | None = None
    ) -> dict[str, Any]:
        response = self._get(f"/api/query_results/{result_id}", auth_headers(api_key, cookie))
        if response.status_code >= 400:
            raise ApiError(ErrorId.QUERY_EXECUTION_FAILED, f"result {result_id} is not readable", status_code=502)
        return json_object(response, f"result {result_id}")

    def fetch_result_data(
        self,
        query_id: int,
        max_age: int,
        *,
        api_key: str | None = None,
        cookie: str | None = None,
        timeout_seconds: int,
    ) -> dict[str, Any]:
        what = f"query {query_id}"
        # One budget for the whole operation, not one per step. Submitting the
        # query, polling and fetching the result each used to get their own
        # allowance, so a request thread could sit far past the configured
        # recompute ceiling that this timeout is supposed to be.
        deadline = time.monotonic() + timeout_seconds
        payload = self.execute_query(query_id, max_age, api_key=api_key, cookie=cookie)
        if "query_result" in payload:
            data: dict[str, Any] = dig(payload, ("query_result", "data"), what)
            return data

        # Neither key means Redash answered 200 with something this service does
        # not understand. Say so, rather than raising a KeyError as a 500. The
        # same credential carries through the job poll and the result fetch.
        job_id = str(dig(payload, ("job", "id"), what))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ApiError(
                ErrorId.KPI_EVALUATION_TIMED_OUT,
                f"submitting {what} used the whole {timeout_seconds}s budget",
                status_code=504,
            )
        job = self.poll_job(job_id, api_key=api_key, cookie=cookie, timeout_seconds=int(remaining))
        result_id = int(dig(job, ("query_result_id",), f"the finished job for {what}"))
        result = self.get_query_result(result_id, api_key=api_key, cookie=cookie)
        finished: dict[str, Any] = dig(result, ("query_result", "data"), what)
        return finished

    def get_dashboard(
        self, dashboard_id: int, *, api_key: str | None = None, cookie: str | None = None
    ) -> dict[str, Any]:
        """A dashboard with its widgets, each carrying its visualization and query.

        Used to ground annotation suggestions: the widgets are what say which
        query's numbers a suggestion would be annotating.
        """
        response = self._get(f"/api/dashboards/{dashboard_id}", auth_headers(api_key, cookie))
        if response.status_code >= 500:
            raise ApiError(ErrorId.REDASH_UNREACHABLE, f"redash returned {response.status_code}", status_code=503)
        if response.status_code >= 400 or response.is_redirect:
            raise ApiError(
                ErrorId.KPI_SOURCE_UNRESOLVABLE,
                f"dashboard {dashboard_id} does not exist or is not accessible",
                status_code=422,
            )
        return json_object(response, f"dashboard {dashboard_id}")

    def list_tagged(
        self,
        collection: str,
        tag: str,
        *,
        api_key: str | None = None,
        cookie: str | None = None,
        page_size: int = 250,
    ) -> list[dict[str, Any]]:
        """Queries or dashboards carrying one tag, as this caller can see them.

        An empty tag lists everything the caller can see, which is how the
        domain keys themselves are discovered.

        Redash applies the caller's own group permissions to these lists, so a
        domain hub built from them never names something the reader could not
        open anyway. Drafts are excluded by Redash, so an unpublished query is
        not in a hub until it is published. One page: a domain with more than
        page_size members is a different problem than this endpoint has.
        """
        # An empty tag means "no filter", so the param is dropped rather than
        # sent empty: Redash reads `tags=` as a filter for a tag that is the
        # empty string, which nothing carries, and answers with nothing.
        params: dict[str, Any] = {"page_size": page_size}
        if tag:
            params["tags"] = tag
        response = self._get(f"/api/{collection}", auth_headers(api_key, cookie), params)
        if response.status_code >= 500:
            raise ApiError(ErrorId.REDASH_UNREACHABLE, f"redash returned {response.status_code}", status_code=503)
        if response.status_code >= 400 or response.is_redirect:
            raise ApiError(ErrorId.UNAUTHENTICATED, "redash rejected the credential", status_code=401)
        results = json_object(response, f"tagged {collection}").get("results")
        return [row for row in results if isinstance(row, dict)] if isinstance(results, list) else []

    def list_data_sources(self, *, api_key: str | None = None, cookie: str | None = None) -> list[dict[str, Any]]:
        """Every data source this caller can see, name and type included.

        A bare JSON array rather than the {"results": [...]} page the collection
        endpoints answer with (handlers/data_sources.py returns a sorted list),
        so this cannot go through list_tagged and does not use _json, which
        exists to insist on an object.

        What it is for is labelling: a query listing row carries
        `data_source_id` and nothing else, and "reads data source 3" says less
        to a model than the id already did.
        """
        response = self._get("/api/data_sources", auth_headers(api_key, cookie))
        if response.status_code >= 500:
            raise ApiError(ErrorId.REDASH_UNREACHABLE, f"redash returned {response.status_code}", status_code=503)
        if response.status_code >= 400 or response.is_redirect:
            raise ApiError(ErrorId.UNAUTHENTICATED, "redash rejected the credential", status_code=401)
        try:
            payload = response.json()
        except ValueError as exc:
            raise ApiError(
                ErrorId.REDASH_UNREACHABLE,
                "redash returned a non-JSON body for the data sources",
                status_code=502,
            ) from exc
        return [row for row in payload if isinstance(row, dict)] if isinstance(payload, list) else []

    def close(self) -> None:
        self._client.close()

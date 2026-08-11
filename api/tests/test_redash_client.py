import httpx
import pytest
import respx

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash import RedashClient

REDASH = "http://redash.test"
DATA = {"columns": [{"name": "v", "type": "float"}], "rows": [{"v": 82.5}]}


@pytest.fixture
def client() -> RedashClient:
    return RedashClient(REDASH)


@respx.mock
def test_a_cache_hit_returns_data_without_polling(client: RedashClient) -> None:
    execute = respx.post(f"{REDASH}/api/queries/1/results").mock(
        return_value=httpx.Response(200, json={"query_result": {"data": DATA}})
    )
    jobs = respx.get(url__startswith=f"{REDASH}/api/jobs/")

    data = client.fetch_result_data(1, max_age=86400, api_key="k", timeout_seconds=5)

    assert data == DATA
    assert execute.called
    assert not jobs.called


@respx.mock
def test_a_job_is_polled_then_the_result_fetched(client: RedashClient) -> None:
    respx.post(f"{REDASH}/api/queries/1/results").mock(
        return_value=httpx.Response(200, json={"job": {"id": "job-1", "status": 1}})
    )
    respx.get(f"{REDASH}/api/jobs/job-1").mock(
        side_effect=[
            httpx.Response(200, json={"job": {"id": "job-1", "status": 2}}),
            httpx.Response(200, json={"job": {"id": "job-1", "status": 3, "query_result_id": 42}}),
        ]
    )
    respx.get(f"{REDASH}/api/query_results/42").mock(
        return_value=httpx.Response(200, json={"query_result": {"data": DATA}})
    )

    assert client.fetch_result_data(1, max_age=0, api_key="k", timeout_seconds=5) == DATA


@respx.mock
def test_a_failed_job_raises_with_redash_s_own_message(client: RedashClient) -> None:
    respx.post(f"{REDASH}/api/queries/1/results").mock(
        return_value=httpx.Response(200, json={"job": {"id": "job-1", "status": 1}})
    )
    failed = {"job": {"id": "job-1", "status": 4, "error": "relation does not exist"}}
    respx.get(f"{REDASH}/api/jobs/job-1").mock(return_value=httpx.Response(200, json=failed))

    with pytest.raises(ApiError) as exc:
        client.fetch_result_data(1, max_age=0, api_key="k", timeout_seconds=5)

    assert exc.value.error_id.value == "VEODYN_QUERY_EXECUTION_FAILED"
    assert "relation does not exist" in exc.value.message


@respx.mock
def test_polling_past_the_timeout_is_its_own_error(client: RedashClient) -> None:
    respx.post(f"{REDASH}/api/queries/1/results").mock(
        return_value=httpx.Response(200, json={"job": {"id": "job-1", "status": 1}})
    )
    respx.get(f"{REDASH}/api/jobs/job-1").mock(
        return_value=httpx.Response(200, json={"job": {"id": "job-1", "status": 2}})
    )

    with pytest.raises(ApiError) as exc:
        client.fetch_result_data(1, max_age=0, api_key="k", timeout_seconds=0)

    assert exc.value.error_id.value == "VEODYN_KPI_EVALUATION_TIMED_OUT"


@respx.mock
def test_a_deleted_source_query_is_unresolvable(client: RedashClient) -> None:
    respx.get(f"{REDASH}/api/queries/99").mock(return_value=httpx.Response(404, json={"message": "not found"}))

    with pytest.raises(ApiError) as exc:
        client.get_query(99, api_key="k")

    assert exc.value.error_id.value == "VEODYN_KPI_SOURCE_UNRESOLVABLE"


@respx.mock
def test_a_query_the_caller_cannot_see_is_also_unresolvable(client: RedashClient) -> None:
    respx.get(f"{REDASH}/api/queries/99").mock(return_value=httpx.Response(403, json={"message": "forbidden"}))

    with pytest.raises(ApiError) as exc:
        client.get_query(99, api_key="k")

    assert exc.value.error_id.value == "VEODYN_KPI_SOURCE_UNRESOLVABLE"


@respx.mock
def test_the_service_key_is_sent_as_a_key_header(client: RedashClient) -> None:
    route = respx.get(f"{REDASH}/api/queries/1").mock(return_value=httpx.Response(200, json={"id": 1}))

    client.get_query(1, api_key="service-key")

    assert route.calls.last.request.headers["authorization"] == "Key service-key"


# The guards below exist because Redash is not always the thing that answers.
# A reverse proxy, a Flask traceback or a version bump can all put a body on the
# wire that this client did not expect, and every one of those used to become an
# unexplained 500 rather than a named upstream failure.


@respx.mock
def test_a_non_json_body_is_a_named_upstream_failure(client: RedashClient) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(200, html="<html>nginx</html>"))

    with pytest.raises(ApiError) as raised:
        client.get_session("session=a", None)

    assert raised.value.status_code == 502
    assert raised.value.error_id is ErrorId.REDASH_UNREACHABLE


@respx.mock
def test_a_json_body_that_is_not_an_object_is_refused(client: RedashClient) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(200, json=["not", "a", "session"]))

    with pytest.raises(ApiError) as raised:
        client.get_session("session=a", None)

    assert raised.value.status_code == 502


@respx.mock
def test_a_result_payload_with_neither_key_names_the_shape(client: RedashClient) -> None:
    # 200 with a body that is neither a cached result nor a job. Indexing
    # payload["job"]["id"] straight through raised KeyError here.
    respx.post(f"{REDASH}/api/queries/1/results").mock(return_value=httpx.Response(200, json={"message": "queued"}))

    with pytest.raises(ApiError) as raised:
        client.fetch_result_data(1, max_age=0, api_key="k", timeout_seconds=5)

    assert raised.value.status_code == 502
    assert raised.value.error_id is ErrorId.QUERY_EXECUTION_FAILED


@respx.mock
def test_a_finished_job_without_a_result_id_names_the_shape(client: RedashClient) -> None:
    respx.post(f"{REDASH}/api/queries/1/results").mock(
        return_value=httpx.Response(200, json={"job": {"id": "job-1", "status": 1}})
    )
    respx.get(f"{REDASH}/api/jobs/job-1").mock(return_value=httpx.Response(200, json={"job": {"status": 3}}))

    with pytest.raises(ApiError) as raised:
        client.fetch_result_data(1, max_age=0, api_key="k", timeout_seconds=5)

    assert raised.value.status_code == 502


@respx.mock
def test_polling_stops_when_the_session_expires_mid_job(client: RedashClient) -> None:
    # Redash redirects an unauthenticated request to the login page, so the poll
    # would otherwise decode HTML and spin until the deadline.
    respx.post(f"{REDASH}/api/queries/1/results").mock(
        return_value=httpx.Response(200, json={"job": {"id": "job-1", "status": 1}})
    )
    respx.get(f"{REDASH}/api/jobs/job-1").mock(
        return_value=httpx.Response(302, headers={"location": f"{REDASH}/login"})
    )

    with pytest.raises(ApiError) as raised:
        client.fetch_result_data(1, max_age=0, api_key="k", timeout_seconds=5)

    assert raised.value.status_code == 502
    assert raised.value.error_id is ErrorId.QUERY_EXECUTION_FAILED


@respx.mock
def test_an_unhandled_4xx_on_the_source_query_fails_closed(client: RedashClient) -> None:
    # get_query is an authorization gate. Handling only 403/404 let a 401 or 400
    # return its JSON error body as though it were a query, so the caller
    # committed a KPI on a source they cannot read.
    respx.get(f"{REDASH}/api/queries/1").mock(return_value=httpx.Response(401, json={"message": "unauthorized"}))

    with pytest.raises(ApiError) as raised:
        client.get_query(1, api_key="k")

    assert raised.value.status_code == 422
    assert raised.value.error_id is ErrorId.KPI_SOURCE_UNRESOLVABLE

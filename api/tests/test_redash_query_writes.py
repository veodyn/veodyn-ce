"""The query-authoring verbs of RedashClient, from redash_query_writes.py.

Split from test_redash_client.py along the seam the source already takes: that
file is the read surface, test_redash_alert_client.py is the derived alert, and
this one is the two verbs that write a query into Redash.

Every test here asserts on the OUTBOUND request, not only on what came back. A
respx route matches on method and URL and ignores headers, so a call that
reached Redash with no credentials at all would return the mocked 200 and leave
a green suite behind. The auth header is therefore asserted on every call that
leaves the process, alongside the URL, the method and the body.

The contract the file pins:

- A query this service writes is PUBLISHED, because an alert on a draft is
  invisible to everyone but its author.
- A create that comes back without a usable int id is a named upstream failure,
  not a KeyError leaking out of the arm path as a 500.
- Archive treats 404 as "already gone", which is a return value. Every other
  refusal is FEED_ALERT_SYNC_FAILED and a 5xx is REDASH_UNREACHABLE, so one
  outage is not reported under two causes depending on the verb in flight.
"""

import json

import httpx
import pytest
import respx

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash import RedashClient

REDASH = "http://redash.test"

SCHEDULE = {"interval": 300, "until": None, "day_of_week": None, "time": None}


@pytest.fixture
def client() -> RedashClient:
    return RedashClient(REDASH)


# ---------------------------------------------------------------------------
# create_query: what goes out.


@respx.mock
def test_create_query_posts_the_whole_payload_and_returns_the_new_query(client: RedashClient) -> None:
    route = respx.post(f"{REDASH}/api/queries").mock(
        return_value=httpx.Response(200, json={"id": 41, "name": "Veodyn probe"})
    )

    created = client.create_query(
        name="Veodyn probe",
        query="SELECT max(ts) FROM db.capture",
        data_source_id=3,
        schedule_interval=300,
        description="Written by Veodyn to watch how long this capture has been quiet.",
        api_key="service-key",
    )

    assert created == {"id": 41, "name": "Veodyn probe"}
    request = route.calls.last.request
    assert request.method == "POST"
    assert str(request.url) == f"{REDASH}/api/queries"
    assert request.headers["authorization"] == "Key service-key"
    assert json.loads(request.content) == {
        "name": "Veodyn probe",
        "query": "SELECT max(ts) FROM db.capture",
        "data_source_id": 3,
        "description": "Written by Veodyn to watch how long this capture has been quiet.",
        # The field this service exists to set. Redash creates queries as drafts.
        "is_draft": False,
        "options": {},
        "schedule": SCHEDULE,
    }


@respx.mock
def test_create_query_sends_no_schedule_key_when_no_interval_was_asked_for(client: RedashClient) -> None:
    """An absent key, not a null schedule. Redash reads `schedule: None` and
    `schedule` missing the same way today, but a probe with no interval never
    runs, so which of the two went out is worth knowing at the wire."""
    route = respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json={"id": 41}))

    client.create_query(name="probe", query="SELECT 1", data_source_id=3, api_key="k")

    sent = json.loads(route.calls.last.request.content)
    assert "schedule" not in sent
    # The rest of the payload is unchanged by the missing interval, and an
    # unasked-for description is an empty string rather than absent.
    assert sent == {
        "name": "probe",
        "query": "SELECT 1",
        "data_source_id": 3,
        "description": "",
        "is_draft": False,
        "options": {},
    }


@respx.mock
def test_create_query_carries_the_callers_cookie_when_it_has_no_key(client: RedashClient) -> None:
    """The two credentials are alternatives, and Redash enforces per-user
    permissions off the cookie. Sending neither is the bug this file exists for."""
    route = respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json={"id": 41}))

    client.create_query(name="probe", query="SELECT 1", data_source_id=3, cookie="session=abc")

    request = route.calls.last.request
    assert request.headers["cookie"] == "session=abc"
    assert "authorization" not in request.headers


@respx.mock
def test_create_query_reaches_redash_with_a_credential_on_it(client: RedashClient) -> None:
    """The explicit guard against the failure a header-blind mock hides.

    respx matches on method and URL alone, so dropping the auth header from this
    call changes nothing about the response and nothing about the return value.
    An unauthenticated write to Redash answers 302 to the login page in
    production and 200 here, which is a green suite over a broken deploy.
    """
    route = respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json={"id": 41}))

    client.create_query(name="probe", query="SELECT 1", data_source_id=3, api_key="service-key")

    headers = route.calls.last.request.headers
    assert "authorization" in headers, "the create left this service unauthenticated"
    assert headers["authorization"] == "Key service-key"
    assert headers["accept"] == "application/json"


# ---------------------------------------------------------------------------
# create_query: what comes back.


@respx.mock
def test_a_create_answered_with_a_5xx_is_reported_as_redash_being_unreachable(client: RedashClient) -> None:
    respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(502, text="bad gateway"))

    with pytest.raises(ApiError) as raised:
        client.create_query(name="probe", query="SELECT 1", data_source_id=3, api_key="k")

    assert raised.value.error_id is ErrorId.REDASH_UNREACHABLE
    assert raised.value.status_code == 503
    assert "502" in raised.value.message


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
@respx.mock
def test_a_create_refused_by_redash_is_a_sync_failure_naming_the_verb(client: RedashClient, status: int) -> None:
    respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(status, json={"message": "no"}))

    with pytest.raises(ApiError) as raised:
        client.create_query(name="probe", query="SELECT 1", data_source_id=3, api_key="k")

    assert raised.value.error_id is ErrorId.FEED_ALERT_SYNC_FAILED
    assert raised.value.status_code == 502
    assert "redash refused to create the query" in raised.value.message
    assert str(status) in raised.value.message


@respx.mock
def test_a_login_redirect_on_the_create_is_a_refusal_not_a_success(client: RedashClient) -> None:
    """Redash answers @login_required with a 302 to the login page, which is
    below 400. Reading only the status class would let an expired service key
    return the redirect body as though it were the new query."""
    respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(302, headers={"location": f"{REDASH}/login"}))

    with pytest.raises(ApiError) as raised:
        client.create_query(name="probe", query="SELECT 1", data_source_id=3, api_key="k")

    assert raised.value.error_id is ErrorId.FEED_ALERT_SYNC_FAILED
    assert raised.value.status_code == 502


@respx.mock
def test_a_create_answered_with_html_is_a_named_upstream_failure(client: RedashClient) -> None:
    """A reverse proxy or a Flask traceback puts HTML on the wire with a 200 on
    it. Calling .json() straight through is a 500 with no cause on it."""
    respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, html="<html>nginx</html>"))

    with pytest.raises(ApiError) as raised:
        client.create_query(name="probe", query="SELECT 1", data_source_id=3, api_key="k")

    assert raised.value.error_id is ErrorId.REDASH_UNREACHABLE
    assert raised.value.status_code == 502


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"name": "probe"},
        {"id": None},
        {"id": "41"},
        {"id": 41.0},
        # bool subclasses int, so the obvious isinstance check accepts True and
        # the caller then arms an alert against query 1.
        {"id": True},
    ],
    ids=["empty", "no-id", "null-id", "string-id", "float-id", "bool-id"],
)
@respx.mock
def test_a_create_without_a_usable_query_id_is_refused_rather_than_indexed(
    client: RedashClient, body: dict[str, object]
) -> None:
    """The caller does `int(created["id"])`. Every shape here either raises a
    KeyError out of the arm path as an unexplained 500 or, worse, coerces."""
    respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json=body))

    with pytest.raises(ApiError) as raised:
        client.create_query(name="probe", query="SELECT 1", data_source_id=3, api_key="k")

    assert raised.value.error_id is ErrorId.FEED_ALERT_SYNC_FAILED
    assert raised.value.status_code == 502
    assert raised.value.message == "redash answered the create with no usable query id"


@respx.mock
def test_a_json_body_that_is_not_an_object_is_refused(client: RedashClient) -> None:
    respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json=[{"id": 41}]))

    with pytest.raises(ApiError) as raised:
        client.create_query(name="probe", query="SELECT 1", data_source_id=3, api_key="k")

    assert raised.value.status_code == 502

"""archive_query, the second verb in redash_query_writes.py.

Its own file only because test_redash_query_writes.py reached the size the
project allows; that file is the create, this one is the teardown. Both hold to
the same rule, and it is the rule the whole module exists for: what leaves this
process is asserted, not just what came back. respx matches a route on method
and URL and ignores headers, so an archive sent with no credentials on it
returns the mocked 200 and the suite stays green while production answers 302.

The verb archives rather than deletes, because that is all Redash's DELETE does
(QueryResource.delete calls query.archive), and archiving takes every alert on
the query with it. So "already gone" is a normal state here and 404 is a return
value, not a raise: the worker's repair pass has to be able to run twice.
"""

import httpx
import pytest
import respx

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.services.redash import RedashClient

REDASH = "http://redash.test"


@pytest.fixture
def client() -> RedashClient:
    return RedashClient(REDASH)


@respx.mock
def test_archive_query_deletes_the_query_and_says_it_archived_it(client: RedashClient) -> None:
    route = respx.delete(f"{REDASH}/api/queries/41").mock(return_value=httpx.Response(200, json={}))

    assert client.archive_query(41, api_key="service-key") is True

    request = route.calls.last.request
    assert request.method == "DELETE"
    assert str(request.url) == f"{REDASH}/api/queries/41"
    assert request.headers["authorization"] == "Key service-key"
    # DELETE carries no body, and a payload on one is a signal the verb changed.
    assert request.content == b""


@respx.mock
def test_archive_query_reaches_redash_with_a_credential_on_it(client: RedashClient) -> None:
    """The explicit guard against the failure a header-blind mock hides.

    Dropping the credential from this call changes nothing about the mocked
    response and nothing about the return value, so only an assertion on the
    outbound headers can catch it. Unauthenticated, Redash answers @login_required
    with a 302 and the query is never archived.
    """
    route = respx.delete(f"{REDASH}/api/queries/41").mock(return_value=httpx.Response(200, json={}))

    client.archive_query(41, cookie="session=abc")

    headers = route.calls.last.request.headers
    assert "cookie" in headers, "the archive left this service unauthenticated"
    assert headers["cookie"] == "session=abc"
    assert headers["accept"] == "application/json"


@respx.mock
def test_an_already_archived_query_is_a_return_value_not_a_failure(client: RedashClient) -> None:
    """404 is a NORMAL state: deleting the probe in Redash by hand is a
    legitimate way to disarm a feed, and the caller reads False as "nothing left
    to do" rather than as an outage."""
    respx.delete(f"{REDASH}/api/queries/41").mock(return_value=httpx.Response(404, json={"message": "not found"}))

    assert client.archive_query(41, api_key="k") is False


@respx.mock
def test_an_archive_answered_with_a_5xx_is_reported_as_redash_being_unreachable(client: RedashClient) -> None:
    """The 5xx arm is checked before the 4xx one, and both are checked after the
    404. One outage reported under two causes depending on the verb in flight is
    two support threads for one incident."""
    respx.delete(f"{REDASH}/api/queries/41").mock(return_value=httpx.Response(500, text="boom"))

    with pytest.raises(ApiError) as raised:
        client.archive_query(41, api_key="k")

    assert raised.value.error_id is ErrorId.REDASH_UNREACHABLE
    assert raised.value.status_code == 503
    assert "500" in raised.value.message


@pytest.mark.parametrize("status", [400, 401, 403, 422])
@respx.mock
def test_an_archive_redash_refuses_names_the_query_it_refused(client: RedashClient, status: int) -> None:
    respx.delete(f"{REDASH}/api/queries/41").mock(return_value=httpx.Response(status, json={"message": "no"}))

    with pytest.raises(ApiError) as raised:
        client.archive_query(41, api_key="k")

    assert raised.value.error_id is ErrorId.FEED_ALERT_SYNC_FAILED
    assert raised.value.status_code == 502
    assert "redash refused to archive query 41" in raised.value.message
    assert str(status) in raised.value.message


@respx.mock
def test_a_login_redirect_on_the_archive_is_a_refusal_not_a_success(client: RedashClient) -> None:
    """A 302 is below 400, so without the redirect arm this returns True and the
    caller records the probe as gone while it is still running and still
    firing."""
    respx.delete(f"{REDASH}/api/queries/41").mock(
        return_value=httpx.Response(302, headers={"location": f"{REDASH}/login"})
    )

    with pytest.raises(ApiError) as raised:
        client.archive_query(41, api_key="k")

    assert raised.value.error_id is ErrorId.FEED_ALERT_SYNC_FAILED
    assert raised.value.status_code == 502

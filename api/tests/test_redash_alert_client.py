"""The alert verbs of RedashClient, the half that lives in redash_alerts.py.

Split from test_redash_client.py along the same seam the source already takes:
that file is the query surface, this one is the derived KPI alert.

The rule holding these together: "already gone" is a NORMAL state here, not a
failure, so 404 is a return value on every verb that can meet one. Every other
refusal is named as KPI_ALERT_SYNC_FAILED, a 5xx is named as REDASH_UNREACHABLE
on all four verbs alike, and nothing escapes as a bare httpx error.
"""

import json

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
def test_get_alert_returns_none_when_redash_says_404(client: RedashClient) -> None:
    # A return value, not a raise, because 404 is a NORMAL state for a managed
    # alert: deleting the alert in Redash is a legitimate way to disarm a KPI,
    # and Query.archive() deletes every alert attached to the query. The
    # worker's repair pass turns this None into a cleared alert_id.
    respx.get(f"{REDASH}/api/alerts/9").mock(return_value=httpx.Response(404, json={}))

    assert client.get_alert(9, api_key="k") is None


@respx.mock
def test_get_alert_returns_the_payload(client: RedashClient) -> None:
    respx.get(f"{REDASH}/api/alerts/9").mock(
        return_value=httpx.Response(200, json={"id": 9, "options": {"kpi_id": "x"}})
    )

    assert client.get_alert(9, api_key="k") == {"id": 9, "options": {"kpi_id": "x"}}


@respx.mock
def test_create_alert_posts_the_whole_payload_and_returns_the_new_alert(client: RedashClient) -> None:
    route = respx.post(f"{REDASH}/api/alerts").mock(return_value=httpx.Response(200, json={"id": 12}))

    created = client.create_alert(
        name="X breached", query_id=1, options={"column": "c", "op": "<", "value": 3.0}, api_key="k"
    )

    assert created["id"] == 12
    sent = json.loads(route.calls.last.request.content)
    assert sent == {
        "name": "X breached",
        "query_id": 1,
        "options": {"column": "c", "op": "<", "value": 3.0},
        "rearm": None,
    }
    assert route.calls.last.request.headers["authorization"] == "Key k"


@respx.mock
def test_a_refused_create_is_a_named_cause_not_an_httpx_error(client: RedashClient) -> None:
    respx.post(f"{REDASH}/api/alerts").mock(return_value=httpx.Response(403, json={}))

    with pytest.raises(ApiError) as caught:
        client.create_alert(name="X", query_id=1, options={}, api_key="k")

    assert caught.value.error_id is ErrorId.KPI_ALERT_SYNC_FAILED


@respx.mock
def test_update_alert_is_a_named_cause_when_redash_refuses(client: RedashClient) -> None:
    respx.post(f"{REDASH}/api/alerts/9").mock(return_value=httpx.Response(403, json={}))

    with pytest.raises(ApiError) as caught:
        client.update_alert(9, payload={"name": "X"}, api_key="k")

    assert caught.value.error_id is ErrorId.KPI_ALERT_SYNC_FAILED


@respx.mock
def test_update_alert_posts_the_payload_and_returns_the_alert(client: RedashClient) -> None:
    route = respx.post(f"{REDASH}/api/alerts/9").mock(return_value=httpx.Response(200, json={"id": 9}))

    updated = client.update_alert(9, payload={"name": "X breached", "rearm": 3600}, api_key="k")

    assert updated == {"id": 9}
    assert json.loads(route.calls.last.request.content) == {"name": "X breached", "rearm": 3600}


@respx.mock
def test_delete_alert_reports_an_already_gone_alert_as_false(client: RedashClient) -> None:
    respx.delete(f"{REDASH}/api/alerts/9").mock(return_value=httpx.Response(404, json={}))

    assert client.delete_alert(9, api_key="k") is False


@respx.mock
def test_delete_alert_reports_a_real_delete_as_true(client: RedashClient) -> None:
    respx.delete(f"{REDASH}/api/alerts/9").mock(return_value=httpx.Response(200, json={}))

    assert client.delete_alert(9, api_key="k") is True


@respx.mock
def test_a_refused_delete_is_a_named_cause(client: RedashClient) -> None:
    respx.delete(f"{REDASH}/api/alerts/9").mock(return_value=httpx.Response(403, json={}))

    with pytest.raises(ApiError) as caught:
        client.delete_alert(9, api_key="k")

    assert caught.value.error_id is ErrorId.KPI_ALERT_SYNC_FAILED


@respx.mock
def test_a_created_alert_with_no_usable_id_is_a_named_cause(client: RedashClient) -> None:
    # A 200 is not a contract. Without this, {} leaks a KeyError and
    # {"id": null} a TypeError out of kpi_alert.arm as an unexplained 500. A
    # string id is refused too: Redash's serializer sends an int, and coercing
    # whatever arrives would hide the day that stops being true.
    for body in ({}, {"id": None}, {"id": "42"}):
        respx.post(f"{REDASH}/api/alerts").mock(return_value=httpx.Response(200, json=body))

        with pytest.raises(ApiError) as caught:
            client.create_alert(name="X", query_id=1, options={}, api_key="k")

        assert caught.value.error_id is ErrorId.KPI_ALERT_SYNC_FAILED


@respx.mock
def test_update_alert_reports_an_already_gone_alert_as_none(client: RedashClient) -> None:
    # Mirrors get_alert. An alert deleted between a read and this write is the
    # same "already gone" state, and resync has to answer that rather than
    # raising a cause its caller cannot tell from a refusal.
    respx.post(f"{REDASH}/api/alerts/9").mock(return_value=httpx.Response(404, json={}))

    assert client.update_alert(9, payload={"name": "X"}, api_key="k") is None


@respx.mock
def test_a_server_error_is_an_unreachable_redash_on_every_alert_verb(client: RedashClient) -> None:
    # Distinct from a refusal: 5xx means Redash itself is unwell, and the
    # caller's fix is to wait rather than to change what it asked for. All four
    # verbs have to agree, or one outage is reported as two different causes
    # depending on which call happened to be in flight when it started.
    respx.get(f"{REDASH}/api/alerts/9").mock(return_value=httpx.Response(500, json={}))
    respx.post(f"{REDASH}/api/alerts").mock(return_value=httpx.Response(502, json={}))
    respx.post(f"{REDASH}/api/alerts/9").mock(return_value=httpx.Response(503, json={}))
    respx.delete(f"{REDASH}/api/alerts/9").mock(return_value=httpx.Response(504, json={}))

    verbs = [
        lambda: client.get_alert(9, api_key="k"),
        lambda: client.create_alert(name="X", query_id=1, options={}, api_key="k"),
        lambda: client.update_alert(9, payload={"name": "X"}, api_key="k"),
        lambda: client.delete_alert(9, api_key="k"),
    ]
    for verb in verbs:
        with pytest.raises(ApiError) as caught:
            verb()
        assert caught.value.error_id is ErrorId.REDASH_UNREACHABLE
        assert caught.value.status_code == 503


@respx.mock
def test_a_redirect_is_never_followed_into_the_login_page(client: RedashClient) -> None:
    # The class promises this for every verb. An unauthenticated Redash answers
    # @login_required with a 302 to the login form, and following it would turn
    # "not signed in" into a 200 with an HTML body.
    respx.post(f"{REDASH}/api/alerts").mock(return_value=httpx.Response(302, headers={"location": "/login"}))

    with pytest.raises(ApiError) as caught:
        client.create_alert(name="X", query_id=1, options={}, api_key="k")

    assert caught.value.error_id is ErrorId.KPI_ALERT_SYNC_FAILED

"""Arming, moving and disarming a capture's staleness alert, through the route.

Split from test_captures_route.py, which is the board's own wire contract and
its degradation behaviour. This is the alert lifecycle: what gets written to
Redash, in what order, and what happens to it when the expectation underneath
moves.

The fixtures stay in test_captures_route.py and are imported, so the two files
cannot drift into disagreeing about what the deployment looks like. That
matters more than it sounds: the SOURCES fixture describing a deployment with
no ClickHouse data source is what let a probe bound to the wrong runner pass
here for as long as it did.
"""

import json

import httpx
import respx
from fastapi.testclient import TestClient

from tests.test_captures_route import QUERIES, REDASH, SOURCES, SPANS, redash_lists
from tests.test_catalog import RAIL_TABLE, USER, as_user, catalog_api, warehouse_answers

__all__ = ["catalog_api"]  # re-exported fixture, imported for its side effect

WAREHOUSE_SOURCE_ID = 8  # the `clickhouse` row in SOURCES


def declare(catalog_api: TestClient, seconds: int | None) -> None:
    catalog_api.put(
        f"/captures/{RAIL_TABLE}/expectation",
        json={"expectedIntervalSeconds": seconds},
        cookies={"session": "s"},
    )


def arm(catalog_api: TestClient, armed: bool) -> httpx.Response:
    return catalog_api.put(f"/captures/{RAIL_TABLE}/alert", json={"armed": armed}, cookies={"session": "s"})


@respx.mock
def test_arming_writes_a_probe_and_an_alert_and_links_them(catalog_api: TestClient) -> None:
    """The alert half of F-07.

    Staleness is not a value in any result, so there is nothing for an ordinary
    Redash alert's `column` to name. It IS expressible as one, which is what
    makes this reuse Redash's scheduler, destinations, mute and subscriptions
    wholesale instead of growing a second alerting engine.
    """
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists(QUERIES, SOURCES)
    created_query = respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json={"id": 4242}))
    created_alert = respx.post(f"{REDASH}/api/alerts").mock(return_value=httpx.Response(200, json={"id": 99}))

    declare(catalog_api, 300)
    armed = arm(catalog_api, True)

    assert armed.status_code == 204
    probe = json.loads(created_query.calls[0].request.content)
    # captured_at is the capture layer's contract, not a guess: every table is
    # re-inserted stamped with one per run and ordered by it.
    assert "max(captured_at)" in probe["query"]
    assert "seconds_since_last_row" in probe["query"]
    assert RAIL_TABLE in probe["query"]
    # The warehouse, never the connector the capture query reads. Query 21 is on
    # data source 3, and binding the probe there wrote ClickHouse SQL to a runner
    # that parses query text as JSON. Unasserted, that shipped.
    assert probe["data_source_id"] == WAREHOUSE_SOURCE_ID
    # Published, or the alert would be invisible to everyone but its author.
    assert probe["is_draft"] is False
    # Runs at half the interval it polices, so it can observe the boundary.
    assert probe["schedule"]["interval"] == 150

    alert = json.loads(created_alert.calls[0].request.content)
    assert alert["query_id"] == 4242
    # Two periods, the same boundary lib/capture-status.ts draws. An alert firing
    # somewhere else than the badge destroys trust in both.
    assert alert["options"]["value"] == 600
    assert alert["options"]["op"] == ">"
    assert alert["options"]["column"] == "seconds_since_last_row"

    feeds = {f["id"]: f for f in catalog_api.get("/captures", cookies={"session": "s"}).json()}
    assert feeds[RAIL_TABLE]["alertId"] == 99


@respx.mock
def test_arming_needs_a_declared_expectation_first(catalog_api: TestClient) -> None:
    """There is no threshold without one, and inventing a deadline then paging
    somebody about it is worse than refusing."""
    as_user(USER)

    # A feed no other case in this file declares anything for: the database
    # outlives a test here, so reusing RAIL_TABLE would find the expectation a
    # neighbour left behind and arm successfully.
    response = catalog_api.put(
        "/captures/historical.q_never_declared_7/alert", json={"armed": True}, cookies={"session": "s"}
    )

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_CAPTURE_NOT_WATCHABLE"


@respx.mock
def test_a_capture_query_the_caller_cannot_read_is_not_watchable(catalog_api: TestClient) -> None:
    """The catalog is not permission-filtered, so this is the only gate between a
    user and a watch on a capture Redash does not show them. It used to be
    implicit in the probe being bound to that query's data source; once the probe
    moved to the warehouse it had to become a check of its own or it would have
    been deleted along with the binding."""
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists([], SOURCES)  # the caller's query list, empty for them
    created_query = respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json={"id": 4242}))

    declare(catalog_api, 300)
    response = arm(catalog_api, True)

    assert response.status_code == 422
    assert response.json()["error"]["id"] == "VEODYN_CAPTURE_NOT_WATCHABLE"
    assert not created_query.called


@respx.mock
def test_moving_the_interval_moves_the_threshold(catalog_api: TestClient) -> None:
    """Or the alert fires at the old boundary while the board draws the new one."""
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists(QUERIES, SOURCES)
    respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json={"id": 4242}))
    respx.post(f"{REDASH}/api/alerts").mock(return_value=httpx.Response(200, json={"id": 99}))
    respx.get(f"{REDASH}/api/alerts/99").mock(
        return_value=httpx.Response(200, json={"id": 99, "options": {"muted": True, "custom_subject": "mine"}})
    )
    updated = respx.post(f"{REDASH}/api/alerts/99").mock(return_value=httpx.Response(200, json={"id": 99}))

    declare(catalog_api, 300)
    arm(catalog_api, True)
    declare(catalog_api, 3600)

    written = json.loads(updated.calls[-1].request.content)
    assert written["options"]["value"] == 7200
    # A sync merges, it does not replace: a repair must not un-mute an alert
    # somebody silenced, nor drop a hand-written template.
    assert written["options"]["muted"] is True
    assert written["options"]["custom_subject"] == "mine"


@respx.mock
def test_disarming_takes_down_the_alert_then_the_probe(catalog_api: TestClient) -> None:
    """That order, because archiving a query deletes every alert on it. The
    reverse leaves delete_alert answering 404 for an alert this service had just
    destroyed, which reads as a failure and is not one."""
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists(QUERIES, SOURCES)
    respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json={"id": 4242}))
    respx.post(f"{REDASH}/api/alerts").mock(return_value=httpx.Response(200, json={"id": 99}))
    order: list[str] = []
    respx.delete(f"{REDASH}/api/alerts/99").mock(
        side_effect=lambda request: order.append("alert") or httpx.Response(200)
    )
    respx.delete(f"{REDASH}/api/queries/4242").mock(
        side_effect=lambda request: order.append("query") or httpx.Response(200)
    )

    declare(catalog_api, 300)
    arm(catalog_api, True)
    disarmed = arm(catalog_api, False)

    assert disarmed.status_code == 204
    assert order == ["alert", "query"]
    feeds = {f["id"]: f for f in catalog_api.get("/captures", cookies={"session": "s"}).json()}
    assert feeds[RAIL_TABLE]["alertId"] is None


@respx.mock
def test_clearing_the_expectation_takes_the_alert_with_it(catalog_api: TestClient) -> None:
    """An expectation is what supplies the threshold, so a row deleted from
    under an armed alert leaves one firing on a number nothing maintains."""
    as_user(USER)
    warehouse_answers(SPANS)
    redash_lists(QUERIES, SOURCES)
    respx.post(f"{REDASH}/api/queries").mock(return_value=httpx.Response(200, json={"id": 4242}))
    respx.post(f"{REDASH}/api/alerts").mock(return_value=httpx.Response(200, json={"id": 99}))
    deleted = respx.delete(f"{REDASH}/api/alerts/99").mock(return_value=httpx.Response(200))
    respx.delete(f"{REDASH}/api/queries/4242").mock(return_value=httpx.Response(200))

    declare(catalog_api, 300)
    arm(catalog_api, True)
    declare(catalog_api, None)

    assert deleted.called

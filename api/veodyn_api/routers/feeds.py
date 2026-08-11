"""The Feed Health endpoint.

The path is `/feeds` because veodyn-de's proxy calls `CATALOG_API_URL/feeds`
(app/src/app/api/feeds/route.ts). That proxy has existed since before this
route did, and for that whole time it forwarded to a 404 that the Feed Health
page rendered as "No feeds configured." The route is here, beside the catalog it
derives from, rather than in catalog.py: same backend, same credential, but the
two answer different questions and the catalog router is already the one with
the tag lookup and the search parameter in it.

Authorization is the catalog's, for the catalog's reason: this returns table
names, capture times and schedules, never a row of captured data. Reading a
value still means running a query through Redash under the reader's own
credential, where Redash's group permissions apply.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from veodyn_api.auth import Identity, caller_credential, get_redash_client, require_identity
from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.catalog import CamelModel
from veodyn_api.schemas.feed import FeedOut
from veodyn_api.services import feed_alert
from veodyn_api.services.catalog import build_catalog
from veodyn_api.services.clickhouse import ClickHouseClient, get_clickhouse_client
from veodyn_api.services.feed_expectations import (
    clear_expectation,
    read_alert_links,
    read_expectations,
    read_row,
    set_expectation,
    store_alert_link,
)
from veodyn_api.services.feeds import build_feeds, query_facts
from veodyn_api.services.redash import RedashClient
from veodyn_api.services.redash_lookups import data_source_names
from veodyn_api.settings import Settings, get_settings

router = APIRouter(prefix="/feeds", tags=["feeds"])

IdentityDep = Annotated[Identity, Depends(require_identity)]
DbDep = Annotated[Session, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
RedashDep = Annotated[RedashClient, Depends(get_redash_client)]


def get_warehouse(settings: SettingsDep) -> ClickHouseClient:
    return get_clickhouse_client(settings)


WarehouseDep = Annotated[ClickHouseClient, Depends(get_warehouse)]


@router.get("", response_model=list[FeedOut])
def list_feeds(
    identity: IdentityDep,
    db: DbDep,
    settings: SettingsDep,
    warehouse: WarehouseDep,
    redash: RedashDep,
    cookie: Annotated[str | None, Header()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> list[FeedOut]:
    """Every scheduled capture the warehouse holds, with its cadence and source.

    The two Redash lookups run as the CALLER, not as the service account, so a
    data source or a query the reader cannot see goes unnamed rather than named
    for them. Both are best-effort by construction: they label a list the
    warehouse already produced, and neither can empty it.
    """
    api_key, session_cookie = caller_credential(cookie, authorization)
    datasets = build_catalog(
        warehouse,
        database=settings.clickhouse_database,
        stale_after_minutes=settings.catalog_stale_after_minutes,
    )
    return build_feeds(
        datasets,
        facts=query_facts(redash, api_key=api_key, cookie=session_cookie),
        sources=data_source_names(redash, api_key=api_key, cookie=session_cookie),
        expectations=read_expectations(db, identity.org_slug),
        alert_links=read_alert_links(db, identity.org_slug),
    )


class AlertIn(CamelModel):
    """Whether this feed should page someone when it goes quiet."""

    armed: bool


class ExpectationIn(CamelModel):
    """How often this feed should deliver, or null to stop expecting.

    Null rather than a second endpoint: setting and clearing are the same
    decision made twice, and a DELETE beside a PUT invites a client to think
    clearing is destructive when it only returns the feed to its Redash
    schedule.
    """

    expected_interval_seconds: int | None


@router.put("/{feed_id}/expectation", status_code=204)
def put_expectation(
    feed_id: str,
    body: ExpectationIn,
    identity: IdentityDep,
    db: DbDep,
    settings: SettingsDep,
    redash: RedashDep,
) -> Response:
    """Declare how often a capture is expected to deliver.

    Deliberately NOT checked against the catalog first. A feed id is a warehouse
    table name, and an expectation for a table that has not appeared yet, or has
    briefly dropped out of the registry, is a harmless row that starts working
    the moment it is back. Refusing it would mean an operator cannot set an
    expectation on the feed they are waiting for, which is the one they most
    want to hear about.

    Any authenticated member of the org may set one. It changes no data and no
    permission: what it changes is when this org's own board calls a feed late.
    """
    if body.expected_interval_seconds is None:
        # Take the alert down first. An expectation is what supplies the alert's
        # threshold, so a row deleted from under an armed alert leaves one
        # firing on a number nothing maintains.
        row = read_row(db, org_slug=identity.org_slug, feed_id=feed_id)
        if row is not None and row.alert_id is not None:
            feed_alert.disarm(redash, row, api_key=settings.redash_service_api_key)
        clear_expectation(db, org_slug=identity.org_slug, feed_id=feed_id)
    else:
        set_expectation(
            db,
            org_slug=identity.org_slug,
            feed_id=feed_id,
            seconds=body.expected_interval_seconds,
            user_id=identity.user_id,
        )
        # An armed feed whose interval moved needs its threshold moved with it,
        # or the alert goes on firing at the old boundary while the board draws
        # the new one. False means Redash no longer has the alert, which is a
        # legitimate way to disarm, so the link is forgotten rather than the
        # alert recreated.
        row = read_row(db, org_slug=identity.org_slug, feed_id=feed_id)
        if row is not None and row.alert_id is not None:
            if not feed_alert.resync(redash, row, feed_id=feed_id, api_key=settings.redash_service_api_key):
                feed_alert.clear_alert_link(db, row)
    return Response(status_code=204)


@router.put("/{feed_id}/alert", status_code=204)
def put_alert(
    feed_id: str,
    body: AlertIn,
    identity: IdentityDep,
    db: DbDep,
    settings: SettingsDep,
    warehouse: WarehouseDep,
    redash: RedashDep,
    cookie: Annotated[str | None, Header()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> Response:
    """Arm or disarm the late alert on a feed.

    Requires a declared expectation, because the alert's threshold is two of
    those periods. Arming without one would mean inventing a deadline on the
    user's behalf and then paging them about it.

    Unlike the expectation, this IS checked against the catalog: arming writes a
    query against a real table on a real data source, and there is nothing to
    write for a feed the registry cannot resolve.
    """
    row = read_row(db, org_slug=identity.org_slug, feed_id=feed_id)
    if row is None:
        raise ApiError(
            ErrorId.FEED_NOT_WATCHABLE,
            "declare how often this feed should deliver before arming an alert on it",
            status_code=422,
        )

    if not body.armed:
        feed_alert.disarm(redash, row, api_key=settings.redash_service_api_key)
        feed_alert.clear_alert_link(db, row)
        return Response(status_code=204)

    if row.alert_id is not None:
        return Response(status_code=204)

    api_key, session_cookie = caller_credential(cookie, authorization)
    datasets = build_catalog(
        warehouse,
        database=settings.clickhouse_database,
        stale_after_minutes=settings.catalog_stale_after_minutes,
    )
    dataset = next((d for d in datasets if d.id == feed_id), None)
    if dataset is None:
        raise ApiError(
            ErrorId.FEED_NOT_WATCHABLE,
            "the warehouse does not list this capture, so there is no table to watch",
            status_code=422,
        )
    facts = query_facts(redash, api_key=api_key, cookie=session_cookie)
    fact = facts.get(dataset.sample_query_id or 0)
    query_id, alert_id = feed_alert.arm(
        redash,
        feed_id=feed_id,
        feed_name=dataset.name,
        database=settings.clickhouse_database,
        table=dataset.id,
        data_source_id=fact.data_source_id if fact else 0,
        expected_interval_seconds=row.expected_interval_seconds,
        api_key=settings.redash_service_api_key,
    )
    # After Redash accepted both, never before.
    store_alert_link(db, org_slug=identity.org_slug, feed_id=feed_id, query_id=query_id, alert_id=alert_id)
    return Response(status_code=204)

"""The Captures endpoint.

The path is `/captures` because veodyn-de's proxy calls
`CATALOG_API_URL/captures` (app/src/app/api/captures/route.ts). It sits beside
the catalog it derives from rather than in catalog.py: same backend and
credential, different question.

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
from veodyn_api.schemas.capture import CaptureOut
from veodyn_api.schemas.catalog import CamelModel
from veodyn_api.services import capture_alert
from veodyn_api.services.capture_expectations import (
    clear_expectation,
    read_alert_links,
    read_expectations,
    read_row,
    set_expectation,
    store_alert_link,
)
from veodyn_api.services.captures import build_captures, query_facts
from veodyn_api.services.catalog import build_catalog
from veodyn_api.services.clickhouse import ClickHouseClient, get_clickhouse_client
from veodyn_api.services.redash import RedashClient
from veodyn_api.services.redash_lookups import data_source_names
from veodyn_api.settings import Settings, get_settings

router = APIRouter(prefix="/captures", tags=["captures"])

IdentityDep = Annotated[Identity, Depends(require_identity)]
DbDep = Annotated[Session, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
RedashDep = Annotated[RedashClient, Depends(get_redash_client)]


def get_warehouse(settings: SettingsDep) -> ClickHouseClient:
    return get_clickhouse_client(settings)


WarehouseDep = Annotated[ClickHouseClient, Depends(get_warehouse)]


@router.get("", response_model=list[CaptureOut])
def list_captures(
    identity: IdentityDep,
    db: DbDep,
    settings: SettingsDep,
    warehouse: WarehouseDep,
    redash: RedashDep,
    cookie: Annotated[str | None, Header()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> list[CaptureOut]:
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
    return build_captures(
        datasets,
        facts=query_facts(redash, api_key=api_key, cookie=session_cookie),
        sources=data_source_names(redash, api_key=api_key, cookie=session_cookie),
        expectations=read_expectations(db, identity.org_slug),
        alert_links=read_alert_links(db, identity.org_slug),
    )


class AlertIn(CamelModel):
    """Whether this capture should page someone when it goes quiet."""

    armed: bool


class ExpectationIn(CamelModel):
    """How often this capture should deliver, or null to stop expecting.

    Null rather than a second endpoint: clearing only returns the capture to
    its Redash schedule, and a DELETE beside a PUT would read as destructive.
    """

    expected_interval_seconds: int | None


@router.put("/{capture_id}/expectation", status_code=204)
def put_expectation(
    capture_id: str,
    body: ExpectationIn,
    identity: IdentityDep,
    db: DbDep,
    settings: SettingsDep,
    redash: RedashDep,
) -> Response:
    """Declare how often a capture is expected to deliver.

    NOT checked against the catalog first: a capture id is a warehouse table
    name, and an expectation for a table that has not appeared yet, or has
    briefly dropped out of the registry, is a harmless row that starts working
    the moment it is back. Any authenticated member of the org may set one,
    since it changes no data and no permission, only when this org's board
    calls a capture late.
    """
    if body.expected_interval_seconds is None:
        # Take the alert down first. An expectation is what supplies the alert's
        # threshold, so a row deleted from under an armed alert leaves one
        # firing on a number nothing maintains.
        row = read_row(db, org_slug=identity.org_slug, capture_id=capture_id)
        if row is not None and row.alert_id is not None:
            capture_alert.disarm(redash, row, api_key=settings.redash_service_api_key)
        clear_expectation(db, org_slug=identity.org_slug, capture_id=capture_id)
    else:
        set_expectation(
            db,
            org_slug=identity.org_slug,
            capture_id=capture_id,
            seconds=body.expected_interval_seconds,
            user_id=identity.user_id,
        )
        # An armed capture whose interval moved needs its threshold moved with
        # it. False means Redash no longer has the alert, which is a
        # legitimate way to disarm, so the link is forgotten rather than the
        # alert recreated.
        row = read_row(db, org_slug=identity.org_slug, capture_id=capture_id)
        if row is not None and row.alert_id is not None:
            if not capture_alert.resync(redash, row, capture_id=capture_id, api_key=settings.redash_service_api_key):
                capture_alert.clear_alert_link(db, row)
    return Response(status_code=204)


@router.put("/{capture_id}/alert", status_code=204)
def put_alert(
    capture_id: str,
    body: AlertIn,
    identity: IdentityDep,
    db: DbDep,
    settings: SettingsDep,
    warehouse: WarehouseDep,
    redash: RedashDep,
    cookie: Annotated[str | None, Header()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> Response:
    """Arm or disarm the late alert on a capture.

    Requires a declared expectation, because the alert's threshold is two of
    those periods. Unlike the expectation, this IS checked against the catalog:
    arming writes a query against a real table on a real data source.
    """
    row = read_row(db, org_slug=identity.org_slug, capture_id=capture_id)
    if row is None:
        raise ApiError(
            ErrorId.CAPTURE_NOT_WATCHABLE,
            "declare how often this capture should deliver before arming an alert on it",
            status_code=422,
        )

    if not body.armed:
        capture_alert.disarm(redash, row, api_key=settings.redash_service_api_key)
        capture_alert.clear_alert_link(db, row)
        return Response(status_code=204)

    if row.alert_id is not None:
        return Response(status_code=204)

    api_key, session_cookie = caller_credential(cookie, authorization)
    datasets = build_catalog(
        warehouse,
        database=settings.clickhouse_database,
        stale_after_minutes=settings.catalog_stale_after_minutes,
    )
    dataset = next((d for d in datasets if d.id == capture_id), None)
    if dataset is None:
        raise ApiError(
            ErrorId.CAPTURE_NOT_WATCHABLE,
            "the warehouse does not list this capture, so there is no table to watch",
            status_code=422,
        )
    # Read as the CALLER, and kept after the probe stopped being bound to this
    # data source: the catalog is not permission-filtered, so this is the only
    # thing standing between a user and a watch on a capture Redash does not
    # show them. The probe itself runs as the service account.
    facts = query_facts(redash, api_key=api_key, cookie=session_cookie)
    if facts.get(dataset.sample_query_id or 0) is None:
        raise ApiError(
            ErrorId.CAPTURE_NOT_WATCHABLE,
            f"the query behind {dataset.name} is not one this account can read, so it cannot be watched",
            status_code=422,
        )
    query_id, alert_id = capture_alert.arm(
        redash,
        capture_id=capture_id,
        capture_name=dataset.name,
        database=settings.clickhouse_database,
        table=dataset.id,
        expected_interval_seconds=row.expected_interval_seconds,
        api_key=settings.redash_service_api_key,
    )
    # After Redash accepted both, never before.
    store_alert_link(db, org_slug=identity.org_slug, capture_id=capture_id, query_id=query_id, alert_id=alert_id)
    return Response(status_code=204)

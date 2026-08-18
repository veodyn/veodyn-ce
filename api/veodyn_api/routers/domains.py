"""Domain hub endpoints.

Authorization: the tag lookups run as the caller `require_identity` resolved, so
Redash's group permissions decide what a hub contains and two readers of the
same domain can see different members.

Paths are `/domains` and `/domains/{key}` to match veodyn-de's proxy
(app/src/app/api/domains/[key]/route.ts).

An unknown key answers an empty hub, not a 404: this service has no registry of
which domains exist (that list lives in veodyn-de's config), so it cannot tell
"not a domain" from "a domain nothing is filed under yet".
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from veodyn_api.auth import Identity, caller_credential, get_redash_client, require_identity
from veodyn_api.db import get_db
from veodyn_api.routers.catalog import SettingsDep, WarehouseDep
from veodyn_api.schemas.catalog import DomainHubOut
from veodyn_api.services.domains import build_domain_hub, discover_keys
from veodyn_api.services.redash import RedashClient

router = APIRouter(prefix="/domains", tags=["catalog"])

IdentityDep = Annotated[Identity, Depends(require_identity)]
DbDep = Annotated[Session, Depends(get_db)]
RedashDep = Annotated[RedashClient, Depends(get_redash_client)]
CookieHeader = Annotated[str | None, Header()]
AuthorizationHeader = Annotated[str | None, Header()]


@router.get("", response_model=list[DomainHubOut])
def list_domain_hubs(
    identity: IdentityDep,
    db: DbDep,
    redash: RedashDep,
    warehouse: WarehouseDep,
    settings: SettingsDep,
    cookie: CookieHeader = None,
    authorization: AuthorizationHeader = None,
) -> list[DomainHubOut]:
    api_key, session_cookie = caller_credential(cookie, authorization)
    keys = discover_keys(redash, db, identity.org_slug, api_key=api_key, cookie=session_cookie)
    return [
        build_domain_hub(
            key,
            redash=redash,
            warehouse=warehouse,
            db=db,
            org_slug=identity.org_slug,
            api_key=api_key,
            cookie=session_cookie,
            default_database=settings.clickhouse_database,
        )
        for key in keys
    ]


@router.get("/{key}", response_model=DomainHubOut)
def get_domain_hub(
    key: str,
    identity: IdentityDep,
    db: DbDep,
    redash: RedashDep,
    warehouse: WarehouseDep,
    settings: SettingsDep,
    cookie: CookieHeader = None,
    authorization: AuthorizationHeader = None,
) -> DomainHubOut:
    api_key, session_cookie = caller_credential(cookie, authorization)
    return build_domain_hub(
        key,
        redash=redash,
        warehouse=warehouse,
        db=db,
        org_slug=identity.org_slug,
        api_key=api_key,
        cookie=session_cookie,
        default_database=settings.clickhouse_database,
    )

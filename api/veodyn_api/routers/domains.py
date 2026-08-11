"""Domain hub endpoints.

Authorization: `require_identity` resolves the caller through Redash, then the
tag lookups run as that same caller, so Redash's own group permissions decide
what a hub contains. Two readers of the same domain can therefore see different
members, which is the correct answer rather than a bug.

Paths are `/domains` and `/domains/{key}` because veodyn-de's proxies call
`CATALOG_API_URL/domains` and `CATALOG_API_URL/domains/<key>`
(app/src/app/api/domains/[key]/route.ts).

There is deliberately no 404 for an unknown key. This service has no registry of
which domains exist (the tenant's list lives in veodyn-de's config), so it
cannot tell "not a domain" from "a domain nothing is filed under yet". It
answers with an empty hub, and the page says the sections are empty.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from veodyn_api.auth import Identity, caller_credential, get_redash_client, require_identity
from veodyn_api.db import get_db
from veodyn_api.routers.catalog import WarehouseDep
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
    )

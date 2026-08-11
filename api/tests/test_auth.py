import importlib
import sys
from typing import Annotated

import httpx
import pytest
import respx
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

from veodyn_api.auth import Identity, caller_api_key, caller_credential, require_identity
from veodyn_api.main import create_app

REDASH = "http://redash.test"
SESSION_URL = f"{REDASH}/api/session"

FULL_USER = {
    "user": {
        "id": 7,
        "name": "Jane Analyst",
        "email": "jane@example.org",
        "groups": [1, 2],
        "permissions": ["create_query", "execute_query"],
    },
    "org_slug": "default",
}


@pytest.fixture
def auth_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("VEODYN_REDASH_URL", REDASH)
    from veodyn_api.settings import get_settings

    get_settings.cache_clear()

    router = APIRouter()

    @router.get("/whoami")
    def whoami(identity: Annotated[Identity, Depends(require_identity)]) -> dict[str, object]:
        return {"userId": identity.user_id, "orgSlug": identity.org_slug, "isAdmin": identity.is_admin}

    app = create_app()
    app.include_router(router)
    return TestClient(app, raise_server_exceptions=False)


@respx.mock
def test_resolves_a_signed_in_cookie(auth_client: TestClient) -> None:
    respx.get(SESSION_URL).mock(return_value=httpx.Response(200, json=FULL_USER))

    response = auth_client.get("/whoami", headers={"cookie": "session=abc"})

    assert response.status_code == 200
    assert response.json() == {"userId": 7, "orgSlug": "default", "isAdmin": False}


@respx.mock
def test_forwards_the_callers_credential_verbatim(auth_client: TestClient) -> None:
    route = respx.get(SESSION_URL).mock(return_value=httpx.Response(200, json=FULL_USER))

    auth_client.get("/whoami", headers={"authorization": "Key user-key"})

    assert route.calls.last.request.headers["authorization"] == "Key user-key"


@respx.mock
def test_admin_permission_sets_is_admin(auth_client: TestClient) -> None:
    payload = {**FULL_USER, "user": {**FULL_USER["user"], "permissions": ["admin"]}}
    respx.get(SESSION_URL).mock(return_value=httpx.Response(200, json=payload))

    assert auth_client.get("/whoami", headers={"cookie": "session=abc"}).json()["isAdmin"] is True


def test_no_credential_is_401(auth_client: TestClient) -> None:
    response = auth_client.get("/whoami")

    assert response.status_code == 401
    assert response.json()["error"]["id"] == "VEODYN_UNAUTHENTICATED"


@respx.mock
def test_a_query_api_key_is_403(auth_client: TestClient) -> None:
    # Redash returns {"permissions": [], "apiKey": ...} with no id for a query
    # key (handlers/authentication.py:413). Ownership cannot be attributed to
    # it, so it must not reach a write path.
    respx.get(SESSION_URL).mock(
        return_value=httpx.Response(200, json={"user": {"permissions": [], "apiKey": "q"}, "org_slug": "default"})
    )

    response = auth_client.get("/whoami", headers={"authorization": "Key query-key"})

    assert response.status_code == 403
    assert response.json()["error"]["id"] == "VEODYN_FORBIDDEN"


@respx.mock
def test_a_redirect_means_unauthenticated(auth_client: TestClient) -> None:
    # Redash's @login_required redirects rather than 401ing for a bad cookie.
    respx.get(SESSION_URL).mock(return_value=httpx.Response(302, headers={"location": "/login"}))

    response = auth_client.get("/whoami", headers={"cookie": "session=stale"})

    assert response.status_code == 401


@respx.mock
def test_redash_unreachable_is_503_not_an_open_door(auth_client: TestClient) -> None:
    respx.get(SESSION_URL).mock(side_effect=httpx.ConnectError("refused"))

    response = auth_client.get("/whoami", headers={"cookie": "session=abc"})

    assert response.status_code == 503
    assert response.json()["error"]["id"] == "VEODYN_REDASH_UNREACHABLE"


@respx.mock
def test_repeated_calls_with_one_credential_hit_redash_once(auth_client: TestClient) -> None:
    route = respx.get(SESSION_URL).mock(return_value=httpx.Response(200, json=FULL_USER))

    auth_client.get("/whoami", headers={"cookie": "session=abc"})
    auth_client.get("/whoami", headers={"cookie": "session=abc"})

    assert route.call_count == 1


@respx.mock
def test_a_different_credential_is_resolved_separately(auth_client: TestClient) -> None:
    route = respx.get(SESSION_URL).mock(return_value=httpx.Response(200, json=FULL_USER))

    auth_client.get("/whoami", headers={"cookie": "session=abc"})
    auth_client.get("/whoami", headers={"cookie": "session=def"})

    assert route.call_count == 2


def test_the_session_cache_prunes_expired_entries_rather_than_growing_forever() -> None:
    # One entry per distinct credential and nothing ever reads an expired one,
    # so without a sweep a long-lived process accumulates them for its whole
    # life. The prune runs on a miss once the dict crosses the threshold.
    from veodyn_api import auth

    auth.clear_session_cache()
    identity = Identity(user_id=1, name="n", email="e", groups=[], permissions=[], org_slug="default")
    now = 1000.0

    for index in range(auth._SESSION_CACHE_PRUNE_AT):
        auth._session_cache[f"expired-{index}"] = (now - 1, identity)
    assert len(auth._session_cache) == auth._SESSION_CACHE_PRUNE_AT

    auth._store_identity("fresh", identity, ttl_seconds=30, now=now)

    assert len(auth._session_cache) == 1
    assert "fresh" in auth._session_cache


def test_pruning_keeps_entries_that_are_still_valid() -> None:
    from veodyn_api import auth

    auth.clear_session_cache()
    identity = Identity(user_id=1, name="n", email="e", groups=[], permissions=[], org_slug="default")
    now = 1000.0

    for index in range(auth._SESSION_CACHE_PRUNE_AT - 1):
        auth._session_cache[f"expired-{index}"] = (now - 1, identity)
    auth._session_cache["still-good"] = (now + 60, identity)

    auth._store_identity("fresh", identity, ttl_seconds=30, now=now)

    assert set(auth._session_cache) == {"still-good", "fresh"}


@respx.mock
def test_a_session_without_an_org_is_refused(auth_client: TestClient) -> None:
    """Never guess the tenant.

    Every row is scoped by org_slug, so defaulting a malformed session to
    "default" would hand the caller another tenant's KPIs.
    """
    respx.get(SESSION_URL).mock(return_value=httpx.Response(200, json={"user": {"id": 7, "name": "Jane"}}))

    response = auth_client.get("/whoami", headers={"cookie": "session=abc"})

    assert response.status_code == 403
    assert response.json()["error"]["id"] == "VEODYN_FORBIDDEN"


@respx.mock
def test_a_query_api_key_is_not_forwarded_when_a_cookie_authenticates(auth_client: TestClient) -> None:
    # Only the identity credential reaches Redash. Sending both let a saved
    # query's API key authorize that query while the cookie supplied the user.
    route = respx.get(SESSION_URL).mock(return_value=httpx.Response(200, json=FULL_USER))

    auth_client.get("/whoami", headers={"cookie": "session=abc", "authorization": "Key query-key"})

    sent = route.calls.last.request.headers
    assert sent["cookie"] == "session=abc"
    assert "authorization" not in sent


def test_caller_api_key_strips_a_scheme_and_survives_one_without() -> None:
    # RedashClient re-adds the `Key ` scheme Redash expects, so forwarding the
    # header verbatim would send `Key Key <token>`.
    assert caller_api_key("Key deadbeef") == "deadbeef"
    assert caller_api_key("deadbeef") == "deadbeef"
    assert caller_api_key(None) is None


def test_caller_credential_never_forwards_a_credential_that_did_not_authenticate() -> None:
    # The bypass identity_credential exists to close: a cookie supplies the
    # identity while a saved query's API key authorizes access to that query.
    # Only the credential that authenticated is forwarded, so the key is dropped.
    assert caller_credential("session=abc", "Key deadbeef") == (None, "session=abc")
    assert caller_credential(None, "Key deadbeef") == ("deadbeef", None)


ENTERPRISE_GUARDS = "veodyn_api.routers.kpi_guards"
COMMUNITY_ROUTERS = ("veodyn_api.routers.feeds", "veodyn_api.routers.domains")


@pytest.mark.parametrize("module_name", COMMUNITY_ROUTERS)
def test_a_community_router_imports_with_the_enterprise_guards_absent(module_name: str) -> None:
    """kpi_guards is enterprise and has been deleted; these two routers ship
    without it.

    A None entry in sys.modules is what the community build looks like from the
    import machinery's side: the module is simply not there. Re-importing the
    router under that is the check that catches the credential helper drifting
    back into an enterprise file, which no amount of green route tests would.

    Still here now that the module is really gone, and not redundant with
    `tests/test_ce_has_no_ee_code.py`. That one reads import statements; this
    one runs the import, so it catches a reach for the pack that `ast` cannot
    see and it names which router did it.
    """
    routers_package = importlib.import_module("veodyn_api.routers")
    saved = {name: sys.modules[name] for name in (ENTERPRISE_GUARDS, module_name) if name in sys.modules}
    try:
        sys.modules.pop(module_name, None)
        sys.modules[ENTERPRISE_GUARDS] = None  # type: ignore[assignment]
        # Prove the block bites before leaning on it.
        with pytest.raises(ModuleNotFoundError):
            importlib.import_module(ENTERPRISE_GUARDS)

        importlib.import_module(module_name)
    finally:
        sys.modules.pop(ENTERPRISE_GUARDS, None)
        sys.modules.pop(module_name, None)
        sys.modules.update(saved)
        for name, module in saved.items():
            setattr(routers_package, name.rsplit(".", 1)[1], module)

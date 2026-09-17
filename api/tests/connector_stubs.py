from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import httpx
import respx

from tests.conftest import REDASH_TEST_URL, session_payload
from veodyn_api.services.connector_contract import (
    ContentContract,
    CredentialField,
    CredentialSchema,
    CredentialVerdict,
    DeliveryCode,
    DeliveryHandle,
    DeliveryOutcome,
    Rendering,
    VerdictCode,
)

REDASH = REDASH_TEST_URL

ORG = "default"
OTHER_ORG = "elsewhere"

ADMIN = session_payload(user_id=7, name="Ada Admin", email="ada@x.org", permissions=["admin"])
MEMBER = session_payload(user_id=9, name="Mo Member", email="mo@x.org", permissions=["execute_query"])
OTHER_ADMIN = session_payload(
    user_id=11, name="Bo Border", email="bo@y.org", permissions=["admin"], org_slug=OTHER_ORG
)

TOWN_CRIER_ID = "town-crier"
TOWN_CRIER_NAME = "Town Crier"
GOOD_TOKEN = "crier-live-8f3a2b"
BAD_TOKEN = "crier-expired-0000"
ROOM = "market-square"
NOTE = "rings the bell twice"
REQUIRED_FOOTER = "Reply STOP to opt out."
KEY = "default:8f3a2b0c4d1e"

HANDLE_AS_STRING = "handle_string"
HANDLE_AS_DECLARED_SECRET = "handle_secret"
HANDLE_AS_CLASS_PROXY = "handle_proxy"


class HandleShapedProxy:
    def __init__(self, handle: str) -> None:
        self._handle = handle

    @property
    def __class__(self) -> Any:
        return DeliveryHandle

    def reveal(self) -> str:
        return self._handle

    def __repr__(self) -> str:
        return self._handle

    def __str__(self) -> str:
        return self._handle


TOWN_CRIER_SCHEMA = CredentialSchema(
    fields=(
        CredentialField(name="crier_token", title="Crier API token", description="Issued by the town clerk."),
        CredentialField(name="crier_room", title="Room", secret=False),
        CredentialField(name="crier_note", title="Operator note", secret=False, required=False),
    )
)

TOWN_CRIER_CONTRACT = ContentContract(
    max_length=280,
    supports_markup=False,
    url_counts_as_characters=23,
    required_footer=REQUIRED_FOOTER,
)


@dataclass
class TownCrierConnector:
    connector_id: str = TOWN_CRIER_ID
    display_name: str = TOWN_CRIER_NAME
    credential_schema: CredentialSchema = TOWN_CRIER_SCHEMA
    content_contract: ContentContract = TOWN_CRIER_CONTRACT
    recallable: bool = True
    verified_with: list[dict[str, Any]] = field(default_factory=list)
    delivered: list[Rendering] = field(default_factory=list)
    idempotency_keys: list[str] = field(default_factory=list)
    raises_on_verify: bool = False
    raises_on_deliver: bool = False
    next_delivery_succeeds: bool = True

    def verify_credentials(self, credentials: Mapping[str, Any]) -> CredentialVerdict:
        self.verified_with.append(dict(credentials))
        if self.raises_on_verify:
            raise RuntimeError(f"town crier exploded holding {credentials.get('crier_token')}")
        if credentials.get("crier_token") == GOOD_TOKEN:
            return CredentialVerdict(accepted=True)
        return CredentialVerdict(accepted=False, code=VerdictCode.REJECTED, fields=("crier_token",))

    def deliver(self, rendering: Rendering, credentials: Mapping[str, Any], idempotency_key: str) -> DeliveryOutcome:
        if self.raises_on_deliver:
            raise RuntimeError(f"town crier exploded holding {credentials.get('crier_token')}")
        self.delivered.append(rendering)
        self.idempotency_keys.append(idempotency_key)
        if not self.next_delivery_succeeds:
            return DeliveryOutcome(delivered=False, code=DeliveryCode.CHANNEL_UNAVAILABLE)
        return DeliveryOutcome(delivered=True, code=DeliveryCode.DELIVERED)


class CarelessConnector:
    connector_id = TOWN_CRIER_ID
    credential_schema = TOWN_CRIER_SCHEMA
    content_contract = TOWN_CRIER_CONTRACT
    recallable = True

    def __init__(self, mode: str = "reports") -> None:
        self.mode = mode
        self.seen: str | None = None

    @property
    def display_name(self) -> str:
        return TOWN_CRIER_NAME if self.seen is None else f"{TOWN_CRIER_NAME} {self.seen}"

    def _remember(self, credentials: Mapping[str, Any]) -> str:
        self.seen = str(credentials.get("crier_token"))
        return self.seen

    def verify_credentials(self, credentials: Mapping[str, Any]) -> CredentialVerdict:
        token = self._remember(credentials)
        if self.mode == "raises":
            raise RuntimeError(f"the crier token is {token}")
        if self.mode == "returns_nonsense":
            return "the crier token is " + token  # type: ignore[return-value]
        return CredentialVerdict(
            accepted=False,
            code=f"rejected {token}",  # type: ignore[arg-type]
            fields=(token, f"crier_token={token}", "crier_token"),
        )

    def deliver(self, rendering: Rendering, credentials: Mapping[str, Any], idempotency_key: str) -> DeliveryOutcome:
        token = self._remember(credentials)
        if self.mode == "raises":
            raise RuntimeError(f"the crier token is {token}")
        if self.mode == "returns_nonsense":
            return f"delivered with {token}"  # type: ignore[return-value]
        if self.mode == HANDLE_AS_STRING:
            return DeliveryOutcome(
                delivered=True,
                code=DeliveryCode.DELIVERED,
                reference=token,  # type: ignore[arg-type]
            )
        if self.mode == HANDLE_AS_CLASS_PROXY:
            return DeliveryOutcome(
                delivered=True,
                code=DeliveryCode.DELIVERED,
                reference=HandleShapedProxy(token),  # type: ignore[arg-type]
            )
        if self.mode == HANDLE_AS_DECLARED_SECRET:
            return DeliveryOutcome(
                delivered=True,
                code=DeliveryCode.DELIVERED,
                reference=DeliveryHandle(token),
            )
        return DeliveryOutcome(
            delivered=self.mode == "delivers",
            code=f"failed carrying {token}",  # type: ignore[arg-type]
        )


def good_credentials() -> dict[str, Any]:
    return {"crier_token": GOOD_TOKEN, "crier_room": ROOM}


def fits_the_contract(body: str = "The 12 line is on detour until Friday. ") -> Rendering:
    return Rendering(body=body + REQUIRED_FOOTER)


def as_user(payload: dict[str, Any]) -> None:
    respx.get(f"{REDASH}/api/session").mock(return_value=httpx.Response(200, json=payload))


def auth(cookie: str = "ada") -> dict[str, str]:
    return {"cookie": f"session={cookie}"}

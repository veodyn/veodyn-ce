"""The community AI endpoints, behind a shared secret.

SQL generation for the query editor's prompt bar. The rest (outline, report,
digest, annotations) are routers/ai_ee.py, which mounts under the same prefix
and reuses the gate below. Nothing here may import services/ai_digest or services/kpi_view,
or a build without the enterprise half would fail at import rather than serve
fewer endpoints.

Authorization is unlike every other router in this service. veodyn-de's AI relay
strips the browser's cookie before calling out, because the configured provider
may be a third party, so what arrives is one bearer token shared between the
relay and this service. Two consequences:

1. This service cannot know who is asking, so it grounds on the Redash service
   account and can NAME a query the reader may not be able to open. Reading a
   result still goes through Redash under the reader's own credential.
   `_profile_block` does read the warehouse on the SERVICE account and puts real
   column values in the prompt (the three most common values of every
   non-numeric column, the min and max of every numeric or time one), so the
   configured AI provider sees a sample of the table. The lever is whether a
   profile is attached at all.
2. The bearer is the entire gate. It is compared in constant time, and an unset
   key answers 503 rather than letting everyone through.

Paths are `/ai/*` because the relay calls `AI_ENDPOINT/<route>` with the
endpoint configured as `.../ai` (app/src/lib/ai-proxy.ts).
"""

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from veodyn_api.auth import get_redash_client
from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.ai import GenerateSqlIn, GenerateSqlOut
from veodyn_api.services.ai_catalog_grounding import build_grounding
from veodyn_api.services.ai_sql import generate_sql
from veodyn_api.services.clickhouse import get_clickhouse_client
from veodyn_api.services.dataset_profile_cache import cached_profile
from veodyn_api.services.llm import LlmClient, compact_json, get_llm_client
from veodyn_api.services.redash import RedashClient
from veodyn_api.settings import Settings, get_settings

router = APIRouter(prefix="/ai", tags=["ai"])

SettingsDep = Annotated[Settings, Depends(get_settings)]
RedashDep = Annotated[RedashClient, Depends(get_redash_client)]
DbDep = Annotated[Session, Depends(get_db)]
LlmDep = Annotated[LlmClient, Depends(get_llm_client)]


def require_provider(settings: SettingsDep) -> None:
    if not settings.ai_api_key:
        raise ApiError(ErrorId.AI_NOT_CONFIGURED, "AI is not configured on this instance", status_code=503)


def require_relay_key(
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    if not settings.ai_relay_key:
        raise ApiError(ErrorId.AI_NOT_CONFIGURED, "AI is not configured on this instance", status_code=503)

    presented = (authorization or "").removeprefix("Bearer ").strip()
    if not presented or not hmac.compare_digest(presented, settings.ai_relay_key):
        raise ApiError(ErrorId.UNAUTHENTICATED, "the AI relay credential was not accepted", status_code=401)


def require_relay(
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    require_provider(settings)
    require_relay_key(settings, authorization)


RelayDep = Annotated[None, Depends(require_relay)]


def service_key(settings: Settings) -> str:
    """The Redash account this service grounds on, or a 503: without it there is
    no list of real queries to choose from.

    Public rather than underscored because routers/ai_ee.py calls it, and a
    second copy of this refusal there would be a second place to drift.
    """
    if not settings.redash_service_api_key:
        raise ApiError(
            ErrorId.AI_NOT_CONFIGURED,
            "no redash service account is configured, so nothing can be grounded",
            status_code=503,
        )
    return settings.redash_service_api_key


def _profile_block(settings: Settings, redash: RedashClient, table: str) -> str | None:
    """What the named table currently holds, or None when nothing can say.

    Looked up SERVER-SIDE against this service's own catalog, never taken from
    the request: a request naming something the catalog does not have costs the
    generation its profile and can never name a table.

    build_grounding rather than build_catalog, for its TTL cache. The `query`
    kind assembles the catalog alone and makes no Redash call, which is why a
    missing service account leaves this route working instead of 503ing.
    """
    if not settings.clickhouse_url:
        return None
    grounding = build_grounding(
        "query", redash=redash, api_key=settings.redash_service_api_key or "", settings=settings
    )
    # Catalog ids are unqualified and the editor sends whichever form its dataset
    # carries, so the database part is dropped before the match. Still a lookup:
    # a name that is not in the list resolves to nothing.
    wanted = table.strip().rpartition(".")[2]
    dataset = next((one for one in grounding.datasets if one.id == wanted), None)
    if dataset is None:
        return None
    profile = cached_profile(get_clickhouse_client(settings), dataset)
    return compact_json(profile.as_prompt_block()) if profile is not None else None


@router.post("/generate-sql", response_model=GenerateSqlOut)
def post_generate_sql(
    payload: GenerateSqlIn, _: RelayDep, llm: LlmDep, redash: RedashDep, settings: SettingsDep
) -> GenerateSqlOut:
    """Natural language to one read-only SELECT over the given dataset.

    Given the same warehouse profile the interview gets, so the statement is
    written against real cardinality and real ranges.
    """
    return generate_sql(llm, payload, profile_block=_profile_block(settings, redash, payload.dataset.table))

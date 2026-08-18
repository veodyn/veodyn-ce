"""The community AI endpoints, behind a shared secret.

Two of them: SQL generation for the query editor's prompt bar, and one turn of
the Create-with-AI interview. The other four (outline, report, digest,
annotations) are routers/ai_ee.py, which mounts under the same prefix and reuses
the gate below. Nothing here may import services/ai_digest or services/kpi_view,
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
from veodyn_api.schemas.ai_create import ConverseIn, ConverseOut
from veodyn_api.services.ai_converse import converse
from veodyn_api.services.ai_converse_grounding import build_grounding, with_widget_queries
from veodyn_api.services.ai_grounding import (
    DashboardWidget,
    QueryVisualization,
    dashboard_widgets,
    query_result_columns,
    query_visualizations,
)
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


def require_relay(
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """The shared secret, compared in constant time.

    An unconfigured relay key means AI was never set up on this instance, which
    is 503 and not "no credential required": a deployment that forgot the key
    must not become one with an open generation endpoint.
    """
    if not settings.ai_relay_key or not settings.ai_api_key:
        raise ApiError(ErrorId.AI_NOT_CONFIGURED, "AI is not configured on this instance", status_code=503)

    presented = (authorization or "").removeprefix("Bearer ").strip()
    if not presented or not hmac.compare_digest(presented, settings.ai_relay_key):
        raise ApiError(ErrorId.UNAUTHENTICATED, "the AI relay credential was not accepted", status_code=401)


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


@router.post("/converse", response_model=ConverseOut)
def post_converse(
    payload: ConverseIn, _: RelayDep, llm: LlmDep, redash: RedashDep, settings: SettingsDep
) -> ConverseOut:
    """One Create-with-AI interview turn, grounded on what actually exists.

    The request carries no grounding, unlike /outline: the catalog and the query
    list are assembled here, so a modified client cannot make the model believe
    in a table that does not exist.
    """
    # A `report` turn can converge on a report OUTLINE even on a build with no
    # enterprise pack, which is why ReportOutlineOut is a community schema. What
    # such a build has no route for is turning an outline into drafted blocks.
    api_key = service_key(settings)

    def visualization(query_id: int) -> tuple[QueryVisualization, ...]:
        """Every visualization the query has, or none so the widget degrades.

        A query that was in the listing and is gone by the time it is looked up
        is a dropped widget, not a 422 mid-conversation. Anything else (Redash
        unreachable, a rejected credential) still surfaces. All of them rather
        than one id, because an edit turn has to know whether the shape the model
        asked for is one the query ALREADY has.
        """
        try:
            return query_visualizations(redash, query_id, api_key)
        except ApiError as missing:
            if missing.error_id is not ErrorId.KPI_SOURCE_UNRESOLVABLE:
                raise
            return ()

    def columns(query_id: int) -> tuple[str, ...]:
        """What the KPI's source query last returned, so a value column that is
        not in it is refused here rather than failing on a schedule."""
        return query_result_columns(redash, query_id, api_key)

    grounding = build_grounding(payload.kind, redash=redash, api_key=api_key, settings=settings)
    # Read here rather than taken from the request, so an edit conversation is
    # grounded on the dashboard as it actually is. A target that cannot be read
    # degrades to an ordinary creation turn rather than failing the conversation.
    editing: tuple[DashboardWidget, ...] = ()
    if payload.kind == "dashboard" and payload.target_dashboard_id is not None:
        try:
            editing = tuple(dashboard_widgets(redash, payload.target_dashboard_id, api_key))
        except ApiError:
            editing = ()
    # After `editing` is read, because what it adds are the dashboard's own
    # queries: an edit names widgets whose queries can be drafts, or older than
    # the newest `ai_max_grounded_queries`, and neither is in the listing above.
    grounding = with_widget_queries(grounding, editing)
    # Built once per request rather than per lookup: one turn can profile the
    # focused table and write four queries that each profile their own.
    warehouse = get_clickhouse_client(settings) if settings.clickhouse_url else None
    return converse(
        llm,
        payload,
        grounding,
        resolve_visualization=visualization,
        editing=editing,
        warehouse=warehouse,
        columns_of=columns,
    )

"""The Data Catalog endpoint.

Authorization: `require_identity` resolves the caller through Redash, or answers
401. There is no per-dataset check beyond that, and it is worth being explicit
about why: this endpoint returns table names, column names, row counts and
capture times, never a row of captured data. Reading a value still means running
a query through Redash against the "DE Historical" data source, where Redash's
own group permissions apply.

The path is `/catalog` because veodyn-de's proxy calls `CATALOG_API_URL/catalog`
(app/src/app/api/catalog/route.ts).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from veodyn_api.auth import Identity, require_identity
from veodyn_api.db import get_db
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.registry import ObjectType, register_dataset_source_provider, register_object_type
from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services import tags as tag_service
from veodyn_api.services.capture_sources import capture_sources
from veodyn_api.services.catalog import build_catalog, dataset_ids
from veodyn_api.services.clickhouse import ClickHouseClient, get_clickhouse_client
from veodyn_api.settings import Settings, get_settings

router = APIRouter(prefix="/catalog", tags=["catalog"])

IdentityDep = Annotated[Identity, Depends(require_identity)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
DbDep = Annotated[Session, Depends(get_db)]


def get_warehouse(settings: SettingsDep) -> ClickHouseClient:
    return get_clickhouse_client(settings)


WarehouseDep = Annotated[ClickHouseClient, Depends(get_warehouse)]


@router.get("", response_model=list[DatasetOut])
def list_datasets(
    identity: IdentityDep,
    settings: SettingsDep,
    warehouse: WarehouseDep,
    db: DbDep,
    q: Annotated[str | None, Query(max_length=200)] = None,
) -> list[DatasetOut]:
    """Every table the historical warehouse has captured, as catalog datasets.

    `q` filters on the dataset and table name. It is applied here rather than in
    ClickHouse because the registry is one small table and the frontend expects
    the same list either way.

    Tags come from this service's own assignment table rather than the
    warehouse: the warehouse has no notion of one, and a dataset's labels are an
    org-shared fact this service stores. Read for the whole org in one statement,
    which is cheap for the same reason the registry read is.
    """
    return build_catalog(
        warehouse,
        database=settings.clickhouse_database,
        stale_after_minutes=settings.catalog_stale_after_minutes,
        q=q,
        tags=tag_service.tags_by_org(db, identity.org_slug, "dataset"),
    )


def _authorize_dataset_tag_write(db: Session, identity: Identity, object_id: str) -> None:
    """Any authenticated member of the org may label a captured table, as long
    as the table is one the warehouse actually holds.

    No owner to check against: a dataset is a shared warehouse table, and
    curating labels on one is closer to a wiki than to editing someone's
    document. `require_identity` on the route is the whole authorization; this
    is the existence check.

    Builds its own warehouse client rather than taking the route's dependency.
    Every kind's guard has the same three arguments, so a kind needing a backend
    of its own reaches for it here, and `get_clickhouse_client` only constructs:
    nothing is opened until the read below runs.
    """
    settings = get_settings()
    if object_id not in dataset_ids(get_clickhouse_client(settings), settings.clickhouse_database):
        raise ApiError(ErrorId.DATASET_NOT_FOUND, f"the catalog lists no dataset {object_id}", status_code=404)


# A dataset has no row in this database at all: its id is a warehouse registry
# table name, which is why `model` is None and the existence check is the guard
# above rather than a SELECT. Not favoritable: a star needs a table to gate the
# insert on, and the Favorites page has no dataset section to lead back to.
register_object_type(
    ObjectType(
        kind="dataset",
        not_found=ErrorId.DATASET_NOT_FOUND,
        taggable=True,
        favoritable=False,
        model=None,
        authorize_tag_write=_authorize_dataset_tag_write,
    )
)

# The warehouse registry, as one dataset source among however many are
# registered. First, so a build with no packs lists its datasets in the order it
# always has. Registered here rather than in the service because importing the
# routers package is what triggers every built-in registration (extras.py:53),
# and this module already registers the dataset object type above.
register_dataset_source_provider(capture_sources)

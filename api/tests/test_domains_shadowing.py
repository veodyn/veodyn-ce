"""Shadow-id resolution for domain hubs.

Split out of test_domains.py: adding the chained-shadow test there pushed
that file past the 300-line block, the same reason test_registry_providers.py
explains its own split from test_dataset_source_registry.py.

Reuses test_domains.py's `domains_api` fixture and its Redash/warehouse stubs
by importing them directly rather than duplicating the harness here.
"""

import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.test_domains import TRANSIT_TAG, USER, as_user, domains_api, tagged, warehouse_catalog
from veodyn_api.registry import DatasetSource, register_dataset_source_provider, restored_registries

__all__ = ["domains_api"]  # re-exported fixture; pytest discovers it by name


@respx.mock
def test_a_shadowed_table_is_served_under_the_id_the_catalog_uses(domains_api: TestClient, db: Session) -> None:
    """The hub page matches these ids against /catalog ids exactly. After a
    rename the registry names the renamed table, so without the mapping the
    dataset vanishes from its own hub while sitting in the catalog the whole
    time."""
    as_user(USER)
    tagged(queries=[{"id": 21, "name": "Road events", "tags": [TRANSIT_TAG]}], dashboards=[])
    warehouse_catalog([{"table_name": "historical._road_events_ingested"}])
    view = DatasetSource(
        table="road_events",
        database="historical",
        name="Road events",
        shadows="_road_events_ingested",
    )
    with restored_registries():
        register_dataset_source_provider(lambda client, database: [view])
        body = domains_api.get("/domains/transit", cookies={"session": "s"}).json()
    assert body["datasetIds"] == ["road_events"]


@respx.mock
def test_a_chained_shadow_resolves_to_the_same_id_the_catalog_uses(domains_api: TestClient, db: Session) -> None:
    """A shadowed table keeps its own real name, so it can be shadowed again by
    a later pack: here `_road_events_ingested` (the physical row `_catalog`
    still names) is replaced by `_road_events_renamed_again`, which is itself
    replaced by `road_events`. /catalog's apply_shadowing removes both targets
    in one pass and reports only the final id. This hub used to stop after one
    hop, landing on the middle name instead, and the frontend drops a hub id
    that does not exact-match a catalog id."""
    as_user(USER)
    tagged(queries=[{"id": 21, "name": "Road events", "tags": [TRANSIT_TAG]}], dashboards=[])
    warehouse_catalog([{"table_name": "historical._road_events_ingested"}])
    mid = DatasetSource(
        table="_road_events_renamed_again",
        database="historical",
        name="Road events",
        shadows="_road_events_ingested",
    )
    final = DatasetSource(
        table="road_events", database="historical", name="Road events", shadows="_road_events_renamed_again"
    )

    with restored_registries():
        register_dataset_source_provider(lambda client, database: [mid, final])
        hub = domains_api.get("/domains/transit", cookies={"session": "s"}).json()
        catalog_response = domains_api.get("/catalog", cookies={"session": "s"}).json()

    assert hub["datasetIds"] == ["road_events"]
    assert [d["id"] for d in catalog_response] == ["road_events"]
    assert hub["datasetIds"] == [d["id"] for d in catalog_response]

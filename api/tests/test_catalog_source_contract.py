"""Three mutation-survivable gaps in build_catalog and dataset_ids, found on a
final review of the dataset source seam.

Split out of test_dataset_source_registry.py rather than grown into it: that
file already sits close to the 300-line block, and these three are a coherent
unit on their own, each pinning one place a contributed dataset's fields have
to survive the trip from DatasetSource to the wire contract.
"""

import pytest

from veodyn_api.registry import DatasetSource, empty_registries, register_dataset_source_provider


class FakeWarehouse:
    """Stands in for ClickHouseClient. A provider is handed one and may ignore it."""

    def query(self, statement: str, params: dict[str, str] | None = None) -> list[dict[str, str]]:
        return []


def test_dataset_ids_drops_a_shadowed_source() -> None:
    """The tag guard in routers/catalog.py (_authorize_dataset_tag_write) checks
    a table name against this set before letting a tag land on it. build_catalog
    already drops a shadowed source's raw id because the frontend never sees it
    in a response; dataset_ids used to skip that step, so the guard would accept
    a tag write against `_road_events_ingested`, an id that can never appear in
    a catalog response and so could never carry the tag back out.
    """
    from veodyn_api.services import catalog as catalog_service

    renamed = DatasetSource(table="_road_events_ingested", database="historical", name="Road events")
    view = DatasetSource(
        table="road_events", database="historical", name="Road events", shadows="_road_events_ingested"
    )
    with empty_registries():
        register_dataset_source_provider(lambda client, database: [renamed, view])
        ids = catalog_service.dataset_ids(FakeWarehouse(), "historical")
    assert ids == {"road_events"}


def test_a_contributed_dataset_names_no_feed(monkeypatch: pytest.MonkeyPatch) -> None:
    """services/feeds.py excludes any dataset whose origin is not 'capture' from
    Feed Health: a contributed dataset has no cadence and nothing feeds it. Its
    freshness.feedId used to be set to the table name regardless, which
    advertised a feed link that /feeds has nothing under, contradicting the
    field's documented meaning in app/src/types/catalog.ts.
    """
    from veodyn_api.services import catalog as catalog_service

    source = DatasetSource(table="restrooms", database="historical", name="Restrooms", origin="contributed")
    monkeypatch.setattr(catalog_service, "_columns_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_rows_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_span", lambda client, s: (None, None))

    with empty_registries():
        register_dataset_source_provider(lambda client, database: [source])
        datasets = catalog_service.build_catalog(FakeWarehouse(), database="historical", stale_after_minutes=60)
    assert datasets[0].freshness.feed_id is None


def test_a_captured_dataset_still_names_its_feed(monkeypatch: pytest.MonkeyPatch) -> None:
    """The control on the test above: excluding a contributed dataset's feed id
    must not take a captured one's with it."""
    from veodyn_api.services import catalog as catalog_service

    source = DatasetSource(table="q_trips_9", database="historical", name="Trips", query_id=9)
    monkeypatch.setattr(catalog_service, "_columns_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_rows_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_span", lambda client, s: (None, None))

    with empty_registries():
        register_dataset_source_provider(lambda client, database: [source])
        datasets = catalog_service.build_catalog(FakeWarehouse(), database="historical", stale_after_minutes=60)
    assert datasets[0].freshness.feed_id == "q_trips_9"


def test_build_catalog_passes_through_a_contributed_writable_source(monkeypatch: pytest.MonkeyPatch) -> None:
    """The only prior build_catalog assertion on origin/writable
    (test_both_new_fields_default_to_a_captured_dataset) supplies a default
    captured source and asserts back those same default values, so replacing
    `origin=source.origin, writable=source.writable` at the DatasetOut
    construction site with the model's own defaults left every test green. This
    drives non-default values through and asserts them on the way out, so that
    substitution fails here instead.
    """
    from veodyn_api.services import catalog as catalog_service

    source = DatasetSource(
        table="restrooms", database="historical", name="Restrooms", origin="contributed", writable=True
    )
    monkeypatch.setattr(catalog_service, "_columns_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_rows_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_span", lambda client, s: (None, None))

    with empty_registries():
        register_dataset_source_provider(lambda client, database: [source])
        datasets = catalog_service.build_catalog(FakeWarehouse(), database="historical", stale_after_minutes=60)
    assert datasets[0].origin == "contributed"
    assert datasets[0].writable is True
